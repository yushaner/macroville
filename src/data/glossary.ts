// 经济学图谱：微观 / 中观（产业）/ 宏观 各 30 个名词，共 90 个节点。
//
// 两层知识体系：
//   · 这里（TERMS）是「图谱层」——每个名词一句话定义 + 一句话影响，可点击、可解锁；
//   · lessons.ts 是「概念卡层」——少数重点概念的深度讲解（实例 / 实验 / 公式）。
//
// 解锁不再看月份、不再能挂机刷：每个名词带一条 Requirement（见 sim/requirements.ts），
// 判定的是两件事——① 你亲手把哪个旋钮拧到了什么程度（leverEver）；
// ② 这些决策把城市带成了什么样（历史峰值 / 谷值 / 连续维持）。
// 解锁名词会放出它绑定的杠杆或指标，于是形成：你做决策 → 城市出现状况 → 学到概念 → 多一个旋钮。

import {
  ALL, ANY, EVER, GT, KEEP, LT, M, PEAK, PHASE, STG, TROUGH,
  buildCtx, reqMet, type Req,
} from '../sim/requirements';
import type { SimState } from '../sim/types';

export type Chapter = 'micro' | 'industrial' | 'macro';

export interface TermDef {
  key: string;
  name: string;
  chapter: Chapter;
  def: string;
  effect: string;
  related: string[]; // 关联其它名词 key（图谱连线用）
  req: Req; // 解锁条件（纯数据，可序列化）
  unlocks?: { levers?: string[]; metrics?: string[] };
}

export const CHAPTER_LABEL: Record<Chapter, string> = {
  micro: '微观经济学',
  industrial: '中观 · 产业经济学',
  macro: '宏观经济学',
};

const T = (
  key: string,
  name: string,
  chapter: Chapter,
  req: Req,
  def: string,
  effect: string,
  related: string[] = [],
  unlocks?: TermDef['unlocks'],
): TermDef => ({ key, name, chapter, req, def, effect, related, unlocks });

// 开局能读的基础概念：没有门槛，先给玩家一套能用的词汇
const OPEN: Req = M(0);

