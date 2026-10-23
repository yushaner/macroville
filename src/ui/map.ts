// 地图渲染：Canvas 2D 网格。
// 每格不再是固定色块——可以按「用途 / 地价 / 密度 / 污染 / 等级 / 公共服务」六种图层着色，
// 颜色由该地块的实时属性算出；支持悬停高亮与点击选中，选中的地块属性交给外部面板展示。

import type { City, SimState, TileData } from '../sim/types';
import { stageById } from '../sim/stages';
import { TILE_LABELS } from '../sim/tiles';
import {
  NET_AREA,
  ROAD_LABEL,
  ROAD_WIDTH,
  farOf,
  coverageOf,
  floorsOf,
  gfaCapOf,
  heightOf,
  jobCapOf,
  popCapOf,
  serviceCapOf,
  RING_LABELS,
  ringIndexOf,
  TILE_M,
} from '../sim/land';
import { people as fmtPeople, landPrice, qty, yuan } from '../data/units';

export const TILE_COLORS: Record<string, string> = {
  empty: '#0b0d13',
  residential: '#2b3a55',
  commercial: '#3a5a40',
  industrial: '#5a4a2b',
  road: '#1a1d27',
  power: '#7a5cff',
  water: '#2e8bff',
  school: '#ffb347',
  hospital: '#ff6b8a',
  park: '#1f4d2b',
};

export type LayerId =
  | 'usage'
  | 'landValue'
  | 'density'
  | 'far'
  | 'occupancy'
  | 'transit'
  | 'pollution';

export const LAYERS: { id: LayerId; label: string; hint: string }[] = [
  { id: 'usage', label: '用地性质', hint: '按城市规划用途着色，亮度代表容积率等级；棕色晕染代表污染' },
  { id: 'landValue', label: '地价', hint: '区位、交通、配套、密度共同决定的楼面地价热力图（元/㎡）' },
  { id: 'density', label: '使用强度', hint: '住区入住率 / 商业客流 / 工业开工强度' },
  { id: 'far', label: '容积率', hint: '建筑面积 ÷ 净用地：数值越高楼越高、承载的人口越多' },
  { id: 'occupancy', label: '入住率', hint: '实际常住人口 ÷ 承载人口：逼近 100% 就该新征地或提高容积率' },
  { id: 'transit', label: '交通可达', hint: '到最近已通车干道的距离折算，直接影响租金与地价' },
  { id: 'pollution', label: '污染', hint: '工业排放经邻域扩散后的累积值' },
];

// 地图不再画整张规划图，而是按「当前阶段的可视半径」取景：
// 村庄只看见家门口几条街（格子大、看得清），大都市才拉远到全城（格子小、看得全）。
// 这样地图范围随城市长大而扩大，正好对应玩家从居民 → 老板 → 市长的身份变化。
const MIN_CELL = 4;
const VOID_COLOR = '#07080c'; // 尚未纳入视野的地图外区域

// —— 颜色工具 ——
function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbStr(c: [number, number, number]): string {
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
}

function mix(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  return rgbStr([
    ca[0] + (cb[0] - ca[0]) * k,
    ca[1] + (cb[1] - ca[1]) * k,
    ca[2] + (cb[2] - ca[2]) * k,
  ]);
}

function scale(a: string, k: number): string {
  const c = parseHex(a);
  return rgbStr([
    Math.min(255, c[0] * k),
    Math.min(255, c[1] * k),
    Math.min(255, c[2] * k),
  ]);
}

// 热力渐变：蓝 → 青 → 绿 → 黄 → 红（t ∈ [0,1]）
const HEAT_STOPS = ['#123a6b', '#1d7fa8', '#38b764', '#f3c13a', '#e6484f'];
function heat(t: number): string {
  const k = Math.max(0, Math.min(1, t)) * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(k));
  return mix(HEAT_STOPS[i], HEAT_STOPS[i + 1], k - i);
}

