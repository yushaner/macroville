// 城市发展阶段：村落 → 村庄 → 集镇 → 小城市 → 中等城市 → 大城市 → 都会区 → 全球城市。
// 阶段不是装饰：它决定城市能铺到多远（生态红线半径）、允许呈现的地块类型，以及产业用地的供给上限。
// 升级条件同时看人口与存续月数，避免刚开局靠随机数一口气冲到顶；降级带滞后，避免抖动。
//
// 8 档细分再归入 4 个 tier（村落级/集镇级/城市级/都会级）：视角解锁与概念条件按 tier 判定，
// 这样阶段细分不会把"发展到城市"这类条件的门槛含义改掉。
//
// 人口门槛按现实口径标定（参考中国城市规模划分标准）：
//   镇 <1 万 · 小城市 <50 万 · 中等城市 50~100 万 · 大城市 100~500 万 · 特大城市 500~1000 万

import { jobCapOf, planPopCapOf, popCapOf } from './land';
import { hhScaleOf } from './scale';
import type {
  City,
  CityOrientation,
  Perspective,
  StageId,
  SimState,
  TileType,
} from './types';
import { people as fmtPeople } from '../data/units';

// 开局点亮的半径（格）：一座村落就是围着十字路口的一片村舍。
// 必须是 3 而不是 2：半径 2 只有 13 格，其中两条中轴主干道就占掉 9 格，
// 剩下 4 格里要再留出商业街角，住宅只剩一两格 —— 承载量还没有初始人口多，城市一开局就在往外赶人。
export const INITIAL_RADIUS = 3;

export interface StageDef {
  id: StageId;
  name: string;
  icon: string;
  tier: number; // 0 村落级 / 1 集镇级 / 2 城市级 / 3 都会级
  radius: number; // 建成区允许的最大半径（格）：越过这条线就是农田与生态绿地
  viewRadius: number; // 地图可视半径（格）：视野随城市长大而拉开
  allow: TileType[]; // 该阶段允许呈现的地块类型；其余用途的格子仍是荒地
  minPop: number; // 升入该阶段所需常住人口（人）
  minMonths: number; // 升入该阶段所需存续月数
  firms: number; // 该阶段应有的企业数上限（还要看有没有空余产业用地）
  perspective: Perspective | null; // 升入该阶段时新解锁的玩家视角（累计保留，不因衰退回收）
  desc: string; // 阶段风貌说明
  unlockNote: string; // 升级时提示玩家解锁了什么
}