export const TERMS: TermDef[] = [
  // ══════════════ 微观经济学（30）══════════════
  T('opportunityCost', '机会成本', 'micro', OPEN,
    '为得到某物而放弃的、价值最高的替代选项。',
    '决定居民在工作与闲暇、消费与储蓄之间的取舍。',
    ['laborSupply', 'savingsRate']),
  T('supplyDemand', '供需定律', 'micro', OPEN,
    '价格由供给与需求共同决定；供不应求涨价，供过于求降价。',
    '是市场自动出清、价格自发形成的核心机制。',
    ['demand', 'supply', 'equilibriumPrice']),
  T('demand', '需求', 'micro', OPEN,
    '在某一价格下，买方愿意且能够购买的数量。',
    '价格越高需求越少；收入与偏好会把需求曲线整体移动。',
    ['supplyDemand', 'elasticity', 'aggregateDemand']),
  T('supply', '供给', 'micro', OPEN,
    '在某一价格下，卖方愿意且能够提供的数量。',
    '成本上升会减少供给；产能与库存决定短期供给弹性。',
    ['supplyDemand', 'marginalCost', 'productivity']),
  T('population', '人口', 'micro', OPEN,
    '城市常驻居民总数。',
    '决定劳动力与消费规模；满意度高低驱动迁入或迁出。',
    ['migration', 'unemployment'],
    { metrics: ['population'] }),
  T('employmentRate', '就业率', 'micro', OPEN,
    '就业人口占劳动力人口的比例。',
    '企业招工与居民求职的匹配结果，直接影响家庭收入。',
    ['unemployment', 'laborSupply'],
    { metrics: ['employmentRate'] }),
  T('unemployment', '失业', 'micro', OPEN,
    '想工作却找不到岗位的人。',
    '工资过高、需求不足或技能错配都会把人挤出岗位。',
    ['employmentRate', 'naturalUnemployment']),
  T('avgWage', '平均工资', 'micro', OPEN,
    '在岗雇员的平均月薪。',
    '由企业出价、最低工资与劳动供需共同决定。',
    ['laborSupply', 'realWage'],
    { metrics: ['avgWage'] }),
  T('disposableIncome', '可支配收入', 'micro', OPEN,
    '扣除税收后真正能花的钱。',
    '决定家庭预算约束与生活水平。',
    ['budgetConstraint', 'livingStandard'],
    { metrics: ['disposableIncome'] }),
  T('livingStandard', '生活水平', 'micro', OPEN,
    '居民实际享受到的物质条件与主观感受。',
    '由真实购买力、公共服务与就业安全感共同决定。',
    ['realWage', 'happiness'],
    { metrics: ['livingStandard'] }),
  T('happiness', '幸福度', 'micro', OPEN,
    '居民对生活的综合满意度，0-100。',
    '低则人口外流、城市衰退；高则吸引移民迁入。',
    ['livingStandard', 'migration'],
    { metrics: ['happiness'] }),
  T('laborSupply', '劳动供给', 'micro', OPEN,
    '居民愿意提供的劳动总量，受工资、税后收入与偏好影响。',
    '工资越高、税后收入越多，愿意工作的人越多。',
    ['laborParticipation', 'unemployment'],
    { levers: ['laborParticipation'] }),
  T('savingsRate', '储蓄率', 'micro', OPEN,
    '收入中存起来而不是花掉的比例。',
    '高储蓄增强抗风险能力，但会压低当期消费与需求。',
    ['wealth', 'resilience'],
    { levers: ['savingsRate'], metrics: ['wealth'] }),
  T('consumptionPropensity', '消费倾向', 'micro', OPEN,
    '拿到新增收入后愿意花掉的比例。',
    '消费倾向越高，同样的收入能撬动越大的需求。',
    ['consumption', 'aggregateDemand'],
    { levers: ['consumptionPropensity'] }),
  T('laborParticipation', '劳动力参与率', 'micro', OPEN,
    '劳动年龄人口中进入劳动力市场的比例。',
    '参与率提高会同时增加岗位竞争与总产出。',
    ['laborSupply', 'employmentRate'],
    { levers: ['laborParticipation'] }),
  T('skillInvest', '技能投入', 'micro', OPEN,
    '家庭投入时间与金钱提升自己的比例。',
    '技能越高，单位产出与工资越高，但当期可支配收入变少。',
    ['humanCapital', 'productivity'],
    { levers: ['skillInvest'] }),
  T('riskAppetite', '风险偏好', 'micro', OPEN,
    '面对不确定性时动用储蓄的意愿。',
    '风险偏好高的人更敢消费，也更经不起失业冲击。',
    ['resilience', 'consumptionPropensity'],
    { levers: ['riskAppetite'] }),
  T('humanCapital', '人力资本', 'micro', EVER('skillInvest', '>=', 0.5),
    '凝结在人身上的技能与知识，是长期生产率的核心。',
    '技能投入与研发补贴会持续抬高工资与产出。',
    ['skillInvest', 'productivity']),
  T('budgetConstraint', '预算约束', 'micro', PEAK('cpi', 102),
    '收入与价格共同划定的、可负担的消费组合边界。',
    '工资涨、物价也涨时，预算约束未必真的放宽。',
    ['disposableIncome', 'cpi']),
  T('marginalUtility', '边际效用', 'micro', EVER('consumptionPropensity', '>=', 1.2),
    '多消费一单位商品带来的额外满足感。',
    '边际效用递减，所以同样一笔钱，穷人用起来更幸福。',
    ['diminishingReturns', 'livingStandard']),
  T('diminishingReturns', '边际报酬递减', 'micro', EVER('expansion', '>=', 0.6),
    '其它投入不变时，持续增加单一投入，新增产出越来越少。',
    '解释为什么只靠加人无法无限提高产量，必须靠技术与资本。',
    ['marginalUtility', 'productivity']),
  T('elasticity', '价格弹性', 'micro', EVER('markup', '>=', 0.5),
    '需求量对价格变化的敏感程度。',
    '弹性大的商品涨价会迅速失去顾客，弹性小的则撑得住。',
    ['demand', 'markup']),
  T('substitutionEffect', '替代效应', 'micro', ANY(EVER('markup', '>=', 0.45), PEAK('cpi', 106)),
    '某商品变贵后，消费者转向更便宜的替代品。',
    '企业涨价流失顾客，正是替代效应在起作用。',
    ['elasticity', 'demand']),
  T('equilibriumPrice', '均衡价格', 'micro', ALL(STG(1), ANY(EVER('markup', '<=', 0.15), EVER('markup', '>=', 0.6))),
    '需求量恰好等于供给量时的价格，市场既无短缺也无过剩。',
    '本局里企业按售罄率与加价率锚反复试探，价格就是在逼近这个点。',
    ['supplyDemand', 'avgPrice']),
  T('consumerSurplus', '消费者剩余', 'micro', ALL(STG(1), ANY(EVER('markup', '<=', 0.15), TROUGH('cpi', 95))),
    '消费者愿意支付的最高价与实际支付价之间的差额。',
    '价格越低，居民获得的剩余越多，生活感受越好。',
    ['producerSurplus', 'livingStandard']),
  T('producerSurplus', '生产者剩余', 'micro', ALL(STG(1), EVER('markup', '>=', 0.45)),
    '企业实际售价高于其最低可接受价的部分。',
    '近似企业利润，是扩产与创新的资金来源。',
    ['consumerSurplus', 'avgProfit']),
  T('sunkCost', '沉没成本', 'micro', ALL(STG(1), PEAK('unemploymentRate', 0.08)),
    '已经发生、无法收回的成本，不应影响当下决策。',
    '提醒你：亏损企业裁员时不该纠结已投的厂房。',
    ['entryExit']),
  T('comparativeAdvantage', '比较优势', 'micro', EVER('tradeOpenness', '>=', 0.5),
    '各自生产机会成本更低的产品再交换，双方都能获益。',
    '是城市间分工与贸易开放度的微观基础。',
    ['opportunityCost', 'tradeOpenness']),
  T('wealth', '家庭财富', 'micro', EVER('savingsRate', '>=', 0.35),
    '家庭累计下来的储蓄存量。',
    '财富越厚，失业冲击越不致命，消费也越稳定。',
    ['savingsRate', 'resilience'],
    { metrics: ['wealth'] }),
  T('resilience', '抗风险缓冲', 'micro', ALL(EVER('savingsRate', '>=', 0.3), PEAK('unemploymentRate', 0.06)),
    '用储蓄能撑过多少个月没有收入的日子。',
    '缓冲越厚，失业带来的满意度崩塌越小。',
    ['wealth', 'unemployment'],
    { metrics: ['resilience'] }),
  T('minWage', '最低工资', 'micro', STG(1),
    '企业必须支付的最低工资底线，保障劳动者基本收入。',
    '抬高改善低收入者生活，过高则引发裁员或成本推动型涨价。',
    ['laborSupply', 'unemployment', 'inflation'],
    { levers: ['minWage'] }),

  // ══════════════ 中观 · 产业经济学（30）══════════════
  T('markup', '加价率', 'industrial', STG(1),
    '企业在成本之上加价的幅度，决定售价与毛利。',
    '加价越高利润越厚，但销量与需求会被挤出。',
    ['avgPrice', 'elasticity'],
    { levers: ['markup'] }),
  T('wageMultiplier', '工资出价', 'industrial', STG(1),
    '企业相对基准工资的出价倍数，用于抢人。',
    '出价高能招到人，但会抬高成本与售价。',
    ['avgWage', 'employmentRate'],
    { levers: ['wageMultiplier'] }),
  T('expansion', '扩产意愿', 'industrial', STG(1),
    '盈利时把利润再投入产能的积极性。',
    '扩产创造岗位，但过热会造成过剩与浪费。',
    ['capacityUtil', 'investment'],
    { levers: ['expansion'] }),
  T('rdInvest', '研发投入', 'industrial', STG(1),
    '投入研发以提升单位产出的比例。',
    '研发抬生产率，长期看是工资增长的唯一来源。',
    ['productivity', 'humanCapital'],
    { levers: ['rdInvest'] }),
  T('inventoryStrategy', '库存策略', 'industrial', STG(1),
    '企业为应对需求波动预留的产出缓冲。',
    '库存厚能扛住需求突增，也占用资金与仓储。',
    ['inventory', 'supply'],
    { levers: ['inventoryStrategy'] }),
  T('avgProfit', '平均利润', 'industrial', STG(1),
    '企业月度平均盈亏，决定它扩张还是收缩。',
    '利润为正才扩产招人，长期为负就裁员退出。',
    ['producerSurplus', 'entryExit'],
    { metrics: ['avgProfit'] }),
  T('capacityUtil', '产能利用率', 'industrial', STG(1),
    '实际用上的产能占全部产能的比例。',
    '过高说明供不应求、该扩产；过低说明产能闲置。',
    ['expansion', 'potentialOutput'],
    { metrics: ['capacityUtil'] }),
  T('avgPrice', '平均售价', 'industrial', STG(1),
    '市场上商品的平均成交价。',
    '售价直接进 CPI，也决定居民的购买力。',
    ['markup', 'cpi'],
    { metrics: ['avgPrice'] }),
  T('totalRevenue', '总营收', 'industrial', STG(1),
    '企业销售额的总和，近似城市产出规模。',
    '营收增长是扩产与招人的前提。',
    ['avgPrice', 'gdp'],
    { metrics: ['totalRevenue'] }),
  T('inventory', '库存', 'industrial', EVER('inventoryStrategy', '>=', 0.6),
    '企业已生产但尚未卖出的商品。',
    '库存积压是需求走弱的先行信号，会迫使降价减产。',
    ['inventoryStrategy', 'aggregateDemand']),
  T('marginalCost', '边际成本', 'industrial', EVER('expansion', '>=', 0.6),
    '多生产一单位产品所增加的成本。',
    '边际成本低于售价才值得继续扩产。',
    ['supply', 'economiesOfScale']),
  T('fixedCost', '固定成本', 'industrial', EVER('expansion', '<=', 0.15),
    '与产量无关、必须照付的成本（厂房、设备）。',
    '固定成本决定企业的盈亏平衡点，也是退出门槛。',
    ['marginalCost', 'sunkCost']),
  T('productivity', '生产率', 'industrial', EVER('rdInvest', '>=', 0.5),
    '单位投入能产出多少，是工资与物价的根本决定项。',
    '生产率提高，同样的工资能买到更多东西。',
    ['humanCapital', 'rdInvest']),
  T('economiesOfScale', '规模经济', 'industrial', ALL(STG(1), GT('firms', 70)),
    '规模扩大后单位成本下降的现象。',
    '大企业摊薄固定成本，因此更敢降价抢市场。',
    ['marginalCost', 'marketStructure']),
  T('entryExit', '企业进入与退出', 'industrial', ALL(STG(1), PEAK('unemploymentRate', 0.08)),
    '盈利吸引新企业进入，亏损迫使旧企业退出。',
    '进出动态决定岗位数量与市场竞争强度。',
    ['avgProfit', 'marketStructure']),
  T('pollution', '污染', 'industrial', PEAK('pollution', 0.08),
    '工业生产与交通排放累积在地块上的负外部性。',
    '污染压低周边居民满意度并拖累地价。',
    ['externality', 'landValue']),
  T('externality', '外部性', 'industrial', ALL(STG(1), PEAK('pollution', 0.12)),
    '一方行为对旁观者造成的、未经市场定价的影响。',
    '污染是典型负外部性：企业排污，居民买单。',
    ['pollution', 'publicSpend']),
  T('landValue', '地价', 'industrial', PEAK('landValue', 1760),
    '地块的市场价值，由区位、配套、密度与污染共同决定。',
    '高地价吸引高效用途，也把低效用途挤出市中心。',
    ['density', 'landUse']),
  T('density', '开发密度', 'industrial', ALL(STG(1), GT('builtTiles', 300)),
    '单位地块上承载的人口或经济活动强度。',
    '密度高带来集聚红利，也带来拥挤与污染。',
    ['landValue', 'agglomeration']),
  T('amenity', '公共服务配套', 'industrial', ALL(STG(2), EVER('publicSpend', '>=', 0.5)),
    '学校、医院、水电等设施向周边辐射的宜居度。',
    '配套越好，居民越满意，地价也越高。',
    ['publicSpend', 'landValue']),
  T('landUse', '土地用途转化', 'industrial', ALL(STG(2), GT('builtTiles', 300)),
    '地块在居民、商业、工业用途之间自发转换的过程。',
    '临街且人满的住区会破墙开店，冷清商铺会退回住区。',
    ['landValue', 'density']),
  T('congestion', '拥堵成本', 'industrial', ALL(STG(2), GT('population', 4680)),
    '人口与产业聚集后，通勤、排队与拥挤带来的效率损失。',
    '抵消一部分集聚红利，是大城市的必然代价。',
    ['agglomeration', 'density']),
  T('industrySubsidy', '产业补贴', 'industrial', STG(2),
    '政府定向给企业的补贴，用于刺激供给与就业。',
    '补贴拉动产出与岗位，但吃掉财政、可能推高物价。',
    ['aggregateSupply', 'fiscal'],
    { levers: ['industrySubsidy'] }),
  T('marketStructure', '市场结构', 'industrial', ALL(STG(2), GT('firms', 110)),
    '市场上企业数量与竞争关系的格局。',
    '企业越多竞争越充分，价格越贴近成本。',
    ['monopolisticCompetition', 'entryExit']),
  T('monopolisticCompetition', '垄断竞争', 'industrial', ALL(STG(2), EVER('markup', '>=', 0.6)),
    '很多卖家卖相似但有差异的产品，各自有一点定价权。',
    '本局企业能自主加价，正是垄断竞争的典型形态。',
    ['marketStructure', 'markup']),
  T('supplyChain', '产业链', 'industrial', ALL(STG(2), EVER('industrySubsidy', '>=', 0.25)),
    '从原料到成品的多环节分工链条。',
    '一个环节的短缺会沿着链条放大成全行业减产。',
    ['cluster', 'aggregateSupply']),
  T('tradeOpenness', '贸易开放度', 'industrial', STG(2),
    '城市与外部市场互通有无的程度。',
    '开放放大总需求，也让本地企业面对外部竞争。',
    ['comparativeAdvantage', 'aggregateDemand'],
    { levers: ['tradeOpenness'] }),
  T('agglomeration', '集聚效应', 'industrial', STG(3),
    '企业与人口聚集在一起所产生的额外效率。',
    '大城市生产率更高，但生活成本与拥堵同步上升。',
    ['cluster', 'congestion']),
  T('cluster', '产业集群', 'industrial', ALL(STG(3), EVER('industrySubsidy', '>=', 0.3)),
    '同类或关联企业扎堆形成的产业带。',
    '集群放大知识溢出与配套效率，是补贴最有效的地方。',
    ['agglomeration', 'supplyChain']),
  T('gentrification', '士绅化', 'industrial', ALL(STG(3), ANY(EVER('publicSpend', '>=', 0.6), PEAK('landValue', 2400))),
    '配套升级后地价上涨、原住居民被挤出的过程。',
    '城市变好了，但最先住在这里的人反而住不起了。',
    ['landValue', 'gini']),

  // ══════════════ 宏观经济学（30）══════════════
  T('gdp', 'GDP', 'macro', STG(1),
    '一定时期内城市生产的全部最终产品与服务的价值。',
    '衡量经济总量；由消费、投资与政府支出共同构成。',
    ['aggregateDemand', 'totalRevenue'],
    { metrics: ['gdp'] }),
  T('cpi', 'CPI', 'macro', STG(1),
    '居民消费的一篮子商品的价格指数，基期 100。',
    'CPI 上升意味着同样的钱能买到的东西变少。',
    ['inflation', 'realWage'],
    { metrics: ['cpi'] }),
  T('migration', '人口迁移', 'macro', PEAK('population', 2340),
    '居民因满意度差异在城市之间流入流出。',
    '迁移是城市规模的直接驱动，也是居民用脚投票。',
    ['population', 'happiness']),
  T('consumption', '消费', 'macro', EVER('consumptionPropensity', '>=', 1.2),
    '居民购买商品与服务的支出，总需求的主体。',
    '消费占比最高，储蓄率上升会直接压低它。',
    ['aggregateDemand', 'consumptionPropensity']),
  T('investment', '投资', 'macro', EVER('expansion', '>=', 0.6),
    '企业用于扩大产能与研发的支出。',
    '投资把今天的储蓄变成明天的产能。',
    ['expansion', 'aggregateDemand']),
  T('inflation', '通货膨胀', 'macro', PEAK('cpi', 105),
    '物价总水平持续上涨的现象。',
    '成本推动（工资、补贴）或需求拉动都会点燃它。',
    ['cpi', 'deflation']),
  T('deflation', '通货紧缩', 'macro', ALL(STG(1), ANY(TROUGH('cpi', 90), PHASE('depression'))),
    '物价总水平持续下跌的现象。',
    '通缩让债务变重、企业推迟投资，比温和通胀更难治。',
    ['cpi', 'inflation']),
  T('realWage', '实际工资', 'macro', ANY(PEAK('cpi', 103), EVER('minWage', '>=', 8000)),
    '名义工资扣除物价后的购买力。',
    '名义工资涨 5%、物价涨 8%，实际工资其实在下降。',
    ['avgWage', 'cpi', 'disposableIncome']),
  T('urbanization', '城市化', 'macro', STG(2),
    '人口与产业向城市聚集、建成区向外扩张的过程。',
    '城市化抬生产率，也带来拥堵、污染与高房价。',
    ['agglomeration', 'migration']),
  T('gini', '基尼系数', 'macro', ALL(STG(2), PEAK('gini', 0.4)),
    '衡量居民收入差距的指标，0 为完全平均，1 为绝对分化。',
    '失业率上升与福利不足都会把它推高。',
    ['welfare', 'happiness'],
    { metrics: ['gini'] }),
  T('treasury', '财政余额', 'macro', STG(2),
    '政府累计的收支结余，可能为负。',
    '财政是公共服务的钱袋子，赤字会限制后续操作。',
    ['fiscal', 'fiscalDeficit'],
    { metrics: ['treasury'] }),
  T('taxRate', '税率', 'macro', STG(2),
    '政府从收入中抽取的比例。',
    '税收是公共服务与补贴的来源，过高会抑制活力。',
    ['fiscal', 'lafferCurve'],
    { levers: ['taxRate'], metrics: ['treasury'] }),
  T('publicSpend', '公共支出', 'macro', STG(2),
    '政府用于基建、教育、医疗与治理的支出强度。',
    '公共支出抬满意度与公共服务，也直接构成总需求。',
    ['amenity', 'multiplier'],
    { levers: ['publicSpend'] }),
  T('welfare', '转移支付', 'macro', STG(2),
    '政府向居民直接发放的补贴与救济。',
    '福利托底低收入者与失业者，代价是财政压力。',
    ['gini', 'fiscal'],
    { levers: ['welfare'] }),
  T('eduSubsidy', '研发补贴', 'macro', STG(2),
    '政府补贴人力资本与研发支出的力度。',
    '研发补贴抬技能与生产率，是长期增长的关键。',
    ['humanCapital', 'productivity'],
    { levers: ['eduSubsidy'] }),
  T('fiscal', '财政政策', 'macro', EVER('taxRate', '>=', 0.3),
    '政府用税收与支出调节总需求的整套手段。',
    '你拧税率与公共支出的每一格，都是在做财政政策。',
    ['taxRate', 'publicSpend']),
  T('fiscalDeficit', '财政赤字', 'macro', TROUGH('treasury', 0),
    '支出超过收入、财政余额转为负值。',
    '赤字意味着政府在透支，后续公共服务会被迫削减。',
    ['treasury', 'fiscal']),
  T('multiplier', '乘数效应', 'macro', EVER('publicSpend', '>=', 0.5),
    '一笔支出在经济中循环放大，最终带动数倍产出。',
    '公共支出乘数最直观：政府花的钱会变成居民的收入再花出去。',
    ['publicSpend', 'aggregateDemand']),
  T('aggregateDemand', '总需求', 'macro', ALL(STG(2), ANY(EVER('publicSpend', '>=', 0.45), EVER('tradeOpenness', '>=', 0.4))),
    '消费 + 投资 + 政府支出 + 净出口的总和。',
    '总需求不足则企业减产裁员，过旺则推高物价。',
    ['consumption', 'aggregateSupply']),
  T('aggregateSupply', '总供给', 'macro', ALL(STG(2), EVER('industrySubsidy', '>=', 0.25)),
    '城市在一定价格下能够提供的全部产出。',
    '补贴、研发与生产率共同把总供给曲线往右推。',
    ['productivity', 'aggregateDemand']),
  T('crowdingOut', '挤出效应', 'macro', ALL(EVER('publicSpend', '>=', 0.5), EVER('industrySubsidy', '>=', 0.3)),
    '政府扩大支出占用资源，反而压低了私人部门活动。',
    '钱花得越多，留给市场的资源越少，产出未必等比例增加。',
    ['fiscal', 'aggregateDemand']),
  T('naturalUnemployment', '自然失业率', 'macro', ALL(STG(2), PEAK('unemploymentRate', 0.07)),
    '经济正常运行下也存在的摩擦性与结构性失业。',
    '它不会因为需求旺盛而消失，只能靠技能匹配与流动改善。',
    ['unemployment', 'phillipsCurve']),
  T('okunLaw', '奥肯定律', 'macro', ALL(STG(2), PEAK('unemploymentRate', 0.1)),
    '失业率每高出自然率 1%，产出大约损失 2%。',
    '失业不只是个人悲剧，它直接抹掉城市的产出。',
    ['unemployment', 'outputGap']),
  T('phillipsCurve', '菲利普斯曲线', 'macro', ALL(PEAK('cpi', 105), PEAK('unemploymentRate', 0.09)),
    '短期内失业率与通胀此消彼长的关系。',
    '想压低失业往往要容忍更高物价，反过来也一样。',
    ['inflation', 'naturalUnemployment']),
  T('businessCycle', '经济周期', 'macro',
    ANY(PHASE('recession'), PHASE('depression'), ALL(M(30), STG(2))),
    '经济在繁荣与衰退之间反复波动的节律。',
    '周期由投资、库存与信心共同驱动，不会一直向上。',
    ['outputGap', 'stagflation', 'boom', 'recession', 'depression', 'recovery']),
  T('boom', '繁荣', 'macro', PHASE('boom'),
    '周期的高涨阶段：需求旺盛、产能吃紧、物价抬头、企业抢着招人扩产。',
    '繁荣时扩产与补贴会继续火上浇油；此时收紧，衰退会来得轻一些。',
    ['businessCycle', 'outputGap', 'inflation']),
  T('recession', '衰退', 'macro', PHASE('recession'),
    '周期的下行段：需求转弱、库存积压，企业先停招人、再开始裁员。',
    '衰退先表现为裁员与降薪，随后才轮到企业倒闭。',
    ['businessCycle', 'depression', 'unemployment']),
  T('depression', '萧条', 'macro', PHASE('depression'),
    '周期的谷底：失业高企、物价低迷、企业成批退出、信心跌到最低。',
    '谷底时资源大量闲置，扩张性财政的乘数最大，但赤字也跑得最快。',
    ['businessCycle', 'recession', 'recovery', 'deflation']),
  T('recovery', '复苏', 'macro', PHASE('recovery'),
    '周期的上行段：库存出清、订单回暖，企业重新招人，产出缺口由负转正。',
    '产能便宜、劳动力充裕，是最容易被人忽略、却最适合布局的阶段。',
    ['businessCycle', 'depression', 'boom']),
  T('accelerator', '加速原理', 'macro', ALL(STG(1), PEAK('cycleIndex', 0.5)),
    '需求的微小增长会引致投资成倍扩张，需求一停投资就断崖式回落。',
    '它是把温和的存货波动放大成真正繁荣与衰退的引擎——把「扩产意愿」拧高，波动会更剧烈。',
    ['investment', 'businessCycle', 'boom']),
  T('automaticStabilizer', '自动稳定器', 'macro',
    ALL(ANY(EVER('welfare', '>=', 0.3), EVER('taxRate', '>=', 0.3), EVER('publicSpend', '>=', 0.5)),
      ANY(PHASE('recession'), PHASE('depression'))),
    '无需政府临时决策、能自动平抑波动的制度安排：累进税、失业救济、福利转移。',
    '把福利或税率拧高，你会看到衰退的谷底被削平——代价是财政与长期增速。',
    ['businessCycle', 'welfare', 'taxRate', 'depression']),
  T('lafferCurve', '拉弗曲线', 'macro', ALL(EVER('taxRate', '>=', 0.4), TROUGH('treasury', 0)),
    '税率过高会抑制税基，反而使税收收入下降。',
    '把税率拉到 40% 以上再看财政，你就能亲手画出这条曲线。',
    ['taxRate', 'fiscal']),
  T('stagflation', '滞胀', 'macro', KEEP('stagflation', ALL(GT('unemploymentRate', 0.08), GT('cpi', 105)), 3),
    '高通胀与高失业同时出现的糟糕组合。',
    '成本推动型通胀叠加需求萎缩时会撞上它，常规手段两头不讨好。',
    ['inflation', 'unemployment', 'phillipsCurve']),
  T('potentialOutput', '潜在产出', 'macro', ALL(STG(3), M(48)),
    '资源充分利用时城市能生产的产出上限。',
    '潜在产出由劳动力、资本与生产率决定，政策只能短期超越它。',
    ['productivity', 'outputGap']),
  T('outputGap', '产出缺口', 'macro',
    ALL(STG(3), ANY(PEAK('unemploymentRate', 0.08), LT('outputGap', -0.05), GT('outputGap', 0.05))),
    '实际产出与潜在产出之间的差额。',
    '缺口为正说明经济过热、通胀压力大；为负说明资源闲置。',
    ['potentialOutput', 'businessCycle', 'accelerator']),
];

