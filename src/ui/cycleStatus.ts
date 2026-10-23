// 顶栏的经济周期指示器：阶段图标 + 景气指数 + 产出缺口，点开看完整周期曲线。
//
// 为什么要在顶栏常驻：周期是这座城市的"天气"。玩家拧的每一根旋钮都会改变它，
// 但如果看不到天气，玩家就只能看到 GDP 曲线在抖，却不知道为什么抖、什么时候会转向。

import { showModal } from './modal';
import { cycleShape, PHASE_META } from '../sim/businessCycle';
import type { SimState } from '../sim/types';

const ORDER = ['boom', 'recession', 'depression', 'recovery'] as const;

export class CycleStatus {
  constructor(private el: HTMLElement) {
    this.el.className = 'cycle-status';
    this.el.addEventListener('click', () => this.open());
  }

  private state: SimState | null = null;

  update(state: SimState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const b = s.business;
    const m = PHASE_META[b.phase];
    const idx = b.index;
    const gap = b.outputGap;
    // 景气条：-1..1 映射到 0..100%，中间 50% 是趋势线
    const pos = Math.max(0, Math.min(100, (idx + 1) * 50));
    this.el.innerHTML = `
      <span class="cs-phase ph-${b.phase}">${m.icon} ${m.name}</span>
      <span class="cs-bar"><i style="left:${pos.toFixed(1)}%"></i></span>
      <span class="cs-num" title="景气指数">${idx >= 0 ? '+' : ''}${idx.toFixed(2)}</span>
      <span class="cs-gap ${gap >= 0 ? 'up' : 'down'}" title="产出缺口">缺口 ${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)}%</span>
      <span class="cs-mon" title="本阶段已持续">${b.phaseMonths}月</span>`;
  }

  private open(): void {
    const s = this.state;
    if (!s) return;
    const b = s.business;
    const m = PHASE_META[b.phase];
    const shape = cycleShape(s);
    const hist = b.history.slice(-120);
    const gap = b.gapHistory.slice(-120);
    const counts = ORDER.map(
      (p) => `<div class="det-row"><span>${PHASE_META[p].icon} ${PHASE_META[p].name}</span><b>${b.phaseCount[p]} 次</b></div>`,
    ).join('');
    showModal(`
      <div class="chapter">经济周期</div>
      <h2>${m.icon} ${m.name}</h2>
      <p>${m.desc}</p>
      <div class="det-now">景气指数 ${b.index >= 0 ? '+' : ''}${b.index.toFixed(2)}　·　产出缺口 ${(b.outputGap * 100).toFixed(1)}%</div>
      <h4>景气指数走势</h4>
      ${waveChart(hist)}
      <div class="det-axis"><span>最早</span><span>最近 ${hist.length} 个月</span></div>
      <h4>产出缺口</h4>
      ${gapChart(gap)}
      <div class="det-axis"><span>负 = 资源闲置</span><span>正 = 经济过热</span></div>
      <h4>当前周期的形状（由你的政策决定）</h4>
      <div class="det-stats">
        <div class="det-row"><span>波动幅度</span><b>${(shape.amplitude * 100).toFixed(0)}%</b></div>
        <div class="det-row"><span>周期长度</span><b>${shape.period.toFixed(0)} 个月</b></div>
        <div class="det-row"><span>自动稳定器强度</span><b>${(shape.stabilizer * 100).toFixed(0)}%</b></div>
        <div class="det-row"><span>投资加速数</span><b>${shape.accelerator.toFixed(2)}</b></div>
        <div class="det-row"><span>已完成完整周期</span><b>${b.cycleCount} 轮</b></div>
        <div class="det-row"><span>阶段经历次数</span><b>—</b></div>
        ${counts}
      </div>
      <h4>怎么改写它</h4>
      <p>福利支出、公共支出与税率是<b>自动稳定器</b>——拧高它们，衰退的谷底会被削平，代价是财政与长期增速。</p>
      <p>产业补贴、扩产意愿、库存策略与贸易开放度是<b>放大器</b>——拧高它们，繁荣更热、衰退更深，周期也会更短更急。</p>
      <p class="muted">${m.hint}</p>
      <button class="close" data-close>关闭</button>
    `);
  }
}

// 景气指数曲线：0 轴（趋势线）画在中间，正区间浅红、负区间浅绿
function waveChart(data: number[]): string {
  if (data.length < 2) return `<p class="muted">还需要再跑几个月才能看出周期形状。</p>`;
  const W = 480, H = 150, pad = 24;
  const lo = -1, hi = 1;
  const span = hi - lo;
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (v: number) => 20 + ((hi - v) / span) * (H - 44);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(clamp(v, lo, hi)).toFixed(1)}`).join(' ');
  const zeroN = y(0);
  const zero = zeroN.toFixed(1);
  return `<svg class="det-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <rect x="${pad}" y="20" width="${W - pad * 2}" height="${(zeroN - 20).toFixed(1)}" fill="rgba(229,90,90,.10)"/>
      <rect x="${pad}" y="${zero}" width="${W - pad * 2}" height="${(H - 20 - zeroN).toFixed(1)}" fill="rgba(90,200,130,.10)"/>
      <line x1="${pad}" y1="${zero}" x2="${W - pad}" y2="${zero}" stroke="#4a5164" stroke-width="1" stroke-dasharray="4 3"/>
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <text x="4" y="14" fill="#8b93a7" font-size="10">+1 过热</text>
      <text x="4" y="${H - 6}" fill="#8b93a7" font-size="10">-1 过冷</text>
    </svg>`;
}

function gapChart(data: number[]): string {
  if (data.length < 2) return `<p class="muted">还需要再跑几个月。</p>`;
  const W = 480, H = 120, pad = 24;
  const max = Math.max(0.1, ...data.map(Math.abs));
  const x = (i: number) => pad + (i / (data.length - 1)) * (W - pad * 2);
  const y = (v: number) => H / 2 - (v / max) * (H / 2 - 14);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const zero = (H / 2).toFixed(1);
  return `<svg class="det-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <line x1="${pad}" y1="${zero}" x2="${W - pad}" y2="${zero}" stroke="#4a5164" stroke-width="1" stroke-dasharray="4 3"/>
      <polyline points="${pts}" fill="none" stroke="var(--warn)" stroke-width="2"/>
      <text x="4" y="12" fill="#8b93a7" font-size="10">+${(max * 100).toFixed(0)}%</text>
      <text x="4" y="${H - 4}" fill="#8b93a7" font-size="10">-${(max * 100).toFixed(0)}%</text>
    </svg>`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
