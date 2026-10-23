// 宏观指标聚合：就业率、平均工资、CPI、GDP、财政、基尼、幸福。

import { CONFIG } from './config';
import { populationOf } from './stages';
import { hhScaleOf } from './scale';
import type { Indicators, SimState } from './types';

// 物价指数基期：基准成本 ×（1 + 默认加价率）
export const CPI_BASE = CONFIG.BASE_PRICE * (1 + CONFIG.DEFAULT_MARKUP);

export function computeIndicators(state: SimState, prevCpi: number): Indicators {
  const pop = state.households.length;
  const employed = state.households.filter((h) => h.employed).length;
  const employmentRate = employmentRateOf(state);

  const employedWages = state.households.filter((h) => h.employed).map((h) => h.wage);
  const avgWage =
    employedWages.length > 0 ? employedWages.reduce((a, b) => a + b, 0) / employedWages.length : 0;

  const avgPrice = averagePrice(state);
  // CPI 的基期是「默认政策 + 默认加价率」下的均衡价，而不是裸的生产成本。
  // 否则开局默认加价 30% 就直接把 CPI 顶到 130，玩家什么都没做就被判成恶性通胀，
  // 连「通货膨胀」这个概念都会在一开局误解锁。
  const cpi = (avgPrice / CPI_BASE) * 100;

  // GDP 按「增加值」口径 = 营收 − 中间投入，而不是营收总额
  // （把中间投入也算进 GDP 会重复计算，还会让「人均 GDP」虚高一倍）
  // 每家企业样本代表 hhScale 家真实企业，所以全市总量要乘以这个倍率。
  const gdp = state.firms.reduce((a, f) => a + f.revenue * (1 - CONFIG.MATERIAL_K), 0) * hhScaleOf(state);

  const happiness =
    pop > 0 ? state.households.reduce((a, h) => a + h.satisfaction, 0) / pop : 0;

  const gini = computeGini(state.households.map((h) => h.savings));

  const year = CONFIG.START_YEAR + Math.floor(state.month / 12);
  const monthInYear = (state.month % 12) + 1;

  const bc = state.business;

  return {
    month: monthInYear,
    year,
    population: populationOf(state),
    employmentRate,
    avgWage,
    cpi,
    gdp,
    treasury: state.gov.treasury,
    gini,
    happiness,
    cyclePhase: bc?.phase ?? 'recovery',
    cycleIndex: bc?.index ?? 0,
    outputGap: bc?.outputGap ?? 0,
    potentialOutput: bc?.potentialOutput ?? 0,
  };
}

// 市场平均价格：只统计「活跃」企业（有雇员或有库存）。
// 空壳公司（没人没货）仍挂着报价会把均价拉飞，进而虚高 CPI、凭空压低居民购买力。
export function averagePrice(state: SimState): number {
  const active = state.firms.filter((f) => f.employees.length > 0 || f.inventory > 0);
  if (active.length === 0) return CONFIG.BASE_PRICE;
  return active.reduce((a, f) => a + f.price, 0) / active.length;
}

// 就业率 = 就业人数 / 劳动力（就业 + 正在找工作）。
// 分母不能是"全部家庭"：不进入劳动力市场的人（退出、照顾家庭、上学）不该算成失业者，
// 否则一座岗位充足的城市也会显示三成"失业"，与现实口径完全对不上。
export function laborForceOf(state: SimState): number {
  let n = 0;
  for (const h of state.households) if (h.employed || h.seeking) n++;
  return n;
}

export function employmentRateOf(state: SimState): number {
  const lf = laborForceOf(state);
  if (lf === 0) return 0;
  const employed = state.households.reduce((a, h) => a + (h.employed ? 1 : 0), 0);
  return employed / lf;
}

// 基尼系数（基于储蓄分布）
function computeGini(values: number[]): number {
  // 标准公式 G = 2Σ(i·x_i)/(n·Σx) − (n+1)/n，i 从 1 开始。
  // 原实现累加的是「前缀和」而不是「下标加权的前缀和」，会算出负数（基尼不可能为负）。
  const v = values.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 2) return 0;
  const sorted = [...v].sort((a, b) => a - b);
  const n = sorted.length;
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    weighted += (i + 1) * sorted[i];
    total += sorted[i];
  }
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (2 * weighted) / (n * total) - (n + 1) / n));
}