export const STAGES: StageDef[] = [
  {
    id: 'hamlet',
    name: '村落',
    icon: '🏚',
    tier: 0,
    // 半径必须大于 INITIAL_RADIUS：两者相等的话，村落阶段一开局就把红线内的地全铺完了，
    // 住不下人时无地可征 —— 人口被卡在四五千人，永远升不到村庄。
    radius: 4,
    viewRadius: 4, // 只看见自家门口
    // 村落也有村口的小店与集市：没有商业用地的城市一家企业都落不了地，开局就会死
    allow: ['road', 'residential', 'commercial'],
    minPop: 0,
    minMonths: 0,
    firms: 40,
    perspective: 'household',
    desc: '十几户人家围着一条十字土路。房子都是一层的小院，走两步就到村口。',
    unlockNote: '开局：村舍与土路（视野 9×9）· 你是这里的居民',
  },
  {
    id: 'village',
    name: '村庄',
    icon: '🏘',
    tier: 0,
    radius: 5,
    viewRadius: 6,
    allow: ['road', 'residential', 'commercial', 'park'],
    minPop: 4_000,
    minMonths: 10,
    firms: 62,
    perspective: null,
    desc: '主街两侧开出店铺，房子翻建成二层小楼，集市成了消息与价格的集散地。',
    unlockNote: '商铺 · 街心公园（视野 13×13）',
  },
  {
    id: 'town',
    name: '集镇',
    icon: '🏙',
    tier: 1,
    radius: 8,
    viewRadius: 9,
    allow: ['road', 'residential', 'commercial', 'industrial', 'power', 'park'],
    minPop: 12_000,
    minMonths: 22,
    firms: 92,
    perspective: 'firm',
    desc: '作坊与电厂在下风向拔地而起，多层住宅沿着支路铺开，通勤第一次开始变长。',
    unlockNote: '工业区 · 电厂 · 开启「企业视角」（视野 19×19）',
  },
  {
    id: 'smallCity',
    name: '小城市',
    icon: '🌉',
    tier: 1,
    radius: 11,
    viewRadius: 12,
    allow: ['road', 'residential', 'commercial', 'industrial', 'power', 'water', 'park'],
    minPop: 40_000,
    minMonths: 38,
    firms: 124,
    perspective: null,
    desc: '自来水厂在上风向落成，第一条环路开始成形，公共服务第一次成为"可以拧的旋钮"。',
    unlockNote: '水厂 · 市政管网（视野 25×25）',
  },
  {
    id: 'midCity',
    name: '中等城市',
    icon: '🌆',
    tier: 2,
    radius: 14,
    viewRadius: 15,
    allow: ['road', 'residential', 'commercial', 'industrial', 'power', 'water', 'school', 'park'],
    minPop: 100_000,
    minMonths: 58,
    firms: 158,
    perspective: 'gov',
    desc: '学校按服务半径铺开，人力资本开始反哺生产率。你可以站到治理者的位置上了。',
    unlockNote: '学校 · 开启「政府视角」（视野 31×31）',
  },
  {
    id: 'bigCity',
    name: '大城市',
    icon: '🌃',
    tier: 2,
    radius: 17,
    viewRadius: 18,
    allow: [
      'road', 'residential', 'commercial', 'industrial',
      'power', 'water', 'school', 'hospital', 'park',
    ],
    minPop: 220_000,
    minMonths: 82,
    firms: 196,
    perspective: null,
    desc: '医院入网、主干道成环，公共服务覆盖率成为影响满意度与人口去留的关键项。',
    unlockNote: '医院 · 二环路（视野 37×37）',
  },
  {
    id: 'metropolis',
    name: '都会区',
    icon: '🌇',
    tier: 3,
    radius: 21,
    viewRadius: 22,
    allow: [
      'road', 'residential', 'commercial', 'industrial',
      'power', 'water', 'school', 'hospital', 'park',
    ],
    minPop: 450_000,
    minMonths: 110,
    firms: 240,
    perspective: null,
    desc: '连绵建成区吞掉了绿带边缘。规模带来集聚红利，也带来拥堵与生活成本。',
    unlockNote: '集聚效应 · 规模经济（视野 45×45）',
  },
  {
    id: 'globalCity',
    name: '全球城市',
    icon: '🛰',
    tier: 3,
    radius: 25, // 铺到生态绿带为止，不糊满整张图
    viewRadius: 27, // 全图取景
    allow: [
      'road', 'residential', 'commercial', 'industrial',
      'power', 'water', 'school', 'hospital', 'park',
    ],
    minPop: 820_000,
    minMonths: 145,
    firms: 280,
    perspective: null,
    desc: '资金、人才与货物在这里交汇。你的每一个参数，都会被整张网络放大。',
    unlockNote: '全境开发 · 全球分工（视野全开）',
  },
];

// tier 名称：概念解锁条件里的「城市发展到 X」按 tier 判定
export const TIER_NAMES = ['村落级', '集镇级', '城市级', '都会级'];

// 降级滞后：人口跌到门槛的这个比例以下才真正降级，避免在门槛附近反复横跳
const DOWNGRADE_RATIO = 0.85;

export function stageIndex(id: StageId): number {
  const i = STAGES.findIndex((s) => s.id === id);
  return i < 0 ? 0 : i;
}

export function stageById(id: StageId): StageDef {
  return STAGES[stageIndex(id)];
}

export function nextStageOf(id: StageId): StageDef | null {
  const i = stageIndex(id);
  return i < STAGES.length - 1 ? STAGES[i + 1] : null;
}

/** 住宅供给侧空缺率：超过阈值就该外扩 / 提高容积率了 */
export interface CapacityStats {
  popRes: number; // 住区里的常住人口
  capRes: number; // 住区承载上限（人）
  occupancy: number; // 入住率
  headroom: number; // 还能住进来多少人
  resTiles: number;
}

export function residentialCapacity(city: City): CapacityStats {
  let popRes = 0;
  let capRes = 0;
  let resTiles = 0;
  for (const t of city.tiles) {
    if (!t.developed || t.type !== 'residential') continue;
    resTiles++;
    const cap = popCapOf(t);
    capRes += cap;
    popRes += Math.min(t.pop, cap);
  }
  return {
    popRes,
    capRes,
    occupancy: capRes > 0 ? popRes / capRes : 0,
    headroom: Math.max(0, capRes - popRes),
    resTiles,
  };
}

