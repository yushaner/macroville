// 程序化城市生成：种子可复现。
//
// 这一版按「控制性详细规划」的思路来铺城：
//   · 先铺正交路网（主干道 / 次干道 / 支路 / 环路），路 connectivity 是城市最先到位的基础设施；
//   · 路网围合出来的每一片 == 一个街区，用途按街区整体给定（现实里也是按街坊控规），
//     而不是逐格随机撒色块；
//   · 同心环 + 风向分区：中心 CBD，内城居住，中环住商混合，
//     工业只放在盛行风的下风向一侧，中间留防护绿地；
//   · 学校医院按服务半径铺点位，水电放在上风向 / 下游合适的边缘；
//   · 每格自带规划指标：容积率、建筑密度、绿地率、建筑面积、承载人口、承载岗位
//     （由 src/sim/land.ts 按国标口径从「用途 + 等级」现算）。
//
// 生成出来的是「潜在规划图」：所有地块初始 developed = false，
// 真正建成哪一片由 stages.growCity() 随城市的人口压力逐月点亮。

import { CONFIG, SECTOR_INITIAL_SHARE } from '../sim/config';
import { planLevelOf, ringIndexOf } from '../sim/land';
import { buildRoadPlan, type RoadPlan } from '../sim/roadGrid';
import { distributePopulation, pickTileByPop, sampleCountFor } from '../sim/population';
import { HOUSEHOLD_SIZE } from '../data/units';
import { RNG } from '../sim/rng';
import { STAGES, developCityAround, developedTilesOfType, INITIAL_RADIUS, targetFirms } from '../sim/stages';
import type { City, Firm, Household, RoadClass, Sector, TileData, TileType } from '../sim/types';

export interface GenResult {
  city: City;
  households: Household[];
  firms: Firm[];
  nextId: number;
  plan: RoadPlan; // 路网底图：渲染时按 roadClass 画路宽，通达性也按它算
  realHouseholds: number; // 初始真实户数（人口的真值）
}

// 开局蓝图对地块构成的影响：工业/商业倾向会改变同心环各圈的用途配比
export interface GenOpts {
  pop?: number; // 初始真实户数
  industryBias?: number; // 0-1
  commercialBias?: number; // 0-1
}

// 环带边界（按到城市原点的归一化距离；分母 maxR ≈ 26 格 ≈ 6.5km）
const RING = {
  // CBD 核心：只有「十字路口周边一两格」。
  // 这个值必须小 —— 它用的是归一化距离，0.10 就意味着半径 2.6 格，
  // 会把开局那座半径 2 格的村落整个判成商业用地：一户住宅都没有，人口永远卡在两千人。
  // 真实的 CBD 是长出来的：先有村口的几家铺子，等城市真的大了，
  // 沿街的地块才会被 evolveUsage 一格格"破墙开店"改造成中心商务区。
  cbd: 0.045,
  inner: 0.36, // 以内：内城居住
  mixed: 0.56, // 以内：住商混合
  industry: 0.8, // 以内：工业带 / 外围居住
  suburb: 0.98, // 以内：远郊；再往外就是生态绿地与基本农田
};

// CBD 核心：原点四周临街的街角地块里，最多划这么多格做商业（村口的转角铺面）
const CBD_CORE_TILES = 6;
const CBD_CORE_REACH = 3; // 只在原点 3 格（750m）范围内找街角

// 下风向扇区：盛行风自北向南，工业区放在南半部，避免污染倒灌城区
function isDownwind(dy: number, dx: number): boolean {
  // 屏幕下方为南：dy > 0 即偏南；取一个 150° 的扇区
  return Math.abs(dx) * 0.36 + dy > 0;
}

function zoneBlock(
  d: number,
  dy: number,
  dx: number,
  rng: RNG,
  indBias: number,
  comBias: number,
): TileType {
  if (d < RING.cbd) return 'commercial';
  if (d < RING.inner) {
    // 内城以居住为主；商业倾向高的蓝图会让中心外围也冒出商圈
    return comBias > 0.72 && rng.float() < 0.3 ? 'commercial' : 'residential';
  }
  if (d < RING.mixed) {
    const p = 0.2 + comBias * 0.4;
    return rng.float() < p ? 'commercial' : 'residential';
  }
  if (d < RING.industry) {
    // 工业带：只有下风向的一半拿去建厂，上风向那一半仍然是住区
    const dw = isDownwind(dy, dx);
    if (dw) return rng.float() < 0.55 + indBias * 0.3 ? 'industrial' : 'residential';
    return indBias > 0.7 && rng.float() < 0.35 ? 'industrial' : 'residential';
  }
  if (d < RING.suburb) {
    // 远郊：下风向留给工业与物流，其余是低密度居住与村庄
    const dw = isDownwind(dy, dx);
    if (dw) return rng.float() < 0.25 + indBias * 0.4 ? 'industrial' : 'residential';
    return rng.float() < 0.12 ? 'empty' : 'residential';
  }
  return 'empty'; // 生态绿地 / 基本农田，留给下一座城
}

