// 政策杠杆定义（含按游戏年份逐步解锁的机制）。
// 三种视角共用同一套数据结构：scope 决定旋钮作用于哪个主体，target 是对应参数对象的键。
import { CONFIG } from '../sim/config';
import { buildCtx, reqHint } from '../sim/requirements';
import type { SimState } from '../sim/types';
import { leverTermUnlocked, leverGate } from './glossary';

export type LeverScope = 'gov' | 'household' | 'firm';

export interface LeverDef {
  id: string; // 同时作为术语表 key
  scope: LeverScope;
  target: string; // 作用于对应参数对象的字段名
  label: string;
  min: number;
  max: number;
  step: number;
  value: number; // 初始值
  yearOffset: number; // 第几年解锁（0 = 开局即可用；仅 gov 用）
  fmt: (v: number) => string;
  desc: string; // 含义
  effect: string; // 对系统的影响
}

const pct = (v: number) => (v * 100).toFixed(0) + '%';
const num = (v: number) => v.toFixed(2);

export const LEVERS: LeverDef[] = [
  // —— 政府视角（按年份逐步解锁）——
  {
    id: 'taxRate',
    scope: 'gov',
    target: 'taxRate',
    label: '税率',
    min: 0,
    max: 0.5,
    step: 0.01,
    value: CONFIG.DEFAULT_TAX,
    yearOffset: 0,
    fmt: pct,
    desc: '政府对居民工资与企业利润征收的税率。',
    effect: '↑ 财政收入增加，但居民可支配收入与企业利润下降，长期抑制消费与投资。',
  },
  {
    id: 'minWage',
    scope: 'gov',
    target: 'minWage',
    label: '最低工资',
    min: 0,
    max: 15000,
    step: 100,
    value: CONFIG.DEFAULT_MIN_WAGE,
    yearOffset: 0,
    fmt: (v) => `¥${Math.round(v).toLocaleString('zh-CN')}/月`,
    desc: '政府规定的月最低工资标准（元/月）。默认 ¥2,500，约为当地市场工资的四分之一。',
    effect: '↑ 抬高用工成本底线，低收入者受益；高到接近市场工资时会挤出岗位、推高物价。',
  },
  {
    id: 'publicSpend',
    scope: 'gov',
    target: 'publicSpend',
    label: '公共支出',
    min: 0,
    max: 1,
    step: 0.05,
    value: CONFIG.DEFAULT_PUBLIC_SPEND,
    yearOffset: 0,
    fmt: pct,
    desc: '政府用于基建、教育、医疗、治安等公共服务的支出强度。',
    effect: '↑ 提升居民满意度与幸福度，但消耗财政，需税收支撑。',
  },
  {
    id: 'industrySubsidy',
    scope: 'gov',
    target: 'industrySubsidy',
    label: '产业补贴',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0,
    yearOffset: 1,
    fmt: pct,
    desc: '对各类企业按雇员数发放的定向补贴（第二年起可用）。',
    effect: '↑ 降低企业成本、鼓励扩招与增产，但消耗财政，过量易推升物价。',
  },
  {
    id: 'eduSubsidy',
    scope: 'gov',
    target: 'eduSubsidy',
    label: '研发补贴',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0,
    yearOffset: 2,
    fmt: pct,
    desc: '对研发与人力资本的投入（第三年起可用）。',
    effect: '↑ 提升居民技能与生产率，长期抬升工资、消费与 GDP，但当期消耗财政。',
  },
  {
    id: 'tradeOpenness',
    scope: 'gov',
    target: 'tradeOpenness',
    label: '贸易开放度',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0,
    yearOffset: 3,
    fmt: pct,
    desc: '城市与外部市场的连通程度（第四年起可用）。',
    effect: '↑ 拓宽总需求与销路，刺激产出与 GDP，但本地价格更易受外部波动冲击。',
  },
  {
    id: 'welfare',
    scope: 'gov',
    target: 'welfare',
    label: '福利支出',
    min: 0,
    max: 1,
    step: 0.05,
    value: 0,
    yearOffset: 4,
    fmt: pct,
    desc: '对失业与弱势群体的转移支付（第五年起可用）。',
    effect: '↑ 改善失业者生活与整体幸福度、缩小差距，但显著消耗财政。',
  },

  // —— 个人/家庭视角（开局即可用，作为典型家庭行为假设）——
  {
    id: 'savingsRate',
    scope: 'household',
    target: 'savingsRate',
    label: '储蓄率',
    min: 0,
    max: 0.6,
    step: 0.05,
    value: CONFIG.DEFAULT_SAVINGS_RATE,
    yearOffset: 0,
    fmt: pct,
    desc: '典型家庭将工资收入中留作储蓄的比例。',
    effect: '↑ 财富积累更快、抗风险更强，但当期消费减少，总需求与 GDP 受抑。',
  },
  {
    id: 'consumptionPropensity',
    scope: 'household',
    target: 'consumptionPropensity',
    label: '消费倾向',
    min: 0.6,
    max: 1.4,
    step: 0.05,
    value: CONFIG.DEFAULT_CONS_PROP,
    yearOffset: 0,
    fmt: num,
    desc: '典型家庭边际消费倾向的放大系数（越高越敢花）。',
    effect: '↑ 拉动当期消费与总需求，但储蓄与长期财富增长放缓。',
  },
  {
    id: 'laborParticipation',
    scope: 'household',
    target: 'laborParticipation',
    label: '劳动力参与率',
    min: 0.5,
    max: 1,
    step: 0.05,
    value: CONFIG.DEFAULT_LABOR_PART,
    yearOffset: 0,
    fmt: pct,
    desc: '典型家庭愿意进入劳动力市场求职的比例。',
    effect: '↑ 劳动力供给增加，更多人有收入、产出上升；但竞争加剧可能压低就业率。',
  },
  {
    id: 'skillInvest',
    scope: 'household',
    target: 'skillInvest',
    label: '技能投入',
    min: 0,
    max: 1,
    step: 0.05,
    value: CONFIG.DEFAULT_SKILL_INVEST,
    yearOffset: 0,
    fmt: pct,
    desc: '典型家庭在技能/教育上的投入强度。',
    effect: '↑ 技能成长更快，长期抬升工资、消费与竞争力，但当期挤占消费。',
  },
  {
    id: 'riskAppetite',
    scope: 'household',
    target: 'riskAppetite',
    label: '风险偏好',
    min: 0,
    max: 1,
    step: 0.05,
    value: CONFIG.DEFAULT_RISK_APP,
    yearOffset: 0,
    fmt: pct,
    desc: '典型家庭的风险偏好（高则更愿动用储蓄消费，低则更爱囤积）。',
    effect: '↑ 当期消费更活跃、需求更旺；↓ 储蓄缓冲更厚、抗冲击更强。',
  },

  // —— 企业视角（开局即可用，作为典型企业行为假设）——
  {
    id: 'markup',
    scope: 'firm',
    target: 'markup',
    label: '加价率',
    min: 0,
    max: 1,
    step: 0.05,
    value: CONFIG.DEFAULT_MARKUP,
    yearOffset: 0,
    fmt: pct,
    desc: '典型企业在成本之上的加价幅度（定价锚）。',
    effect: '↑ 单位利润更高，但价格上升、需求可能流失，并推高 CPI。',
  },
  {
    id: 'wageMultiplier',
    scope: 'firm',
    target: 'wageMultiplier',
    label: '工资出价',
    min: 0.5,
    max: 2,
    step: 0.05,
    value: CONFIG.DEFAULT_WAGE_MULT,
    yearOffset: 0,
    fmt: (v) => `${v.toFixed(2)}× · ¥${Math.round(CONFIG.BASE_WAGE * v).toLocaleString('zh-CN')}/月`,
    desc: `典型企业工资出价相对基准工资（¥${CONFIG.BASE_WAGE.toLocaleString('zh-CN')}/月）的倍数，影响招人竞争力。`,
    effect: '↑ 更易招到员工、产能利用率提高，但用工成本上升、利润承压。',
  },
  {
    id: 'expansion',
    scope: 'firm',
    target: 'expansion',
    label: '扩产意愿',
    min: 0,
    max: 1,
    step: 0.05,
    value: CONFIG.DEFAULT_EXPANSION,
    yearOffset: 0,
    fmt: pct,
    desc: '典型企业在盈利时的产能扩张意愿。',
    effect: '↑ 盈利后更快扩产能、吸纳就业、做大产出，但固定成本上升。',
  },
  {
    id: 'rdInvest',
    scope: 'firm',
    target: 'rdInvest',
    label: '研发投入',
    min: 0,
    max: 1,
    step: 0.05,
    value: CONFIG.DEFAULT_RD_INVEST,
    yearOffset: 0,
    fmt: pct,
    desc: '典型企业在研发/技术上的投入强度。',
    effect: '↑ 单位产出（生产率）提升，长期降本增效、增强竞争力，但当期投入增加。',
  },
  {
    id: 'inventoryStrategy',
    scope: 'firm',
    target: 'inventoryStrategy',
    label: '库存策略',
    min: 0,
    max: 1,
    step: 0.05,
    value: CONFIG.DEFAULT_INV_STRATEGY,
    yearOffset: 0,
    fmt: pct,
    desc: '典型企业的库存/产出缓冲策略（越高越备货）。',
    effect: '↑ 供给更充裕、不易缺货断供，但库存占用资金、滞销风险上升。',
  },
];