/** 全城住区承载上限（含尚未开发的规划居住用地）：设计目标是铺满加略高 ξέφ ≈ 110 万人 */
export function totalResidentialPlan(city: City): number {
  let cap = 0;
  for (const t of city.tiles) {
    if (t.type !== 'residential') continue;
    cap += popCapOf(t);
  }
  return cap;
}

// 企业数量由「要养活多少人」决定，而不是由阶段硬编码：
// 每家代表性企业平均提供 22 个岗位，够把 95% 的劳动力安置上，市场就饱和了。
// 阶段的 firms 字段只是上限（一个城市的产业用地也有自己的天花板）。
export const JOBS_PER_FIRM = 22;

export function targetFirms(stage: StageDef, samples: number): number {
  const need = Math.ceil((samples * 0.95) / JOBS_PER_FIRM);
  return Math.max(10, Math.min(stage.firms, need));
}

/**
 * 实际招商目标：除了劳动力需要的岗位，还要看空着的铺面。
 * 一个街区的岗位指标只有落在上面的企业才用得上 —— 商业用地批出来了却没人开业，
 * 这块地的岗位就等于零，城市会卡在「人人有活干、但一个外人也进不来」的假充分就业上。
 */
export function firmQuota(state: SimState, stage: StageDef): number {
  const byDemand = targetFirms(stage, state.households.length);
  const room = vacantFirmTiles(state).length;
  return Math.max(10, Math.min(stage.firms, byDemand + room));
}

// 阶段对应的 tier（概念解锁条件与视角解锁都按 tier 判定）
export function stageTier(id: StageId): number {
  return stageById(id).tier;
}

// 当前 tier：按历史最高阶段取，避免城市一衰退就把概念锁回去
export function currentTier(state: SimState): number {
  return stageTier(state.peakStage ?? state.stage);
}

// 常住人口（人）：由各地块的实际人口加总，代表与现实的城市 Census 同口径
export function populationOf(state: SimState): number {
  let pop = 0;
  for (const t of state.city.tiles) pop += t.pop;
  return Math.round(pop);
}

// 判定当前应处阶段（含降级滞后）
export function evaluateStage(state: SimState): StageId {
  const pop = populationOf(state); // 常住人口（人），与 STAGES.minPop 同口径
  const months = state.month;
  let idx = 0;
  for (let i = STAGES.length - 1; i >= 0; i--) {
    const s = STAGES[i];
    if (pop >= s.minPop && months >= s.minMonths) {
      idx = i;
      break;
    }
  }
  const cur = stageIndex(state.stage);
  // 已在更高阶段：只有明显跌破门槛才回落
  if (cur > idx) {
    const s = STAGES[cur];
    if (pop >= s.minPop * DOWNGRADE_RATIO) idx = cur;
  }
  return STAGES[idx].id;
}

export interface StageProgress {
  cur: StageDef;
  next: StageDef | null;
  ratio: number; // 0-1，通往下一阶段的完成度
  pop: number;
  months: number;
  popHint: string; // 「还需 X 万人」
}

export function stageProgress(state: SimState): StageProgress {
  const cur = stageById(state.stage);
  const next = nextStageOf(state.stage);
  const pop = populationOf(state);
  const months = state.month;
  const txt = next ? `还需 ${fmtPeople(Math.max(0, next.minPop - pop))}` : '已到顶';
  if (!next) return { cur, next: null, ratio: 1, pop, months, popHint: txt };
  const popSpan = Math.max(1, next.minPop - cur.minPop);
  const monSpan = Math.max(1, next.minMonths - cur.minMonths);
  const popRatio = (pop - cur.minPop) / popSpan;
  const monRatio = (months - cur.minMonths) / monSpan;
  const ratio = Math.max(0, Math.min(1, Math.min(popRatio, monRatio)));
  return { cur, next, ratio, pop, months, popHint: txt };
}