export function generateCity(seed: number, opts: GenOpts = {}): GenResult {
  const rng = new RNG(seed);
  const W = CONFIG.GRID_W;
  const H = CONFIG.GRID_H;
  const plan = buildRoadPlan(seed, W, H, CONFIG.ROAD_REACH);
  const { originX: ox, originY: oy } = plan;

  const typeOf: TileType[] = new Array(W * H).fill('empty');
  const clsOf: RoadClass[] = new Array(W * H).fill(0);
  for (let i = 0; i < W * H; i++) {
    const c = plan.cls[i];
    if (c > 0) {
      typeOf[i] = 'road';
      clsOf[i] = c as RoadClass;
    }
  }

  const maxR = Math.min(ox, oy, W - ox - 1, H - oy - 1) || 1;

  // —— 1) 路网围合出的街区：按连通域切分，一个街区给一个主导用途 ——
  const blockOf = new Int32Array(W * H).fill(-1);
  const blocks: number[][] = [];
  const stack: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (typeOf[s] !== 'empty' || blockOf[s] >= 0) continue;
    const id = blocks.length;
    const cells: number[] = [];
    stack.length = 0;
    stack.push(s);
    blockOf[s] = id;
    while (stack.length) {
      const cur = stack.pop()!;
      cells.push(cur);
      const cx0 = cur % W;
      const cy0 = Math.floor(cur / W);
      const push = (nx: number, ny: number): void => {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) return;
        const j = ny * W + nx;
        if (typeOf[j] !== 'empty' || blockOf[j] >= 0) return;
        blockOf[j] = id;
        stack.push(j);
      };
      push(cx0 - 1, cy0);
      push(cx0 + 1, cy0);
      push(cx0, cy0 - 1);
      push(cx0, cy0 + 1);
    }
    blocks.push(cells);
  }

  const indBias = opts.industryBias ?? 0.5;
  const comBias = opts.commercialBias ?? 0.5;

  for (const cells of blocks) {
    let sx = 0;
    let sy = 0;
    for (const i of cells) {
      sx += i % W;
      sy += Math.floor(i / W);
    }
    const bx = sx / cells.length;
    const by = sy / cells.length;
    const dx = bx - ox;
    const dy = by - oy;
    const d = Math.hypot(dx, dy) / maxR;
    const use = zoneBlock(d, dy, dx, rng, indBias, comBias);
    for (const i of cells) typeOf[i] = use;
  }

  // CBD 核心：把原点四周「临街的街角地块」划为商业。
  //
  // 为什么不能按「到原点的距离 < RING.cbd」来切：城市原点恰好落在两条中轴主干道的交叉口上，
  // 半径 1 格以内那 5 格全是马路，按距离切出来的 CBD 一块建设用地都没有 ——
  // 村落阶段一块商业用地都落不了地，企业只能挤在住宅上（每家只雇得起 8 个人），
  // 一千六百人里只有两百个岗位，城市开局就被失业率推着一路萎缩。
  // 真实的市中心是从十字路口的四个街角长起来的：先有转角那几家铺子，
  // 等城市真的大了，才由 evolveUsage 一格格"破墙开店"扩成中央商务区。
  const corners: { i: number; d: number }[] = [];
  for (let i = 0; i < W * H; i++) {
    if (typeOf[i] === 'road' || typeOf[i] === 'empty') continue;
    const x = i % W;
    const y = Math.floor(i / W);
    const d = Math.hypot(x - ox, y - oy);
    if (d > CBD_CORE_REACH) continue;
    // 只认临街的地块：不挨着路的街坊内部地块开不了店
    const street =
      (x > 0 && clsOf[i - 1] > 0) ||
      (x < W - 1 && clsOf[i + 1] > 0) ||
      (y > 0 && clsOf[i - W] > 0) ||
      (y < H - 1 && clsOf[i + W] > 0);
    if (!street) continue;
    corners.push({ i, d });
  }
  corners.sort((a, b) => a.d - b.d);
  for (let k = 0; k < Math.min(CBD_CORE_TILES, corners.length); k++) {
    typeOf[corners[k].i] = 'commercial';
  }

  // —— 2) 工业与居住之间的防护绿地：现实中这是强制性的卫生隔离带 ——
  const adjacentTo = (x: number, y: number, want: TileType): boolean => {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [ax, ay] of dirs) {
      const nx = x + ax;
      const ny = y + ay;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      if (typeOf[ny * W + nx] === want) return true;
    }
    return false;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (typeOf[i] !== 'residential') continue;
      if (!adjacentTo(x, y, 'industrial')) continue;
      if (rng.float() < 0.45) typeOf[i] = 'park';
    }
  }

  // —— 3) 公共服务设施：学校 / 医院按服务半径铺点位 ——
  // 服务半径的现实口径：小学 500m（≈2 格）、中学 1000m（≈4 格）、综合医院 3~5km。
  // 这里按 5 格 / 7 格布点，换算回去大约是 1.2km / 1.8km，处在合理区间。
  const snapTo = (bx: number, by: number, want: TileType[], radius: number): number | null => {
    let best: number | null = null;
    let bestD = 1e9;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = bx + dx;
        const ny = by + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!want.includes(typeOf[j])) continue;
        const dd = dx * dx + dy * dy;
        if (dd < bestD) {
          bestD = dd;
          best = j;
        }
      }
    }
    return best;
  };

  // 学校按 1.5km 服务半径布点，医院按 2km 布点（7 格 / 9 格）
  for (let by = 2; by < H; by += 7) {
    for (let bx = 2; bx < W; bx += 7) {
      const j = snapTo(bx, by, ['residential'], 2);
      if (j !== null && rng.float() < 0.85) typeOf[j] = 'school';
    }
  }
  for (let by = 6; by < H; by += 9) {
    for (let bx = 6; bx < W; bx += 9) {
      const j = snapTo(bx, by, ['residential'], 2);
      if (j !== null && rng.float() < 0.8) typeOf[j] = 'hospital';
    }
  }
  // 公园：居住区里随机补点，让宜居而有呼吸感
  for (let i = 0; i < W * H; i++) {
    if (typeOf[i] === 'residential' && rng.float() < 0.05) typeOf[i] = 'park';
  }

  // —— 4) 市政 / 能源：水厂放在上风向远郊，电厂放在下风向远郊 ——
  const placeSomewhere = (want: TileType, pickFn: (x: number, y: number) => boolean, n: number): void => {
    const pool: number[] = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (typeOf[i] !== 'residential' && typeOf[i] !== 'empty') continue;
        if (pickFn(x, y)) pool.push(i);
      }
    }
    for (let k = 0; k < n && pool.length > 0; k++) {
      const idx = rng.int(0, pool.length - 1);
      typeOf[pool[idx]] = want;
      pool.splice(idx, 1);
    }
  };
  const outerAndDownwind = (x: number, y: number): boolean =>
    Math.hypot(x - ox, y - oy) / maxR > 0.6 && isDownwind(y - oy, x - ox);
  const outerAndUpwind = (x: number, y: number): boolean =>
    Math.hypot(x - ox, y - oy) / maxR > 0.6 && !isDownwind(y - oy, x - ox);
  placeSomewhere('power', outerAndDownwind, 5);
  placeSomewhere('water', outerAndUpwind, 4);

  // —— 5) 潜在规划 → 带属性地块 ——
  // 每格除了现状用途，还要写进「控制性详细规划」给定的强度上限（planLevel）：
  // CBD 允许盖到 FAR 6.0，远郊只能盖 FAR 0.7 的低层。市场在这个上限之内自行加建，
  // 于是「全城最多装 100 万人」不是一句口号，而是全城控规指标加总的结果。
  const tiles: TileData[] = [];
  for (let i = 0; i < W * H; i++) {
    const x = i % W;
    const y = Math.floor(i / W);
    const d = Math.hypot(x - ox, y - oy) / maxR;
    const centrality = 1 - Math.min(1, d);
    const ring = ringIndexOf(d);
    const nearRoad =
      (x > 0 && typeOf[i - 1] === 'road') ||
      (x < W - 1 && typeOf[i + 1] === 'road') ||
      (y > 0 && typeOf[i - W] === 'road') ||
      (y < H - 1 && typeOf[i + W] === 'road');
    const premium =
      typeOf[i] === 'commercial' ? 1200 : typeOf[i] === 'industrial' ? -400 : typeOf[i] === 'park' ? -200 : 0;
    tiles.push({
      type: typeOf[i],
      developed: false,
      level: 1,
      planLevel: planLevelOf(typeOf[i], ring),
      pop: 0,
      jobs: 0,
      density: 0,
      landValue: Math.max(
        CONFIG.LAND_VALUE_MIN,
        320 + centrality * 1500 + (nearRoad ? 420 : 0) + premium,
      ),
      pollution: 0,
      amenity: 0,
      utility: 0,
      transit: nearRoad ? 0.5 : 0.15,
      congestion: 0,
      roadClass: clsOf[i],
      firmId: null,
      hhCount: 0,
    });
  }
  const city: City = { width: W, height: H, tiles, originX: ox, originY: oy };

  // —— 6) 开局只点亮村落：紧贴原点的一小片 ——
  developCityAround(city, ox, oy, INITIAL_RADIUS);

  const residentialTiles = developedTilesOfType(city, 'residential');
  if (residentialTiles.length === 0 && tiles[oy * W + ox]) {
    // 兜底：路网恰好压住原点时，把原点旁边的格子改成住区，保证有人可住
    tiles[oy * W + ox].type = 'residential';
    tiles[oy * W + ox].developed = true;
    residentialTiles.push(oy * W + ox);
  }

  // —— 7) 初始人口：落到住宅供给上，哪儿有房往哪儿填 ——
  const realHouseholds = Math.max(60, opts.pop ?? CONFIG.INITIAL_HOUSEHOLDS);
  distributePopulation(tiles, residentialTiles, Math.round(realHouseholds * HOUSEHOLD_SIZE));

  // —— 8) 家庭样本：人口很多时不可能创建几十万个对象，抽样即可 ——
  const sampleCount = sampleCountFor(realHouseholds);
  let nextId = 1;
  const households: Household[] = [];
  for (let i = 0; i < sampleCount; i++) {
    households.push({
      id: nextId++,
      tile: pickTileByPop(tiles, () => rng.float()),
      skill: rng.int(20, 90),
      savings: rng.range(CONFIG.INIT_SAVINGS_MIN, CONFIG.INIT_SAVINGS_MAX),
      wage: 0,
      employed: false,
      employerId: null,
      satisfaction: 60,
      consumption: 0,
      seeking: rng.int(0, 99) < Math.round(CONFIG.DEFAULT_LABOR_PART * 100),
    });
  }
  for (const h of households) {
    const t = tiles[h.tile];
    if (t) t.hhCount++;
  }

  // —— 9) 企业：开局只承载村落阶段的一部分，其余随升级入驻 ——
  const firms: Firm[] = [];
  const firmTiles = [
    ...developedTilesOfType(city, 'commercial'),
    ...developedTilesOfType(city, 'industrial'),
  ];
  const firmCount = targetFirms(STAGES[0], sampleCount);
  for (let i = 0; i < firmCount; i++) {
    firms.push(makeFirm(i, nextId++, rng, firmTiles, residentialTiles));
  }
  for (const f of firms) {
    const t = tiles[f.tile];
    if (t) t.firmId = f.id;
  }

  return { city, households, firms, nextId, plan, realHouseholds };
}