// 某图层下某地块应取 0-1 的强度值
function layerValue(layer: LayerId, t: TileData): number {
  switch (layer) {
    case 'landValue':
      return Math.min(1, t.landValue / 4400); // ¥4,400/㎡ 以上同色（现状已接近天花板）
    case 'density':
      return t.density;
    case 'far':
      return Math.min(1, farOf(t.type, t.level) / 4); // FAR 4.0 以上同色
    case 'occupancy':
      return Math.min(1, t.type === 'residential' ? t.pop / Math.max(1, popCapOf(t)) : t.density);
    case 'transit':
      return t.transit;
    case 'pollution':
      return Math.min(1, t.pollution);
    default:
      return 0;
  }
}

export interface MapViewOpts {
  onSelect?: (index: number | null) => void;
}

export class MapView {
  private ctx: CanvasRenderingContext2D;
  private layer: LayerId = 'usage';
  private hover: number | null = null;
  private selected: number | null = null;
  private opts: MapViewOpts;
  // 视野状态：viewRadius 来自阶段，cell 每帧按面板可用空间重算
  private vr = 5;
  private size = 11;
  private cell = 12;
  private cityW = 1;
  private cityH = 1;
  private cx = 0;
  private cy = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    opts: MapViewOpts = {},
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D 不可用');
    this.ctx = ctx;
    this.opts = opts;