// —— 城市扩张 ——
// 城市的土地不再「按阶段一次性点亮」，而是顺着路网一圈一圈往外长：
//   住不下人（入住率超高）→ 有压力 → 先把旁边的路打通 → 再批一块住宅用地。
// 这样地图上的建成区形状和真实城市的蔓延一样是不规则的，
// 而且你调的每一个政策（刺激人口流入 or 抑制）都会真实反映在城市边界推进的速度上。
const GROW_TRIGGER = 0.86; // 入住率超过这个阈值就开始征新的地
// 月度供地指标随城市规模放大：村落一个月批不了几块地，都会区一年的土地指标抵得上村落几十年。
// 固定成常数的话，后期每月 8 格根本铺不完两千多格建设用地，城市长不到百万人口就到头了。
const growBudgetOf = (stage: StageDef): number => 2 + stageIndex(stage.id) * 3;
const DEV_FRONT_P = 0.75; // 优先开发「临已建成」的地块的比例
const LABOR_PART_REF = 0.9; // 劳动力参与率参考值：估算岗位需求用
// 岗位用地余量：产业用地能提供的岗位要超出劳动力这么多，企业才有扩招的余地。
// 没有余量就是「人人有活干但招不到新人」，城市会卡死在假充分就业上。
const JOB_LAND_SLACK = 1.25;

/** 初始点亮：以城市原点为中心的一小片（村落） */
export function developCityAround(city: City, ox: number, oy: number, radius: number): number {
  let added = 0;
  for (let y = 0; y < city.height; y++) {
    for (let x = 0; x < city.width; x++) {
      const i = y * city.width + x;
      const t = city.tiles[i];
      if (t.developed) continue;
      if (t.type === 'empty') continue;
      if (Math.hypot(x - ox, y - oy) > radius) continue;
      t.developed = true;
      added++;
    }
  }
  return added;
}

// 判断某格是否可以出让：规划用途 ∈ 阶段允许、未建成、在生态红线内
function canDevelop(city: City, i: number, stage: StageDef): boolean {
  const t = city.tiles[i];
  if (t.developed || t.type === 'empty') return false;
  if (!stage.allow.includes(t.type)) return false;
  const x = i % city.width;
  const y = Math.floor(i / city.width);
  return Math.hypot(x - city.originX, y - city.originY) <= stage.radius;
}

function neighbors(city: City, i: number): number[] {
  const W = city.width;
  const H = city.height;
  const x = i % W;
  const y = Math.floor(i / W);
  const out: number[] = [];
  if (x > 0) out.push(i - 1);
  if (x < W - 1) out.push(i + 1);
  if (y > 0) out.push(i - W);
  if (y < H - 1) out.push(i + W);
  return out;
}

/**
 * 按住宅压力扩张建成区。
 * @returns 本月新出让的地块数
 */
export function growCity(state: SimState, stage: StageDef): number {
  const city = state.city;
  const stats = residentialCapacity(city);
  if (stats.resTiles === 0) return developCityAround(city, city.originX, city.originY, stage.radius);

  // 征地有两条压力来源，缺一条都会让城市卡死：
  //   ① 住不下人（入住率超高）—— 住宅用地不够了
  //   ② 企业找不到落脚的地 —— 想开公司的人排着队，却没有铺面和厂房可租
  // 只看 ① 的话，早期村落房子大量空置、入住率永远上不去，城市就永远不征地、
  // 也就永远拿不到新的商业用地、永远提供不了岗位 —— 人口一路被失业率推走。
  // ② 的另一半是「产业用地紧张度」：现有产业用地按容积率能提供的岗位，
  //    够不够安置全城劳动力、还留出企业招工的余量。
  //
  //    只看「有没有空闲铺面」是不够的：一个街区的岗位指标会被上面的几家企业分光，
  //    铺面看着还空着，可每家企业都被自己的用地指标卡住，岗位总量已经到顶 ——
  //    城市会停在「人人有活干、但一个外人也进不来」的假充分就业状态上。
  //    这就是为什么城市长到两万五千人就不动了：不是没人来，是没有地方给他们上班。
  const scale = Math.max(0.05, hhScaleOf(state));
  let jobLandSample = 0;
  for (const t of city.tiles) {
    if (!t.developed) continue;
    if (t.type !== 'commercial' && t.type !== 'industrial') continue;
    jobLandSample += jobCapOf(t) / scale;
  }
  const laborSample = Math.max(1, state.households.length) * LABOR_PART_REF;
  const landTight = jobLandSample < laborSample * JOB_LAND_SLACK;

  const wantFirms = Math.max(0, targetFirms(stage, state.households.length) - state.firms.length);
  const vacant = vacantFirmTiles(state).length;
  const housingPressure = stats.occupancy >= GROW_TRIGGER;
  const landPressure = landTight || (wantFirms > 0 && vacant < Math.min(wantFirms, 2));
  if (!housingPressure && !landPressure) return 0;

  // 需要补多少格地：住宅按「本月想吸纳的人口 / 一级住宅每格能装多少人」算，
  // 产业用地按「排队等着开业的企业数」算，最后封顶在月度供地指标上。
  const perTile = popCapOf({ type: 'residential', level: 1 });
  const inflow = stats.popRes * 0.06; // 目标：给本月约 6% 的人口增量备地
  const needHousing = Math.ceil(inflow / Math.max(1, perTile));
  const needLand = landTight ? Math.min(Math.max(2, wantFirms), 4) : 0;
  // 住得越满，征地越急：入住率刚过阈值时慢慢补，快撑破了就把当月指标用满。
  // 只按「本月新增人口」算的话，入住率一旦到 100% 人口就停止增长，
  // 而每月只补一格地，城市要几百年才铺得开。
  const urgency = (stats.occupancy - GROW_TRIGGER) / Math.max(0.01, 1 - GROW_TRIGGER);
  const want = Math.min(
    growBudgetOf(stage),
    Math.max(
      1,
      needLand,
      housingPressure ? Math.max(needHousing, Math.ceil(growBudgetOf(stage) * urgency)) : needHousing,
    ),
  );

  let added = 0;
  for (let n = 0; n < want; n++) {
    const pick = pickFrontier(city, stage, state.seed + state.month * 131 + n, landTight);
    if (pick === null) break;
    // 先把地块四周的路打通：现实中这也是"三通一平"的第一步
    for (const j of neighbors(city, pick)) {
      const nt = city.tiles[j];
      if (!nt.developed && nt.type === 'road' && canDevelop(city, j, stage)) {
        nt.developed = true;
        added++;
      }
    }
    city.tiles[pick].developed = true;
    city.tiles[pick].level = 1;
    added++;
  }
  return added;
}

