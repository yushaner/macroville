// 解锁条件引擎。
//
// 之前名词是「到第 N 个月自动解锁」——玩家挂机就能刷满图谱，既没挑战也没关联感。
// 现在每个名词带一条 Requirement：它同时看两件事——
//   ① 玩家亲手做过什么（把税率拧到 40% 以上？把公共支出拉满？）；
//   ② 这些决策把城市带成了什么样（CPI 冲上 105？财政翻负？失业率站上 10%？）。
// 条件对象全是纯数据（无函数），因此可以直接 JSON 序列化，预览页与真实工程共用同一套判定。

import { CONFIG } from './config';
import { currentTier } from './stages';
import { tileSummary } from './tiles';
import { landPrice, people, yuan } from '../data/units';
import { PHASE_META } from './businessCycle';
import type { CityOrientation, CyclePhase, SimState } from './types';

// ── 可在条件里比较的数值量 ──
// 后半段是「个体涌现量」：企业破产、贫困家庭占比、最高地价、岗位空缺率……
// 这些不是宏观平均值，而是无数个体博弈跑出来的结果——同一个开局参数，
// 不同随机种子会涌现出不一样的故事，概念也就在不同的时刻被点亮。
export type NumField =
  | 'month'
  | 'population'
  | 'employmentRate'
  | 'unemploymentRate'
  | 'avgWage'
  | 'cpi'
  | 'gdp'
  | 'treasury'
  | 'gini'
  | 'happiness'
  | 'firms'
  | 'pollution'
  | 'amenity'
  | 'landValue'
  | 'builtTiles'
  | 'bankruptcies'
  | 'poorShare'
  | 'maxLandValue'
  | 'vacancyRate'
  | 'lossFirmShare'
  | 'wealthTop10'
  // —— 经济周期 ——
  | 'cycleIndex'
  | 'outputGap'
  | 'cycles';

export const NUM_FIELDS: NumField[] = [
  'month', 'population', 'employmentRate', 'unemploymentRate', 'avgWage',
  'cpi', 'gdp', 'treasury', 'gini', 'happiness', 'firms',
  'pollution', 'amenity', 'landValue', 'builtTiles',
  'bankruptcies', 'poorShare', 'maxLandValue', 'vacancyRate', 'lossFirmShare', 'wealthTop10',
  'cycleIndex', 'outputGap', 'cycles',
];

// ── 判定上下文：当前状态 + 玩家痕迹 ──
export interface Ctx {
  month: number;
  population: number;
  employmentRate: number;
  unemploymentRate: number;
  avgWage: number;
  cpi: number;
  gdp: number;
  treasury: number;
  gini: number;
  happiness: number;
  firms: number;
  pollution: number; // 城市平均污染 0-1
  amenity: number; // 城市平均公共服务 0-1
  landValue: number; // 城市平均地价
  builtTiles: number; // 已建成地块数
  // —— 个体涌现量 ——
  bankruptcies: number; // 累计倒闭企业数
  poorShare: number; // 储蓄撑不过 1 个月开销的家庭占比
  maxLandValue: number; // 全城最高地块单价（地块之间的分化）
  vacancyRate: number; // 岗位空缺率
  lossFirmShare: number; // 亏损企业占比
  wealthTop10: number; // 最富 10% 家庭占有的储蓄份额
  // —— 经济周期 ——
  cycleIndex: number; // -1..1 合成周期指数
  outputGap: number; // 产出缺口，负=资源闲置
  cycles: number; // 已走完的完整周期数
  cyclePhase: CyclePhase; // 当前所处阶段
  cyclePhaseMonths: number; // 当前阶段已持续月数
  stageIdx: number; // 历史最高 tier：0村落级 1集镇级 2城市级 3都会级
  round: number; // 当前循环轮次
  orientation: CityOrientation; // 当前城市定位
  levers: Record<string, number>; // 各杠杆当前值
  leverMax: Record<string, number>; // 玩家曾经拧到的最高值
  leverMin: Record<string, number>; // 玩家曾经拧到的最低值
  peak: Record<string, number>; // 各项历史最高
  trough: Record<string, number>; // 各项历史最低
  streak: Record<string, number>; // 连续满足某条件的月数
}

