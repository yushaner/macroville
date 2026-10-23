// 视角专属指标聚合 + 软提示（偏离建议区间时给经济含义，不判输赢）。
import { CONFIG } from './config';
import { yuan } from '../data/units';
import type { SimState } from './types';

export interface PerspItem {
  key: string; // 术语表 key（点击查看释义）
  label: string;
  value: string;
  status: 'ok' | 'warn';
}

export interface PerspView {
  items: PerspItem[];
  hints: string[]; // 当前偏离建议区间的提示（软提示）
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

export function householdIndicators(state: SimState): PerspView {
  const emp = state.households.filter((h) => h.employed);
  const netIncomes = emp.map((h) => h.wage * (1 - state.gov.taxRate));
  const disposable = avg(netIncomes);
  const living = avg(state.households.map((h) => h.satisfaction));
  const wealth = avg(state.households.map((h) => h.savings));
  const cons = avg(state.households.map((h) => h.consumption));
  const resilience = cons > 0 ? wealth / cons : wealth; // 约可支撑的月数
  // 「可维持生活的收入」参考线：最低工资的 70%（默认约 ¥1,750/月）
  const livingWage = CONFIG.DEFAULT_MIN_WAGE * 0.7;

  const items: PerspItem[] = [
    {
      key: 'disposableIncome',
      label: '可支配收入',
      value: `${yuan(disposable)}/月`,
      status: disposable >= livingWage ? 'ok' : 'warn',
    },
    {
      key: 'livingStandard',
      label: '生活水平',
      value: living.toFixed(0),
      status: living >= 55 ? 'ok' : 'warn',
    },
    {
      key: 'wealth',
      label: '家庭财富',
      value: yuan(wealth),
      status: wealth >= 60000 ? 'ok' : 'warn',
    },
    {
      key: 'resilience',
      label: '抗风险缓冲',
      value: `${resilience.toFixed(1)} 个月`,
      status: resilience >= 2 ? 'ok' : 'warn',
    },
  ];

  const hints: string[] = [];
  if (disposable < livingWage)
    hints.push('可支配收入偏低：提高劳动力参与率、技能投入或降低税率，可提升家庭收入。');
  if (living < 55)
    hints.push('生活水平（满意度）偏低：增加公共支出、福利或就业，能直接改善居民体验。');
  if (wealth < 60000)
    hints.push('家庭财富积累不足（低于 ¥6 万，约 7 个月开销）：适当下调储蓄率或提升收入，可加快财富增长。');
  if (resilience < 2)
    hints.push('抗风险缓冲偏薄：提高储蓄率或风险偏好下调，可增厚应急储蓄。');
  return { items, hints };
}

export function firmIndicators(state: SimState): PerspView {
  const profits = state.firms.map((f) => f.profit);
  const avgProfit = avg(profits);
  const totalEmp = state.firms.reduce((a, f) => a + f.employees.length, 0);
  const totalCap = state.firms.reduce((a, f) => a + f.capacity, 0);
  const util = totalCap > 0 ? totalEmp / totalCap : 0;
  const avgPrice = avg(state.firms.map((f) => f.price));
  const totalRevenue = state.firms.reduce((a, f) => a + f.revenue, 0);
  const loPrice = CONFIG.BASE_PRICE * 0.5;
  const hiPrice = CONFIG.BASE_PRICE * 2.0;

  const items: PerspItem[] = [
    {
      key: 'avgProfit',
      label: '平均利润',
      value: `${yuan(avgProfit)}/月`,
      status: avgProfit >= 0 ? 'ok' : 'warn',
    },
    {
      key: 'capacityUtil',
      label: '产能利用率',
      value: (util * 100).toFixed(0) + '%',
      status: util >= 0.5 && util <= 0.95 ? 'ok' : 'warn',
    },
    {
      key: 'avgPrice',
      label: '平均售价',
      value: `¥${Math.round(avgPrice).toLocaleString('zh-CN')}/件`,
      status: avgPrice >= loPrice && avgPrice <= hiPrice ? 'ok' : 'warn',
    },
    {
      key: 'totalRevenue',
      label: '总营收',
      value: `${yuan(totalRevenue)}/月`,
      status: 'ok',
    },
  ];

  const hints: string[] = [];
  if (avgProfit < 0)
    hints.push('企业整体亏损：降低加价率/工资出价、提高研发或库存策略，可改善盈利。');
  if (util < 0.5)
    hints.push('产能利用率偏低：需求不足或用工短缺，可提高工资出价招人、或下调加价率促需求。');
  if (util > 0.95)
    hints.push('产能接近饱和：提升扩产意愿可扩容接单，避免错失需求。');
  if (avgPrice > hiPrice)
    hints.push('平均售价偏高：可能推高 CPI，适当下调加价率可让利促销、扩大份额。');
  if (avgPrice < loPrice)
    hints.push('平均售价偏低：或陷入价格战，适度上调加价率可修复利润空间。');
  return { items, hints };
}
