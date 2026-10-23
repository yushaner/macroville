// 空间尺度与土地规划指标。
//
// 之前「一个格子 = 一户人家」，地块的"承载量"只是等级的函数，和现实里的容积率没有任何关系，
// 于是出现「人口最多一万七却叫全球城市」这种对不上的读数。现在每一格是一个真实的规划单元：
//
//   一格 = 边长 250 米的街区（Block），毛用地 62,500 ㎡（包住内部支路、绿地与退界）
//   56 × 56 格 = 14 km × 14 km ≈ 196 km²，正好是一座特大城市总体规划区的尺度
//   净用地率 70% → 可建设用地 43,750 ㎡
//
// 承载量不再凭空给，而是由规划指标一步步算出来：
//   建筑面积 = 净用地 × 容积率（FAR）      ← 国标《城市居住区规划设计标准》里同口径算法
//   常住人口 = 建筑面积 ÷ 人均住宅建筑面积（40 ㎡/人）
//   就业岗位 = 建筑面积 ÷ 每岗位建筑面积（商务 25 ㎡/岗、工业 60 ㎡/岗）
//   建筑层数 = 容积率 ÷ 建筑密度
//
// 于是「 populations 上限」有了物理约束：住区铺满且普遍建到 3 级（FAR 2.0）时，
// 全城承载约 110 万人 —— 这就是这一版设计的规模上限。

import type { TileData, TileType } from './types';

// ── 空间尺度 ──
export const TILE_M = 250; // 街区边长（米）
export const TILE_AREA = TILE_M * TILE_M; // 62,500 ㎡ 毛用地
export const NET_RATIO = 0.7; // 净用地率：扣掉街坊内支路、绿地、退界后的可建比例
export const NET_AREA = TILE_AREA * NET_RATIO; // 43,750 ㎡ 可建设用地
export const FLOOR_HEIGHT = 3; // 平均层高（米），用来把层数换算成建筑高度

// 设计规模：这座城市的总体规划人口（人）。
// 用地结构、容积率分区、公共服务配置都是按「最多装 100 万人」倒推出来的，
// 所有承载量的标定都以此为目标值 —— tools/landcheck.cjs 会复核实际算出来差多少。
export const DESIGN_POP_CAP = 1_000_000;

// 住宅建筑面积占「居住用地建筑规模」的比例。
// 一个居住街坊里不只有住宅：沿街底商、社区服务中心、幼儿园、物业用房要占掉一成半，
// 国标《城市居住区规划设计标准》的配套建筑面积占比也在这个量级。
// 少了这一项，承载量会整体高估约 18%。
export const HOUSING_SHARE = 0.85;

// 人均指标（现实锚点）
export const M2_PER_PERSON = 40; // 人均住宅建筑面积 ㎡/人（2023 年城镇常住口径约 40 ㎡）
export const M2_PER_JOB_COMM = 25; // 商务楼宇每个岗位占用建筑面积（㎡/岗）
export const M2_PER_JOB_IND = 60; // 厂房每个岗位占用建筑面积（㎡/岗）
export const M2_PER_PUPIL = 9; // 生均校舍建筑面积（㎡/学位）
export const M2_PER_BED = 110; // 每床位占用建筑面积（㎡/床）

// ── 容积率（FAR）分级：1 级是村落低层，5 级是中心区高层 ──
// 取自各地《城市规划管理技术规定》的常见区间：
//   居住 ηη 0.7（低层）→ 3.6（高层住宅上限），商业最高可到 6.0，工业国标 0.8~2.0
export const FAR_TABLE: Record<TileType, number[]> = {
  empty: [0, 0, 0, 0, 0],
  residential: [0.7, 1.3, 2.0, 2.8, 3.6],
  commercial: [0.8, 1.5, 2.5, 4.0, 6.0],
  industrial: [0.6, 0.9, 1.2, 1.5, 1.8],
  school: [0.5, 0.6, 0.7, 0.8, 0.9],
  hospital: [0.8, 1.1, 1.4, 1.7, 2.1],
  power: [0.3, 0.4, 0.5, 0.6, 0.7],
  water: [0.3, 0.4, 0.5, 0.6, 0.7],
  park: [0.05, 0.05, 0.05, 0.05, 0.05],
  road: [0, 0, 0, 0, 0],
};

