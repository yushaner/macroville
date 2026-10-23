// 政府步进：按公共支出消耗财政（满意度加成已在家庭步进中通过 publicSpend 体现）。
// 政府支出不只是扣钱——它同时形成对产品的需求，补上税收漏出，否则经济循环会失血。

import { CONFIG } from './config';
import { hhScaleOf, realPopulationOf } from './scale';
import type { SimState } from './types';

/** 本月政府支出（真实口径，元）：人口越多、承担的公共服务与转移支付越多 */
export function computeGovSpend(state: SimState): number {
  const pop = realPopulationOf(state); // 常住人口（人）
  const firms = state.firms.length * hhScaleOf(state); // 代表性换算后的真实企业数
  return (
    pop * CONFIG.GOV_SPEND_PER_CAPITA * state.gov.publicSpend +
    pop * CONFIG.WELFARE_COST_PER_CAPITA * state.gov.welfare +
    firms * CONFIG.INDUSTRY_SUBSIDY_COST * state.gov.industrySubsidy +
    firms * CONFIG.EDU_SUBSIDY_COST * state.gov.eduSubsidy
  );
}

/**
 * 折算成「样本口径」的需求分量。
 * 企业账上的产出与库存都按单个代表性企业记账，需求量必须同口径相除，
 * 否则一座百万人口城市的需求会把几十家企业样本直接清空库存。
 */
export function govDemandSample(state: SimState): number {
  const scale = Math.max(0.05, hhScaleOf(state));
  return computeGovSpend(state) / scale;
}

export function stepGovernment(state: SimState): number {
  const spend = computeGovSpend(state);
  // 允许赤字（余额转为负，仪表盘以红色警示）
  state.gov.treasury = state.gov.treasury - spend;
  return spend;
}