// ── 条件表达式 ──
export type Req =
  | { k: 'month'; n: number } // 存续满 n 个月
  | { k: 'stage'; n: number } // 历史最高阶段 ≥ n
  | { k: 'gt'; f: NumField; v: number } // 当前值 ≥ v
  | { k: 'lt'; f: NumField; v: number } // 当前值 ≤ v
  | { k: 'peak'; f: NumField; v: number } // 历史上曾经 ≥ v
  | { k: 'trough'; f: NumField; v: number } // 历史上曾经 ≤ v
  | { k: 'lever'; id: string; op: '>=' | '<='; v: number } // 当前旋钮值
  | { k: 'leverEver'; id: string; op: '>=' | '<='; v: number } // 你曾经拧到过
  | { k: 'streak'; id: string; cond: Req; n: number } // 连续 n 个月满足
  | { k: 'round'; n: number } // 进入第 n 轮循环（概念按轮次逐层深化）
  | { k: 'orient'; v: CityOrientation } // 城市被你带成了某种定位
  | { k: 'phase'; v: CyclePhase } // 经济正处在周期的某个阶段
  | { k: 'all'; of: Req[] }
  | { k: 'any'; of: Req[] };

// ── 写条件用的糖（定义在 glossary 里让 90 条名词读起来像句子）──
export const M = (n: number): Req => ({ k: 'month', n });
export const STG = (n: number): Req => ({ k: 'stage', n });
export const GT = (f: NumField, v: number): Req => ({ k: 'gt', f, v });
export const LT = (f: NumField, v: number): Req => ({ k: 'lt', f, v });
export const PEAK = (f: NumField, v: number): Req => ({ k: 'peak', f, v });
export const TROUGH = (f: NumField, v: number): Req => ({ k: 'trough', f, v });
export const LEV = (id: string, op: '>=' | '<=' = '>=', v: number): Req => ({ k: 'lever', id, op, v });
export const EVER = (id: string, op: '>=' | '<=' = '>=', v: number): Req => ({ k: 'leverEver', id, op, v });
export const KEEP = (id: string, cond: Req, n: number): Req => ({ k: 'streak', id, cond, n });
export const ROUND = (n: number): Req => ({ k: 'round', n });
export const ORIENT = (v: CityOrientation): Req => ({ k: 'orient', v });
export const PHASE = (v: CyclePhase): Req => ({ k: 'phase', v });
export const ALL = (...of: Req[]): Req => ({ k: 'all', of });
export const ANY = (...of: Req[]): Req => ({ k: 'any', of });

// ── 文案：字段名 / 格式化 / 旋钮名 ──
const FIELD_LABEL: Record<NumField, string> = {
  month: '存续月数',
  population: '人口',
  employmentRate: '就业率',
  unemploymentRate: '失业率',
  avgWage: '平均工资',
  cpi: 'CPI',
  gdp: 'GDP',
  treasury: '财政余额',
  gini: '基尼系数',
  happiness: '幸福度',
  firms: '企业数',
  pollution: '平均污染',
  amenity: '公共服务水平',
  landValue: '平均地价',
  builtTiles: '建成地块',
  bankruptcies: '累计倒闭企业',
  poorShare: '入不敷出家庭占比',
  maxLandValue: '最高地块单价',
  vacancyRate: '岗位空缺率',
  lossFirmShare: '亏损企业占比',
  wealthTop10: '最富 10% 财富份额',
  cycleIndex: '景气指数',
  outputGap: '产出缺口',
  cycles: '完整周期数',
};

export const STAGE_NAMES = ['村落级', '集镇级', '城市级', '都会级'];

export const ORIENT_NAMES: Record<CityOrientation, string> = {
  balanced: '均衡型',
  industrial: '工业型',
  commercial: '商贸型',
  tech: '科创型',
  eco: '宜居型',
};

// 百分比类字段统一按 % 展示，其余按整数
const PERCENT_FIELDS = new Set<NumField>([
  'employmentRate', 'unemploymentRate', 'gini', 'pollution', 'amenity',
  'poorShare', 'vacancyRate', 'lossFirmShare', 'wealthTop10', 'outputGap',
]);