// ── 建筑密度（覆盖率）：建筑基底占净用地的比例 ──
// 住区高层反而密度低（塔楼点式布局留出的空地多），这是和"容积率越高越挤"直觉相反的地方。
export const COVERAGE_TABLE: Record<TileType, number[]> = {
  empty: [0, 0, 0, 0, 0],
  residential: [0.32, 0.3, 0.28, 0.25, 0.22],
  commercial: [0.4, 0.42, 0.45, 0.48, 0.5],
  industrial: [0.45, 0.5, 0.55, 0.58, 0.6],
  school: [0.25, 0.26, 0.28, 0.3, 0.3],
  hospital: [0.3, 0.32, 0.34, 0.35, 0.36],
  power: [0.3, 0.35, 0.4, 0.4, 0.4],
  water: [0.25, 0.3, 0.35, 0.35, 0.35],
  park: [0.05, 0.05, 0.05, 0.05, 0.05],
  road: [0, 0, 0, 0, 0],
};

// ── 绿地率：工业用地国标上限 20%，居住新区不低于 30% ──
export const GREEN_TABLE: Record<TileType, number[]> = {
  empty: [0.9, 0.9, 0.9, 0.9, 0.9],
  residential: [0.35, 0.32, 0.3, 0.3, 0.32],
  commercial: [0.25, 0.22, 0.2, 0.2, 0.22],
  industrial: [0.15, 0.15, 0.15, 0.15, 0.15],
  school: [0.35, 0.35, 0.35, 0.35, 0.35],
  hospital: [0.35, 0.35, 0.35, 0.35, 0.35],
  power: [0.3, 0.3, 0.3, 0.3, 0.3],
  water: [0.35, 0.35, 0.35, 0.35, 0.35],
  park: [0.85, 0.85, 0.85, 0.85, 0.85],
  road: [0.1, 0.1, 0.1, 0.1, 0.1],
};

// 道路的红线宽度与单向通行能力（设计通行能力：pcu/h）
export const ROAD_WIDTH: Record<number, number> = { 0: 0, 1: 15, 2: 30, 3: 45 };
export const ROAD_LABEL: Record<number, string> = { 0: '非道路', 1: '支路', 2: '次干道', 3: '主干道' };
export const ROAD_CAPACITY: Record<number, number> = { 0: 0, 1: 600, 2: 1600, 3: 3600 };

export const LEVEL_MIN = 1;
export const LEVEL_MAX = 5;

function pick(table: Record<TileType, number[]>, type: TileType, level: number): number {
  const row = table[type] ?? table.empty;
  const i = Math.max(0, Math.min(LEVEL_MAX - 1, Math.round(level) - 1));
  return row[i];
}

/** 容积率：建筑面积 ÷ 净用地 */
export function farOf(type: TileType, level: number): number {
  return pick(FAR_TABLE, type, level);
}

/** 建筑密度：建筑基底 ÷ 净用地 */
export function coverageOf(type: TileType, level: number): number {
  return pick(COVERAGE_TABLE, type, level);
}

/** 绿地率 */
export function greenRateOf(type: TileType, level: number): number {
  return pick(GREEN_TABLE, type, level);
}

/** 平均层数 = 容积率 ÷ 建筑密度 */
export function floorsOf(type: TileType, level: number): number {
  const cov = coverageOf(type, level);
  return cov > 0 ? farOf(type, level) / cov : 0;
}

/** 建筑限高（米） */
export function heightOf(type: TileType, level: number): number {
  return floorsOf(type, level) * FLOOR_HEIGHT;
}

/** 可建建筑面积（㎡）= 净用地 × 容积率 */
export function gfaCapOf(tile: Pick<TileData, 'type' | 'level'>): number {
  return NET_AREA * farOf(tile.type, tile.level);
}

/** 就业岗位承载上限（个）：只有商业与工业提供规模化岗位 */
export function jobCapOf(tile: Pick<TileData, 'type' | 'level'>): number {
  if (tile.type === 'commercial') return (NET_AREA * farOf(tile.type, tile.level)) / M2_PER_JOB_COMM;
  if (tile.type === 'industrial') return (NET_AREA * farOf(tile.type, tile.level)) / M2_PER_JOB_IND;
  if (tile.type === 'school') return (NET_AREA * farOf(tile.type, tile.level)) / M2_PER_PUPIL / 25; // 教职工岗
  if (tile.type === 'hospital') return (NET_AREA * farOf(tile.type, tile.level)) / M2_PER_BED * 1.4; // 医护人员岗
  return 0;
}

/** 常住人口承载上限（人）：住区按人均住宅建筑面积折算 */
export function popCapOf(tile: Pick<TileData, 'type' | 'level'>): number {
  if (tile.type !== 'residential') return 0;
  return Math.round((NET_AREA * farOf(tile.type, tile.level) * HOUSING_SHARE) / M2_PER_PERSON);
}