// 取某视角当前可用的杠杆：
//   gov 仍需满足年份门槛（产业补贴等随城市成长逐步开放），
//   且所有杠杆都要求对应的经济学名词已被解锁——「认识了才调得动」。
// 名词本身由玩家决策触发解锁，所以这里的可用性最终取决于你做过什么。
export function leversFor(scope: LeverScope, currentYear: number, state: SimState): LeverDef[] {
  return LEVERS.filter(
    (l) =>
      l.scope === scope &&
      (l.scope !== 'gov' || currentYear >= CONFIG.START_YEAR + l.yearOffset) &&
      leverTermUnlocked(l.id, state),
  );
}

// 兼容旧调用：仅政府视角的已解锁杠杆
export function unlockedLevers(currentYear: number, state: SimState): LeverDef[] {
  return leversFor('gov', currentYear, state);
}

export function leverById(id: string): LeverDef | undefined {
  return LEVERS.find((l) => l.id === id);
}

// 该视角下「暂时还调不动」的杠杆 + 原因，用于在面板上显示锁定行
export interface LockedLever {
  lever: LeverDef;
  reason: string;
}
export function lockedLeversFor(scope: LeverScope, currentYear: number, state: SimState): LockedLever[] {
  const open = new Set(leversFor(scope, currentYear, state).map((l) => l.id));
  const out: LockedLever[] = [];
  for (const l of LEVERS) {
    if (l.scope !== scope || open.has(l.id)) continue;
    const gate = leverGate(l.id);
    let reason: string;
    if (gate && !state.unlocked.includes(gate.key)) {
      // 把名词的解锁条件直接摊开给玩家：他知道该去做什么才能拿到这个旋钮
      reason = `解锁「${gate.name}」：${reqHint(gate.req, buildCtx(state))}`;
    } else if (l.scope === 'gov' && currentYear < CONFIG.START_YEAR + l.yearOffset) {
      reason = `第 ${l.yearOffset + 1} 年解锁`;
    } else {
      reason = '尚未开放';
    }
    out.push({ lever: l, reason });
  }
  return out;
}