export function fmtField(f: NumField, v: number): string {
  if (PERCENT_FIELDS.has(f)) return `${(v * 100).toFixed(v < 0.02 ? 1 : 0)}%`;
  if (f === 'month' || f === 'builtTiles' || f === 'firms') return `${Math.round(v)}`;
  if (f === 'bankruptcies') return `${Math.round(v)} 家`;
  if (f === 'cycleIndex') return v.toFixed(2);
  if (f === 'cycles') return `${Math.round(v)} 轮`;
  if (f === 'avgWage' || f === 'landValue' || f === 'maxLandValue') return v.toFixed(1);
  if (f === 'happiness') return v.toFixed(1);
  if (f === 'cpi') return v.toFixed(1);
  if (Math.abs(v) >= 10000) return `${(v / 10000).toFixed(1)} 万`;
  return v.toFixed(0);
}

// 旋钮名与量纲（与 levers.ts 的 id 保持一致）
const LEVER_LABEL: Record<string, { name: string; pct?: boolean; mult?: boolean }> = {
  taxRate: { name: '税率', pct: true },
  minWage: { name: '最低工资' },
  publicSpend: { name: '公共支出', pct: true },
  industrySubsidy: { name: '产业补贴', pct: true },
  eduSubsidy: { name: '研发补贴', pct: true },
  tradeOpenness: { name: '贸易开放度', pct: true },
  welfare: { name: '福利支出', pct: true },
  savingsRate: { name: '储蓄率', pct: true },
  consumptionPropensity: { name: '消费倾向', pct: true },
  laborParticipation: { name: '劳动力参与率', pct: true },
  skillInvest: { name: '技能投入', pct: true },
  riskAppetite: { name: '风险偏好', pct: true },
  markup: { name: '加价率', pct: true },
  wageMultiplier: { name: '工资出价', mult: true },
  expansion: { name: '扩产意愿', pct: true },
  rdInvest: { name: '研发投入', pct: true },
  inventoryStrategy: { name: '库存策略', pct: true },
};

export function fmtLever(id: string, v: number): string {
  const m = LEVER_LABEL[id];
  if (!m) return v.toFixed(2);
  if (m.mult) return `${v.toFixed(2)} 倍`;
  if (m.pct) return `${(v * 100).toFixed(0)}%`;
  return v.toFixed(0);
}

function leverName(id: string): string {
  return LEVER_LABEL[id]?.name ?? id;
}

// ── 求值 ──
function cmp(op: '>=' | '<=', a: number, b: number): boolean {
  return op === '>=' ? a >= b : a <= b;
}

export function reqMet(req: Req, ctx: Ctx): boolean {
  switch (req.k) {
    case 'month':
      return ctx.month >= req.n;
    case 'stage':
      return ctx.stageIdx >= req.n;
    case 'gt':
      return (ctx[req.f] as number) >= req.v;
    case 'lt':
      return (ctx[req.f] as number) <= req.v;
    case 'peak':
      return (ctx.peak[req.f] ?? (ctx[req.f] as number)) >= req.v;
    case 'trough':
      return (ctx.trough[req.f] ?? (ctx[req.f] as number)) <= req.v;
    case 'lever': {
      const v = ctx.levers[req.id];
      if (v === undefined) return false;
      return cmp(req.op, v, req.v);
    }
    case 'leverEver': {
      const v = req.op === '>=' ? ctx.leverMax[req.id] : ctx.leverMin[req.id];
      if (v === undefined) return false;
      return cmp(req.op, v, req.v);
    }
    case 'streak':
      return (ctx.streak[req.id] ?? 0) >= req.n && reqMet(req.cond, ctx);
    case 'round':
      return ctx.round >= req.n;
    case 'orient':
      return ctx.orientation === req.v;
    case 'phase':
      return ctx.cyclePhase === req.v;
    case 'all':
      return req.of.every((r) => reqMet(r, ctx));
    case 'any':
      return req.of.some((r) => reqMet(r, ctx));
    default:
      return false;
  }
}