// ── 环带分区：控规就是按「离市中心多远」给每个街坊定指标的 ──
// 0 CBD（d<0.10）· 1 内城（<0.36）· 2 中环（<0.56）· 3 外围（<0.80）· 4 远郊（<0.98）· 5 生态绿地
export const RING_EDGES = [0.1, 0.36, 0.56, 0.8, 0.98];

/** 归一化中心距离 → 环带序号（5 = 生态绿地 / 基本农田，不参与建设） */
export function ringIndexOf(d: number): number {
  for (let i = 0; i < RING_EDGES.length; i++) if (d < RING_EDGES[i]) return i;
  return RING_EDGES.length;
}

export const RING_LABELS = ['CBD', '内城', '中环', '外围', '远郊', '生态绿地'];

// ── 控规容积率等级（法定的强度上限）──
// 现实里每个街坊的容积率上限是写进「控制性详细规划」的：
//   CBD 塔楼 FAR 6.0、内城高层住宅 FAR 2.8、中环多层 FAR 2.0、外围 FAR 1.3、远郊低层 FAR 0.7。
// 市场只能在这个上限之内加建（level ≤ planLevel），想突破得等控规调整 ——
// 这正是「城市最大承载 100 万人」这条线的物理来源：不是拍一个数，而是全城控规指标加总的结果。
export const PLAN_LEVEL_TABLE: Record<TileType, number[]> = {
  //            CBD  内城  中环  外围  远郊
  empty: [1, 1, 1, 1, 1],
  residential: [4, 4, 3, 2, 1],
  commercial: [5, 4, 3, 2, 1],
  industrial: [1, 1, 2, 2, 1],
  school: [3, 3, 3, 2, 2],
  hospital: [4, 3, 3, 2, 2],
  power: [2, 2, 2, 2, 2],
  water: [2, 2, 2, 2, 2],
  park: [1, 1, 1, 1, 1],
  road: [1, 1, 1, 1, 1],
};

// 城市规模等级（tier）对应的「当下能盖多高」上限。
// 控规给的是远景上限，眼下真能盖多高还取决于城市到了哪一步：
// 村落与集镇是低层 / 多层村舍（FAR ≤2.0），
// 中等城市才起高层住宅（≤2.8），都会区才有超高层（≤3.6）。
// 少了这道闸，村落阶段四块地就能靠容积率堆到一万人的承载量，
// 城市永远不会往外铺 —— 长到最后也只是四条街。
export const TIER_MAX_LEVEL = [3, 3, 4, 5];

/** 控规给定的容积率等级：新出让的地块按它来定强度上限 */
export function planLevelOf(type: TileType, ring: number): number {
  const row = PLAN_LEVEL_TABLE[type] ?? PLAN_LEVEL_TABLE.empty;
  return row[Math.max(0, Math.min(RING_EDGES.length - 1, ring))];
}

/** 按控规上限折算的承载量：全城铺满并建到法定上限时能装多少人 */
export function planPopCapOf(tile: Pick<TileData, 'type' | 'planLevel'>): number {
  return popCapOf({ type: tile.type, level: tile.planLevel ?? 1 });
}

export interface ServiceCap {
  label: string;
  value: number;
  unit: string;
}

/** 公共服务设施的供给能力：学校给学位、医院给床位，直接服务于 UI 的可读性 */
export function serviceCapOf(tile: Pick<TileData, 'type' | 'level'>): ServiceCap | null {
  const gfa = NET_AREA * farOf(tile.type, tile.level);
  switch (tile.type) {
    case 'school':
      return { label: '学位', value: Math.round(gfa / M2_PER_PUPIL), unit: '个' };
    case 'hospital':
      return { label: '床位', value: Math.round(gfa / M2_PER_BED), unit: '张' };
    case 'power':
      return { label: '供电能力', value: Math.round(gfa / 40), unit: 'MW' };
    case 'water':
      return { label: '供水能力', value: Math.round(gfa / 25), unit: '千吨/日' };
    default:
      return null;
  }
}

/** 单位：这里统一给出 UI 与校验脚本都能复用的‰排版 */
export function fmtWan(v: number): string {
  if (Math.abs(v) >= 100_000_000) return `${(v / 100_000_000).toFixed(2)} 亿`;
  if (Math.abs(v) >= 10_000) return `${(v / 10_000).toFixed(1)} 万`;
  return Math.round(v).toLocaleString('zh-CN');
}

/** 一格里常住户数（按户均人口折算），用于把「人口」和「住宅套数」连起来 */
export function householdsCapOf(tile: Pick<TileData, 'type' | 'level'>, householdSize: number): number {
  return Math.round(popCapOf(tile) / Math.max(0.1, householdSize));
}