// —— 人口分配的公用工具 ——（见 src/sim/population.ts）

/** 本轮需要的家庭样本数：保证每个样本至少代表 1 户、最多代表 HH_PER_SAMPLE_MAX 户 */
export { sampleCountFor, distributePopulation, pickTileByPop } from '../sim/population';

// 新建企业（初始与阶段升级共用）
export function makeFirm(
  i: number,
  id: number,
  rng: RNG,
  firmTiles: number[],
  fallbackTiles: number[],
): Firm {
  const basicLeft = Math.round(CONFIG.INITIAL_FIRMS * SECTOR_INITIAL_SHARE.basic);
  const manuLeft = Math.round(CONFIG.INITIAL_FIRMS * SECTOR_INITIAL_SHARE.manufacturing);
  const SECTORS: Sector[] = ['basic', 'manufacturing', 'service'];
  const plan: Sector[] = [
    ...Array(basicLeft).fill('basic' as Sector),
    ...Array(manuLeft).fill('manufacturing' as Sector),
    ...Array(CONFIG.INITIAL_FIRMS - basicLeft - manuLeft).fill('service' as Sector),
  ];
  const sector = plan[i % plan.length] ?? SECTORS[i % SECTORS.length];
  const tile = firmTiles.length ? rng.pick(firmTiles) : rng.pick(fallbackTiles.length ? fallbackTiles : [0]);
  return {
    id,
    sector,
    tile,
    employees: [],
    capital: CONFIG.FIRM_CAPITAL, // 固定资产：元（每家企业样本）
    inventory: CONFIG.FIRM_INIT_INVENTORY, // 开局库存：件（≈ 满员一个月的产量）
    price: CONFIG.BASE_PRICE,
    output: 0,
    wageOffered: CONFIG.DEFAULT_MIN_WAGE,
    profit: 0,
    revenue: 0,
    powered: true,
    capacity: CONFIG.FIRM_CAPACITY,
    lossMonths: 0,
  };
}