export function termsByChapter(ch: Chapter): TermDef[] {
  return TERMS.filter((t) => t.chapter === ch);
}

export function termByKey(key: string): TermDef | undefined {
  return TERMS.find((t) => t.key === key);
}

// 名词是否已进入图谱：由条件判定，而不是「到第几个月」
export function termUnlocked(key: string, state: SimState): boolean {
  const t = termByKey(key);
  if (!t) return false;
  return reqMet(t.req, buildCtx(state));
}

// 某杠杆是否因「对应名词已解锁」而可用
export function leverTermUnlocked(leverId: string, state: SimState): boolean {
  const gate = leverGate(leverId);
  if (!gate) return true; // 没有绑定名词的杠杆不受此限
  return state.unlocked.includes(gate.key);
}

// 某指标是否因「对应名词已解锁」而可显示
export function metricTermUnlocked(metric: string, state: SimState): boolean {
  const gate = metricGate(metric);
  if (!gate) return true;
  return state.unlocked.includes(gate.key);
}

export function metricGate(metric: string): TermDef | undefined {
  return TERMS.find((t) => t.unlocks?.metrics?.includes(metric));
}

export function leverGate(leverId: string): TermDef | undefined {
  return TERMS.find((t) => t.unlocks?.levers?.includes(leverId));
}