// ── 条件文案（未解锁时告诉玩家「要做什么」）──
export function reqText(req: Req): string {
  switch (req.k) {
    case 'month':
      return req.n <= 0 ? '开局即可见' : `城市存续满 ${req.n} 个月`;
    case 'stage':
      return `城市发展到${STAGE_NAMES[req.n]}`;
    case 'round':
      return `进入第 ${req.n} 轮循环`;
    case 'orient':
      return `把城市带成「${ORIENT_NAMES[req.v]}」定位`;
    case 'phase':
      return `经济进入周期的「${PHASE_META[req.v].name}」阶段`;
    case 'gt':
      return `${FIELD_LABEL[req.f]} 达到 ${fmtField(req.f, req.v)} 以上`;
    case 'lt':
      return `${FIELD_LABEL[req.f]} 降到 ${fmtField(req.f, req.v)} 以下`;
    case 'peak':
      return `让 ${FIELD_LABEL[req.f]} 冲到过 ${fmtField(req.f, req.v)}`;
    case 'trough':
      return `让 ${FIELD_LABEL[req.f]} 跌到过 ${fmtField(req.f, req.v)}`;
    case 'lever':
      return `把「${leverName(req.id)}」保持在 ${fmtLever(req.id, req.v)} ${req.op === '>=' ? '以上' : '以下'}`;
    case 'leverEver':
      return `亲手把「${leverName(req.id)}」调到 ${fmtLever(req.id, req.v)} ${req.op === '>=' ? '以上' : '以下'}`;
    case 'streak':
      return `${reqText(req.cond)}，并连续维持 ${req.n} 个月`;
    case 'all':
      return req.of.map(reqText).join('，且');
    case 'any':
      return req.of.map(reqText).join(' 或 ');
    default:
      return '达成特定条件';
  }
}

// 第一个还没满足的叶子条件（用于给玩家显示「当前差多少」）
function firstUnmet(req: Req, ctx: Ctx): Req | null {
  if (reqMet(req, ctx)) return null;
  if (req.k === 'all') {
    for (const r of req.of) {
      const u = firstUnmet(r, ctx);
      if (u) return u;
    }
    return req;
  }
  if (req.k === 'any') return req;
  return req;
}

export function reqHint(req: Req, ctx: Ctx): string {
  const leaf = firstUnmet(req, ctx) ?? req;
  const base = reqText(leaf);
  switch (leaf.k) {
    case 'gt':
    case 'lt':
      return `${base}（当前 ${fmtField(leaf.f, ctx[leaf.f] as number)}）`;
    case 'peak':
      return `${base}（历史最高 ${fmtField(leaf.f, ctx.peak[leaf.f] ?? (ctx[leaf.f] as number))}）`;
    case 'trough':
      return `${base}（历史最低 ${fmtField(leaf.f, ctx.trough[leaf.f] ?? (ctx[leaf.f] as number))}）`;
    case 'month':
      return `${base}（当前第 ${ctx.month} 个月）`;
    case 'stage':
      return `${base}（当前${STAGE_NAMES[ctx.stageIdx]}）`;
    case 'round':
      return `${base}（当前第 ${ctx.round} 轮）`;
    case 'orient':
      return `${base}（当前「${ORIENT_NAMES[ctx.orientation]}」）`;
    case 'phase':
      return `${base}（当前「${PHASE_META[ctx.cyclePhase].name}」，已 ${ctx.cyclePhaseMonths} 个月）`;
    case 'lever':
      return `${base}（当前 ${fmtLever(leaf.id, ctx.levers[leaf.id] ?? 0)}）`;
    case 'leverEver': {
      const v = leaf.op === '>=' ? ctx.leverMax[leaf.id] : ctx.leverMin[leaf.id];
      return v === undefined
        ? `${base}（你还没动过这个旋钮）`
        : `${base}（你调到过 ${fmtLever(leaf.id, v)}）`;
    }
    case 'streak':
      return `${reqText(leaf.cond)}（已连续 ${ctx.streak[leaf.id] ?? 0} / ${leaf.n} 个月）`;
    default:
      return base;
  }
}