// 挑一块待出让的地：靠近已建成区、临路、且离市中心近的优先。
// 三项里掺随机，避免城市长成一个完美的同心圆（真实城市的边界是狗牙状的）。
function pickFrontier(
  city: City,
  stage: StageDef,
  rndSeed: number,
  preferFirmLand = false,
): number | null {
  const W = city.width;
  const H = city.height;
  let best: number | null = null;
  let bestScore = -1e9;
  // 每格一个「噪声」：同一格里每个月会因为整体随机相位不同而沾不同的运气，
  // 城市边界因此长成狗牙状而不是同心圆（真实城市的边界向来如此）。
  const noise = (seedMix: number): number => {
    let a = (rndSeed ^ Math.imul(seedMix, 0x9e3779b1)) >>> 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  // 为了不至于每次都扫全图，只在建成区外接壤处找候选
  const seen = new Set<number>();
  const queue: number[] = [];
  for (let i = 0; i < city.tiles.length; i++) {
    if (!city.tiles[i].developed || city.tiles[i].type === 'empty') continue;
    queue.push(i);
  }
  if (queue.length === 0) return null;
  for (const i of queue) {
    const x = i % W;
    const y = Math.floor(i / W);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen.has(j)) continue;
        seen.add(j);
        if (!canDevelop(city, j, stage)) continue;
        const t = city.tiles[j];
        // 住宅需求优先：当前缺房子时， residential 的分最高
        const typeBonus = t.type === 'residential' ? 3.2 : t.type === 'commercial' ? 1.6 : 0.4;
        let adjDev = 0;
        let adjRoad = 0;
        for (const k of neighbors(city, j)) {
          const nt = city.tiles[k];
          if (nt.developed) adjDev++;
          if (nt.type === 'road' && nt.developed) adjRoad++;
        }
        const dist = Math.hypot(nx - city.originX, ny - city.originY);
        const score =
          typeBonus +
          adjDev * 1.1 +
          adjRoad * 0.8 -
          dist * 0.06 +
          noise(j) * DEV_FRONT_P * 4;
        if (score > bestScore) {
          bestScore = score;
          best = j;
        }
      }
    }
  }
  return best;
}

// —— 城市定位：政策组合长期偏向某一侧，城市会长成不同的样子 ——
// 定位不是玩家点的按钮，而是"你一直拧哪些旋钮"涌现出来的结果。
export interface OrientationInfo {
  id: CityOrientation;
  name: string;
  icon: string;
  desc: string;
}

