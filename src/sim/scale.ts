// 代表性样本换算。
//
// 一座百万人口的城市有 38 万户家庭、两万多家企业 —— 逐一建模跑不动，也没必要。
// 游戏里真正被逐月模拟的是几千个「代表性家庭」和一两百家「代表性企业」，
// 它们每一个都代表真实世界中的一批同类主体：
//
//      真实户数 = 家庭样本数 × hhScale
//      真实人口 = 真实户数 × 户均人口（2.6）
//      真实产量 / 营收 / 税收 / 消费 = 对应样本值 × hhScale
//
// 关键在于：单价、月薪、利润率、就业率、人均 GDP 这些「强度量」一概不变，
// 变的只有「总量」。所以学过两本账的人在仪表盘上看到的每一行都还是现实世界的量级：
// 月薪八千、地价三千、利润率百分之几、GDP 几百亿 —— 只是背后跑的是几千个样本而不是几百万个。

import { CONFIG } from './config';
import { HOUSEHOLD_SIZE } from '../data/units';
import type { SimState } from './types';

/** 人口的真值住在地块的 tile.pop 上，这里把它汇总成「真实户数」缓存起来 */
export function syncRealHouseholds(state: SimState): void {
  let pop = 0;
  for (const t of state.city.tiles) pop += Math.max(0, t.pop);
  state.realHouseholds = pop / HOUSEHOLD_SIZE;
}

/** 一个家庭样本代表多少户真实家庭 */
export function hhScaleOf(state: SimState): number {
  const n = state.households.length;
  if (n <= 0) return 1;
  const s = state.realHouseholds / n;
  return Number.isFinite(s) && s > 0 ? s : 1;
}

/** 按当前人口规模「应该」维护多少个家庭样本 */
export function targetSamples(state: SimState): number {
  const real = Math.max(1, state.realHouseholds);
  const floor = Math.max(CONFIG.MIN_SAMPLES, Math.ceil(real / CONFIG.HH_PER_SAMPLE_MAX));
  // 样本数不能超过真实户数，否则会冒出「一个样本代表 0.6 户」这种说不通的比例
  return Math.max(1, Math.min(Math.ceil(real), Math.min(CONFIG.MAX_SAMPLES, floor)));
}

/** 真实常住人口（人） */
export function realPopulationOf(state: SimState): number {
  return Math.round(state.realHouseholds * HOUSEHOLD_SIZE);
}

/** 把「样本口径」的总量换算成「真实口径」的总量 */
export function toReal(state: SimState, sampleValue: number): number {
  return sampleValue * hhScaleOf(state);
}

/** 经过倍率换算后的逐月 GDP（元，增加值口径） */
export function realGdpOf(state: SimState, materialK: number): number {
  let sum = 0;
  for (const f of state.firms) sum += f.revenue * (1 - materialK);
  return sum * hhScaleOf(state);
}