export function termProgress(state: SimState): { unlocked: number; total: number } {
  return { unlocked: state.unlocked.filter((k) => termByKey(k)).length, total: TERMS.length };
}

// ── 概念分层：按「循环轮次」逐层解锁 ──
// 90 个名词一次全亮会让玩家看不过来，也没有关联感。现在按条件难度分 5 层，
// 第 N 轮只放出第 N 层——每回到同一个主体，都只比上一轮深一点点。
export const TIER_COUNT = 5;

// 条件的"深度评分"：越依赖长期状态与极端处境的，越晚出现
function reqDepth(r: Req): number {
  switch (r.k) {
    case 'month':
      return r.n <= 0 ? 0 : 1;
    case 'stage':
      return 1 + r.n * 1.2; // 阶段门槛越高越晚
    case 'lever':
      return 2;
    case 'leverEver':
      return 2.4;
    case 'gt':
    case 'lt':
      return 2.2;
    case 'peak':
    case 'trough':
      return 3.2;
    case 'orient':
      return 3.6;
    case 'round':
      return 1 + r.n;
    case 'streak':
      return 3.4 + Math.min(1.2, r.n * 0.2);
    case 'all':
      return Math.max(...r.of.map(reqDepth)) + (r.of.length > 1 ? 0.3 : 0);
    case 'any':
      return Math.min(...r.of.map(reqDepth));
    default:
      return 2;
  }
}

const TERM_TIER: Record<string, number> = {};
(function assignTiers(): void {
  const scored = TERMS.map((t) => ({ key: t.key, d: reqDepth(t.req) }));
  scored.sort((a, b) => a.d - b.d || a.key.localeCompare(b.key));
  const per = Math.ceil(scored.length / TIER_COUNT);
  scored.forEach((s, i) => {
    TERM_TIER[s.key] = Math.max(1, Math.min(TIER_COUNT, Math.floor(i / per) + 1));
  });
})();

export function termTier(key: string): number {
  return TERM_TIER[key] ?? 1;
}

export function termsOfTier(n: number): TermDef[] {
  return TERMS.filter((t) => termTier(t.key) === n);
}

// 当前轮次里「已解锁 / 总数」，供图谱面板显示本层进度
export function tierProgress(state: SimState): {
  tier: number;
  unlocked: number;
  total: number;
} {
  const tier = state.cycle?.round ?? 1;
  const list = termsOfTier(Math.min(TIER_COUNT, tier));
  const unlocked = list.filter((t) => state.unlocked.includes(t.key)).length;
  return { tier: Math.min(TIER_COUNT, tier), unlocked, total: list.length };
}