export const ORIENTATIONS: OrientationInfo[] = [
  { id: 'industrial', name: '工业型', icon: '🏭', desc: '产业补贴长期偏高，工厂与就业岗位堆起来，代价是污染与拥挤。' },
  { id: 'commercial', name: '商贸型', icon: '🛒', desc: '贸易开放度高，商业地块繁荣、物价随外部需求波动。' },
  { id: 'tech', name: '科创型', icon: '🔬', desc: '研发补贴持续投入，生产率与工资爬升，但短期利润被摊薄。' },
  { id: 'eco', name: '宜居型', icon: '🌳', desc: '公共支出高、工业弱，公共服务与满意度领先，增长偏慢。' },
  { id: 'balanced', name: '均衡型', icon: '⚖️', desc: '各项政策都没走极端，城市按自己的节奏长成综合型。' },
];

export function orientationInfo(id: CityOrientation): OrientationInfo {
  return ORIENTATIONS.find((o) => o.id === id) ?? ORIENTATIONS[ORIENTATIONS.length - 1];
}

// 用「玩家拧到过的旋钮极值」判定定位：看长期偏好，而不是某个月的临时值
export function evaluateOrientation(state: SimState): CityOrientation {
  const g = state.gov;
  const ind = g.industrySubsidy ?? 0;
  const edu = g.eduSubsidy ?? 0;
  const trade = g.tradeOpenness ?? 0;
  const pub = g.publicSpend ?? 0;
  // 只有"真的拧了某一侧"才算数：没投产业补贴不等于搞生态，
  // 早期版本把 (1-industrySubsidy) 计进生态分，导致每座城市开局就被判成宜居型。
  const welfare = g.welfare ?? 0;
  const scores: { id: CityOrientation; v: number }[] = [
    { id: 'industrial', v: ind * 2.5 + (1 - pub) * 0.4 },
    { id: 'commercial', v: trade * 2.5 },
    { id: 'tech', v: edu * 2.5 },
    { id: 'eco', v: pub * 1.8 + welfare * 1.6 },
  ];
  scores.sort((a, b) => b.v - a.v);
  const top = scores[0];
  // 领先不明显就还是均衡型：定位必须真的是"长期偏向某一侧"才成立
  return top.v >= 0.95 ? top.id : 'balanced';
}

// —— 视角渐进解锁：个人 → 企业 → 政府 ——
// 按「历史最高 tier」判定，城市衰退时不会把已解锁的视角收回。
export function unlockedPerspectives(state: SimState): Perspective[] {
  const tier = currentTier(state);
  const out: Perspective[] = [];
  for (const s of STAGES) {
    if (s.tier > tier) continue;
    const p = s.perspective;
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

export function isPerspectiveUnlocked(state: SimState, p: Perspective): boolean {
  return unlockedPerspectives(state).includes(p);
}

// 某视角是在哪个阶段解锁的（用于给未解锁 tab 显示解锁条件）
export function perspectiveGate(p: Perspective): StageDef | null {
  return STAGES.find((s) => s.perspective === p) ?? null;
}

// 已建成且为指定用途的地块
export function developedTilesOfType(city: City, ...types: TileType[]): number[] {
  const set = new Set(types);
  const out: number[] = [];
  for (let i = 0; i < city.tiles.length; i++) {
    const tile = city.tiles[i];
    if (tile.developed && set.has(tile.type)) out.push(i);
  }
  return out;
}

/**
 * 还能再进企业的产业用地。
 * 一个街区不是只能落一家公司 —— 写字楼和产业园里几十家企业共用一栋楼，
 * 所以这里按「这块地的岗位指标 ÷ 一家代表性企业的平均规模」算出租位上限，
 * 只把已经坐满的地块排除掉。
 */
export function vacantFirmTiles(state: SimState): number[] {
  const city = state.city;
  const scale = Math.max(0.05, hhScaleOf(state));
  const used = new Map<number, number>();
  for (const f of state.firms) used.set(f.tile, (used.get(f.tile) ?? 0) + 1);
  const out: number[] = [];
  for (let i = 0; i < city.tiles.length; i++) {
    const t = city.tiles[i];
    if (!t.developed) continue;
    if (t.type !== 'commercial' && t.type !== 'industrial') continue;
    const cap = jobCapOf(t) / scale;
    const slots = Math.max(2, Math.floor(cap / JOBS_PER_FIRM));
    if ((used.get(i) ?? 0) >= slots) continue;
    out.push(i);
  }
  return out;
}

/** 已建成地块数（格）：乘以每格毛用地就是建成区面积，愿景看板与校验脚本共用 */
export function developedTileCount(city: City): number {
  let n = 0;
  for (const t of city.tiles) if (t.developed) n++;
  return n;
}