// 0-1 完成度（给图谱胶囊画进度用）
export function reqProgress(req: Req, ctx: Ctx): number {
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  switch (req.k) {
    case 'month':
      return clamp01(req.n <= 0 ? 1 : ctx.month / req.n);
    case 'stage':
      return clamp01((ctx.stageIdx + 1) / (req.n + 1));
    case 'gt': {
      const cur = ctx[req.f] as number;
      return clamp01(req.v === 0 ? 1 : cur / req.v);
    }
    case 'lt': {
      const cur = ctx[req.f] as number;
      return clamp01(req.v === 0 ? 0 : Math.min(1, (req.v * 2 - cur) / req.v));
    }
    case 'peak':
      return clamp01((ctx.peak[req.f] ?? 0) / (req.v || 1));
    case 'trough': {
      const cur = ctx.trough[req.f] ?? ctx[req.f];
      return clamp01(cur <= req.v ? 1 : (req.v === 0 ? 0 : Math.min(1, 1 - Math.abs(cur) / Math.abs(req.v) + 0.5)));
    }
    case 'lever': {
      const v = ctx.levers[req.id] ?? 0;
      return clamp01(req.op === '>=' ? v / (req.v || 1) : 1 - v / (req.v || 1));
    }
    case 'leverEver': {
      const v = req.op === '>=' ? ctx.leverMax[req.id] : ctx.leverMin[req.id];
      return v === undefined ? 0 : clamp01(req.op === '>=' ? v / (req.v || 1) : 1);
    }
    case 'streak':
      return clamp01((ctx.streak[req.id] ?? 0) / req.n);
    case 'round':
      return clamp01(ctx.round / req.n);
    case 'orient':
      return ctx.orientation === req.v ? 1 : 0;
    case 'phase':
      return ctx.cyclePhase === req.v ? 1 : 0;
    case 'all':
      return req.of.length ? Math.min(...req.of.map((r) => reqProgress(r, ctx))) : 1;
    case 'any':
      return req.of.length ? Math.max(...req.of.map((r) => reqProgress(r, ctx))) : 0;
    default:
      return 0;
  }
}

// ── 个体涌现量：从家庭 / 企业 / 地块这些「个体」身上统计出来的分布特征 ──
// 宏观平均值会掩盖分化；这批量专门用来捕捉「谁先撑不住了」「地价分化到什么程度」这类故事。
export interface EmergeStats {
  bankruptcies: number;
  poorShare: number;
  maxLandValue: number;
  vacancyRate: number;
  lossFirmShare: number;
  wealthTop10: number;
}

export function emergeStats(state: SimState): EmergeStats {
  const hhs = state.households;
  const firms = state.firms;

  // 入不敷出：储蓄撑不过 1 个月的开销（失业者按城市平均消费估算）
  const consRef = hhs.length
    ? hhs.reduce((a, h) => a + (h.consumption > 0 ? h.consumption : 0), 0) / hhs.length
    : 0;
  // 兜底按「一个月 ¥8,000 的基本开销」估：户均开销算不出来时用这个
  const floor = Math.max(CONFIG.CONSUMPTION_FLOOR, consRef > 0 ? consRef : 0);
  let poor = 0;
  for (const h of hhs) if (h.savings < floor) poor++;

  // 最富 10% 占有的储蓄份额
  let wealthTop10 = 0;
  if (hhs.length >= 10) {
    const sorted = [...hhs].sort((a, b) => b.savings - a.savings);
    const topN = Math.max(1, Math.floor(sorted.length * 0.1));
    let top = 0;
    let all = 0;
    for (const h of sorted) all += Math.max(0, h.savings);
    for (let i = 0; i < topN; i++) top += Math.max(0, sorted[i].savings);
    wealthTop10 = all > 0 ? top / all : 0;
  }

  // 岗位空缺率 + 亏损企业占比
  let vacancy = 0;
  let capacity = 0;
  let loss = 0;
  for (const f of firms) {
    vacancy += f.powered ? Math.max(0, f.capacity - f.employees.length) : 0;
    capacity += f.capacity;
    if (f.profit < 0) loss++;
  }

  // 地价分化：全城最高单价
  let maxLandValue = 0;
  for (const t of state.city.tiles) {
    if (t.developed && t.landValue > maxLandValue) maxLandValue = t.landValue;
  }

  // 累计倒闭数（每月新增记在 series 里）
  let bankruptcies = 0;
  const bk = state.series?.bankruptcies;
  if (bk) for (const n of bk) bankruptcies += n;

  return {
    bankruptcies,
    poorShare: hhs.length ? poor / hhs.length : 0,
    maxLandValue,
    vacancyRate: capacity > 0 ? vacancy / capacity : 0,
    lossFirmShare: firms.length ? loss / firms.length : 0,
    wealthTop10,
  };
}