    canvas.addEventListener('mousemove', (e) => {
      const i = this.indexAt(e);
      if (i !== this.hover) {
        this.hover = i;
        canvas.style.cursor = i === null ? 'default' : 'pointer';
      }
    });
    canvas.addEventListener('mouseleave', () => {
      this.hover = null;
    });
    canvas.addEventListener('click', (e) => {
      const i = this.indexAt(e);
      this.selected = this.selected === i ? null : i;
      this.opts.onSelect?.(this.selected);
    });
  }

  setLayer(id: LayerId): void {
    this.layer = id;
  }

  getLayer(): LayerId {
    return this.layer;
  }

  getSelected(): number | null {
    return this.selected;
  }

  clearSelection(): void {
    this.selected = null;
  }

  // 屏幕坐标 → 地块下标（先还原成视野内格坐标，再换算回城市坐标）
  private indexAt(e: MouseEvent): number | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const vx = Math.floor(((e.clientX - rect.left) / rect.width) * this.size);
    const vy = Math.floor(((e.clientY - rect.top) / rect.height) * this.size);
    if (vx < 0 || vy < 0 || vx >= this.size || vy >= this.size) return null;
    const x = this.cx - this.vr + vx;
    const y = this.cy - this.vr + vy;
    if (x < 0 || y < 0 || x >= this.cityW || y >= this.cityH) return null;
    return y * this.cityW + x;
  }

  // 面板可用空间决定格子大小：整张地图始终完整落在面板里，不需要缩放浏览器
  private fitTo(viewSize: number): void {
    const host = this.canvas.parentElement;
    const availW = host?.clientWidth ?? this.canvas.clientWidth ?? 480;
    const availH = host?.clientHeight ?? this.canvas.clientHeight ?? 480;
    const avail = Math.max(160, Math.min(availW, availH) - 4);
    this.cell = Math.max(MIN_CELL, Math.floor(avail / viewSize));
    const px = this.cell * viewSize;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const bw = Math.floor(px * dpr);
    if (this.canvas.width !== bw) {
      this.canvas.width = bw;
      this.canvas.height = bw;
    }
    this.canvas.style.width = `${px}px`;
    this.canvas.style.height = `${px}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(state: SimState): void {
    const city: City = state.city;
    this.cityW = city.width;
    this.cityH = city.height;
    this.cx = Math.floor((city.width - 1) / 2);
    this.cy = Math.floor((city.height - 1) / 2);

    // 视野半径跟着城市阶段走：城市越大，看得越远
    const stage = stageById(state.stage);
    this.vr = stage.viewRadius ?? 20;
    this.size = this.vr * 2 + 1;
    this.fitTo(this.size);

    const ctx = this.ctx;
    ctx.fillStyle = VOID_COLOR;
    ctx.fillRect(0, 0, this.size * this.cell, this.size * this.cell);

    // 企业雇员查询：用于区分「有人开工」与「空壳企业」
    const firmEmp = new Map<number, number>();
    for (const f of state.firms) firmEmp.set(f.id, f.employees.length);

    for (let vy = 0; vy < this.size; vy++) {
      for (let vx = 0; vx < this.size; vx++) {
        const gx = this.cx - this.vr + vx;
        const gy = this.cy - this.vr + vy;
        const px = vx * this.cell;
        const py = vy * this.cell;
        if (gx < 0 || gy < 0 || gx >= city.width || gy >= city.height) continue;
        const t = city.tiles[gy * city.width + gx];
        if (!t) continue;

        if (this.layer === 'usage') {
          ctx.fillStyle = this.usageColor(t);
        } else if (!t.developed) {
          ctx.fillStyle = TILE_COLORS.empty;
        } else {
          ctx.fillStyle = heat(layerValue(this.layer, t));
        }
        ctx.fillRect(px, py, this.cell, this.cell);

        // 道路：仅在「用地性质」图层按等级画红线宽度，让拥堵程度一眼可见
        if (this.layer === 'usage' && t.type === 'road' && t.developed) {
          this.drawRoad(ctx, px, py, t);
        }

        // 企业标记：只在「用途」图层保留，避免与热力图混色难以辨认
        if (t.firmId !== null && this.layer === 'usage' && this.cell >= 8) {
          const emp = firmEmp.get(t.firmId) ?? 0;
          const pad = Math.max(1, Math.round(this.cell * 0.28));
          ctx.fillStyle = emp > 0 ? '#9be29b' : '#e29b9b';
          ctx.fillRect(px + pad, py + pad, this.cell - pad * 2, this.cell - pad * 2);
        }
      }
    }

    // 悬停 / 选中描边
    if (this.hover !== null) this.stroke(this.hover, 'rgba(255,255,255,.55)', 1);
    if (this.selected !== null) this.stroke(this.selected, '#4f9dff', 2);
  }

  // 道路渲染：红线宽度按等级（支路 15m / 次干道 30m / 主干道 45m）占 250m 街区的比例，
  // 再用拥堵度由灰转红 —— 一眼能看出哪条环路堵成了停车场。
  private drawRoad(ctx: CanvasRenderingContext2D, px: number, py: number, t: TileData): void {
    const width = Math.max(1, Math.round((this.cell * (ROAD_WIDTH[t.roadClass] ?? 0)) / TILE_M));
    const w = Math.min(this.cell, Math.max(1, width));
    const off = Math.round((this.cell - w) / 2);
    const base = ['', '#3a4050', '#4a5064', '#5c6480'][t.roadClass] ?? '#3a4050';
    const jam = mix(base, '#e6484f', Math.min(1, t.congestion * 0.9));
    ctx.fillStyle = jam;
    // 纵向铺满、横向按红线宽度居中：方格网因此有了粗细层次
    ctx.fillRect(px + off, py, w, this.cell);
    ctx.fillRect(px, py + off, this.cell, w);
  }

  // 城市坐标 → 视野内坐标；若该格已不在视野内则跳过
  private stroke(i: number, color: string, width: number): void {
    const gx = i % this.cityW;
    const gy = Math.floor(i / this.cityW);
    const vx = gx - (this.cx - this.vr);
    const vy = gy - (this.cy - this.vr);
    if (vx < 0 || vy < 0 || vx >= this.size || vy >= this.size) return;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(vx * this.cell + width / 2, vy * this.cell + width / 2, this.cell - width, this.cell - width);
  }

  // 用途图层：基础色 + 等级亮度 + 污染晕染。让同一类用途也能看出差别。
  private usageColor(t: TileData): string {
    if (!t.developed) return TILE_COLORS.empty;
    const base = TILE_COLORS[t.type] ?? TILE_COLORS.empty;
    let c = scale(base, 0.7 + (t.level - 1) * 0.15);
    if (t.pollution > 0.05) {
      // 污染向土褐色晕染，越脏越明显
      c = mix(c, '#6b4a2b', Math.min(0.55, t.pollution));
    }
    return c;
  }
}

// 选中地块的详情文案（给详情面板用）：每一格里都住着一套完整的控规指标
export function tileDetail(state: SimState, index: number): string {
  const city = state.city;
  const t = city.tiles[index];
  if (!t) return '';
  const firm = t.firmId !== null ? state.firms.find((f) => f.id === t.firmId) : undefined;
  const rows: [string, string][] = [
    ['宗地坐标', `${index % city.width} , ${Math.floor(index / city.width)}`],
    ['用地性质', TILE_LABELS[t.type] ?? t.type],
    ['开发状态', t.developed ? '已建成' : '待收储（未点亮）'],
  ];
  if (t.type === 'road') {
    rows.push(['道路等级', `${ROAD_LABEL[t.roadClass]} · 红线 ${ROAD_WIDTH[t.roadClass]} m`]);
    rows.push(['饱和度', `${(t.congestion * 100).toFixed(0)}%`]);
  } else {
    // 现状容积率与控规上限并排显示：两者之间的空隙就是这座城市还能往上长多少
    rows.push(
      ['容积率（现状 / 控规）',
        `${farOf(t.type, t.level).toFixed(2)} / ${farOf(t.type, t.planLevel ?? t.level).toFixed(2)}` +
          `（${t.level} 级 · 上限 ${t.planLevel ?? '—'} 级）`],
    );
    rows.push(['所在环带', ringLabelOf(city, index)]);
    rows.push(['建筑密度', `${(coverageOf(t.type, t.level) * 100).toFixed(0)}%`]);
    rows.push(
      ['建筑层数 / 限高',
        `${floorsOf(t.type, t.level).toFixed(1)} 层 · ${heightOf(t.type, t.level).toFixed(0)} m`],
    );
    rows.push(['建筑面积', `${Math.round(gfaCapOf(t)).toLocaleString('zh-CN')} ㎡`]);
    rows.push(['净用地', `${Math.round(NET_AREA).toLocaleString('zh-CN')} ㎡`]);
  }
  if (t.type === 'residential') {
    rows.push(
      ['常住人口',
        `${fmtPeople(t.pop)} / 承载 ${fmtPeople(popCapOf(t))}（入住 ${(
          (t.pop / Math.max(1, popCapOf(t))) * 100
        ).toFixed(0)}%）`],
    );
    rows.push(['家庭样本', `${t.hhCount} 户样本落在本宗地`]);
  } else if (jobCapOf(t) > 0) {
    rows.push(['就业岗位', `${Math.round(t.jobs).toLocaleString('zh-CN')} / 承载 ${Math.round(jobCapOf(t)).toLocaleString('zh-CN')}`]);
  }
  const svc = serviceCapOf(t);
  if (svc) rows.push([svc.label, `${svc.value.toLocaleString('zh-CN')} ${svc.unit}`]);

  rows.push(['楼面地价', landPrice(t.landValue)]);
  rows.push(['交通可达', `${(t.transit * 100).toFixed(0)}%`]);
  rows.push(['市政配套', `${(t.utility * 100).toFixed(0)}%`]);
  rows.push(['公共服务', `${(t.amenity * 100).toFixed(0)}%`]);
  rows.push(['污染累积', `${(t.pollution * 100).toFixed(0)}%`]);

  if (firm) {
    rows.push(['入驻企业', `#${firm.id} ${sectorLabel(firm.sector)}`]);
    rows.push(['雇员', `${firm.employees.length} / ${Math.floor(firm.capacity)} 个样本岗位`]);
    rows.push(['月产出', `${qty(firm.output)} · 库存 ${qty(firm.inventory)}`]);
    rows.push(['月利润', `${yuan(firm.profit)}/月`]);
    rows.push(['售价', `¥${Math.round(firm.price).toLocaleString('zh-CN')}/件`]);
  }
  return rows
    .map(([k, v]) => `<div class="ti-row"><span class="ti-k">${k}</span><span class="ti-v">${v}</span></div>`)
    .join('');
}

// 地块所处的环带：控规指标就是按「离市中心多远」分圈给定的
function ringLabelOf(city: City, index: number): string {
  const x = index % city.width;
  const y = Math.floor(index / city.width);
  const maxR =
    Math.min(city.originX, city.originY, city.width - city.originX - 1, city.height - city.originY - 1) || 1;
  const d = Math.hypot(x - city.originX, y - city.originY) / maxR;
  return RING_LABELS[ringIndexOf(d)] ?? '—';
}

function sectorLabel(s: string): string {
  return { basic: '基础产业', manufacturing: '制造业', service: '服务业' }[s] ?? s;
}