// ── 从 SimState 构造判定上下文 ──
export function buildCtx(state: SimState): Ctx {
  const ind = state.indicators;
  const sum = tileSummary(state);
  const em = emergeStats(state);
  const tr = state.tracking;
  return {
    month: state.month,
    population: ind.population,
    employmentRate: ind.employmentRate,
    unemploymentRate: 1 - ind.employmentRate,
    avgWage: ind.avgWage,
    cpi: ind.cpi,
    gdp: ind.gdp,
    treasury: ind.treasury,
    gini: ind.gini,
    happiness: ind.happiness,
    firms: state.firms.length,
    pollution: sum.avgPollution,
    amenity: sum.avgAmenity,
    landValue: sum.avgLandValue,
    builtTiles: sum.builtTiles,
    bankruptcies: em.bankruptcies,
    poorShare: em.poorShare,
    maxLandValue: em.maxLandValue,
    vacancyRate: em.vacancyRate,
    lossFirmShare: em.lossFirmShare,
    wealthTop10: em.wealthTop10,
    cycleIndex: state.business?.index ?? 0,
    outputGap: state.business?.outputGap ?? 0,
    cycles: state.business?.cycleCount ?? 0,
    cyclePhase: state.business?.phase ?? 'recovery',
    cyclePhaseMonths: state.business?.phaseMonths ?? 0,
    stageIdx: currentTier(state),
    round: state.cycle?.round ?? 1,
    orientation: state.orientation ?? 'balanced',
    levers: {
      taxRate: state.gov.taxRate,
      minWage: state.gov.minWage,
      publicSpend: state.gov.publicSpend,
      industrySubsidy: state.gov.industrySubsidy,
      eduSubsidy: state.gov.eduSubsidy,
      tradeOpenness: state.gov.tradeOpenness,
      welfare: state.gov.welfare,
      ...state.householdParams,
      ...state.firmParams,
    },
    leverMax: tr.leverMax,
    leverMin: tr.leverMin,
    peak: tr.peak,
    trough: tr.trough,
    streak: tr.streak,
  };
}

// 每月刷新一次历史极值与「曾经拧到过的旋钮值」
export function updateTracking(state: SimState): void {
  const tr = state.tracking;
  const ctx = buildCtx(state);
  for (const f of NUM_FIELDS) {
    const v = ctx[f] as number;
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    tr.peak[f] = Math.max(tr.peak[f] ?? v, v);
    tr.trough[f] = Math.min(tr.trough[f] ?? v, v);
  }
  for (const [id, v] of Object.entries(ctx.levers)) {
    tr.leverMax[id] = Math.max(tr.leverMax[id] ?? v, v);
    tr.leverMin[id] = Math.min(tr.leverMin[id] ?? v, v);
  }
}

// 收集所有需要统计「连续月数」的条件
export function collectStreaks(terms: { req: Req }[]): { id: string; cond: Req }[] {
  const out: { id: string; cond: Req }[] = [];
  const seen = new Set<string>();
  const walk = (r: Req) => {
    if (r.k === 'streak') {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        out.push({ id: r.id, cond: r.cond });
      }
      walk(r.cond);
      return;
    }
    if (r.k === 'all' || r.k === 'any') r.of.forEach(walk);
  };
  for (const t of terms) walk(t.req);
  return out;
}
