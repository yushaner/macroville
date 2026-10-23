// 可调参数与初始值（平衡护栏集中在此，便于调参与社区贡献「情景预设」）
//
// ── 单位口径（详见 src/data/units.ts）──
//   钱 = 元（¥）｜时间 = 月｜人口 = 人（1 家庭方块 = 1 户 × 2.6 人）
//   物资 = 件（标准品，基准价 ¥100/件）｜土地 = 元/㎡（楼面地价）｜指数 = 点（CPI 基期 100）
// 标定锚点：税前月薪 ¥10,000、每人每月产出 100 件（月产值约 ¥13,000）、
//           20 人企业月营收约 ¥26 万、户均月开销约 ¥8,000。

export const CONFIG = {
  // 潜在规划图：比任何阶段的实际建成区都大，城市长到哪、视野就开到哪。
  // 地图按「当前阶段的可视半径」取景，所以开局只看见家门口的几条街，
  // 到大都市时才拉远看到整座城——格子会随视野变大而变小。
  // 每格 = 边长 250 米的街区（毛用地 6.25 万㎡），全图 56×56 = 14km×14km ≈ 196km²，
  // 相当于一座特大城市的总体规划区。
  GRID_W: 56,
  GRID_H: 56,
  ROAD_REACH: 25, // 路网规划半径（格）： beyond 之外是农田与生态绿地，不预铺道路

  // 代表性样本：一座百万人口的城市不可能真的建 38 万个家庭对象，
  // 我们只模拟几千户「代表性家庭」，再乘以 hhScale 换算成真值。
  // 每个样本最多代表这么多户真实家庭；样本数随人口增长到 MAX_SAMPLES 封顶。
  HH_PER_SAMPLE_MAX: 130, // 户/样本
  MIN_SAMPLES: 600, // 样本下限：太少了基尼、失业率这些分布指标会失去统计意义
  MAX_SAMPLES: 3_200, // 样本上限：再多就该让每个样本代表更多户，而不是继续加对象

  BASE_PRICE: 100, // 标准品基准价：元/件
  INITIAL_HOUSEHOLDS: 600, // 初始家庭数（户）
  INITIAL_FIRMS: 40,
  INITIAL_TREASURY: 8_000_000, // 起始财政结余：元（¥800 万）

  DEFAULT_TAX: 0.2,
  DEFAULT_MIN_WAGE: 2_500, // 月最低工资：元/月（约为市场工资 ¥10,000 的 25%，与现实一致）
  DEFAULT_PUBLIC_SPEND: 0.3,

  // 家庭视角默认行为参数
  DEFAULT_SAVINGS_RATE: 0.2,
  DEFAULT_CONS_PROP: 1.0,
  DEFAULT_LABOR_PART: 0.9,
  DEFAULT_SKILL_INVEST: 0.2,
  DEFAULT_RISK_APP: 0.5,

  // 基准工资：一名满产雇员的月薪（元/月）= 基准价 × 80% × 每人月产量。
  // 工资出价 = 基准工资 × 工资出价倍数；默认 1.25 → ¥10,000/月，
  // 与 2024 年城镇非私营单位平均工资（¥10,342）同一量级。
  BASE_WAGE: 8_000,
  DEFAULT_MARKUP: 0.3,
  DEFAULT_WAGE_MULT: 1.25,
  DEFAULT_EXPANSION: 0.3,
  DEFAULT_RD_INVEST: 0.2,
  DEFAULT_INV_STRATEGY: 0.4,

  // 经济循环的三大需求：消费 C + 投资 I + 政府支出 G。
  // 税收与储蓄会从循环中漏出，必须由 G 和 I 补回来，否则企业收入永远覆盖不了工资。
  // 公共支出按「常住人口」计（元/人·月）：滑杆拉满时 ¥2,000/人·月 ≈ ¥7,200/人·年，
  // 与一般公共预算支出的实际水平同一量级（≈ ¥2 万元/人·年）。
  GOV_SPEND_PER_CAPITA: 2_000,
  SAVINGS_INVEST_K: 0.8, // 家庭储蓄中转化为投资需求的比例（储蓄 → 银行 → 企业投资）
  PROFIT_INVEST_K: 0.6, // 企业把当月利润再投资的比例（剩下的作为分红沉淀，不再形成需求）

  LABOR_PER_WORKER: 100, // 每人每月产出：件/月
  PRICE_ADJ_K: 0.07, // 定价对「产出售罄率」的反应强度（过大会让物价长期偏离锚）
  PRICE_MIN: 0.2, // 相对基准价下限（→¥20/件）
  PRICE_MAX: 5, // 相对基准价上限（→¥500/件）
  INVENTORY_DECAY: 0.06, // 库存月折旧率：卖不掉的货会过时、损耗、清仓处理
  // 中间投入（原料、零部件、外购服务）占营收的比例。
  // 没有它，营收减掉工资剩下的全被算成利润，利润率会虚高到 40%；
  // 有了它，增加值 = 营收 × 70%，利润率回到 10%~15%，GDP 才是真正的"增加值"口径。
  MATERIAL_K: 0.3,

  FIRM_CAPACITY: 20,
  FIRM_CAPACITY_MAX: 60, // 扩产上限
  FIRM_UPKEEP: 6_000, // 企业月度固定开销（租金水电物业）：元/月
  FIRM_CAPITAL: 200_000, // 企业初始固定资产：元
  FIRM_INIT_INVENTORY: 2_000, // 企业开局库存：件（约等于满员一个月的产量）

  // 家庭/企业行为系数
  SKILL_GROWTH_K: 1.5, // skillInvest 对技能成长的加成
  SKILL_OUTPUT_K: 0.6, // 员工技能对单位产出的加成上限（人力资本 → 生产率 → 生活水平）
  RD_OUTPUT_K: 0.5, // rdInvest 对单位产出的加成上限
  CAPACITY_GROWTH_K: 1.5, // expansion 对每月产能增量的加成
  CONS_SAVINGS_K: 0.06, // riskAppetite 对储蓄动用的系数

  // 家庭储蓄锚：收入 ~¥10,000/月、月开销 ~¥8,000 时的稳态储蓄约 ¥8 万，
  // 开局按 5~30 万随机（新来的家庭带着不同程度的家底），后续自行收敛。
  INIT_SAVINGS_MIN: 50_000,
  INIT_SAVINGS_MAX: 300_000,
  // 满意度里的"储蓄缓冲"折算：¥6 万 / 档（约 7 个月开销给满 +10 分）
  SAT_BUFFER_SCALE: 60_000,

  MIGRATION_CAP: 0.045, // 每月迁出/迁入人口占比上限
  SAT_MIGRATION_K: 0.5, // 满意度偏离目标线 → 迁移率的换算强度
  // 岗位空缺对迁入的拉动：企业招不到人，城市就会持续吸引外来人口。
  // 这两项决定村庄→百万人口城市的成长节奏（目标：约 15～20 年走完）。
  JOB_PULL_K: 0.2,
  JOB_PULL_CAP: 0.04, // 岗位 + 工资拉力每月最多带来的人口占比（2 千人 → 100 万人约 15 年）
  // 失业把人推走：净迁入 = 岗位拉力 − 失业率 × 该系数。
  // 岗位拉满时（0.02/月）对应的稳态失业率 ≈ 5.5%，与城镇调查失业率的常态水平相当。
  UNEMP_PULL: 0.36,
  SAT_TARGET: 59, // 满意度目标线：高于它人口净迁入，低于它净迁出
  SATISFACTION_MIN: 0,
  SATISFACTION_MAX: 100,

  START_YEAR: 2026,

  // 进阶杠杆成本（每 tick 财政支出，单位：元/人·月 或 元/企业·月）
  INDUSTRY_SUBSIDY_COST: 4_000, // 产业补贴滑杆拉满时，每家企业每月拿到的财政资金
  SUBSIDY_PER_EMPLOYEE: 1_000, // 企业侧的稳岗补贴强度：元/人·月（滑杆拉满时）
  EDU_SUBSIDY_COST: 3_000, // 研发/人力资本补贴：元/企业·月
  WELFARE_COST_PER_CAPITA: 600, // 福利支出的财政成本：元/人·月（滑杆拉满时）
  TRADE_DEMAND_K: 1.2, // 贸易开放度对总需求的放大系数
  EDU_WAGE_K: 0.06, // 研发补贴对工资的加成
  WELFARE_BENEFIT_K: 6_000, // 福利对失业家庭的转移支付：元/户·月（滑杆拉满时）

  // 土地：楼面地价按元/㎡计价（三四线城市住宅约 ¥1,000~4,000/㎡）
  LAND_VALUE_MIN: 100, // 地价下限：元/㎡（远郊荒地）
  LAND_VALUE_MAX: 8_000, // 地价上限：元/㎡（核心 CBD）
  LAND_VALUE_FALLBACK: 600, // 旧存档缺字段时的兜底：元/㎡

  // 失业救济：按最低工资的一个比例发放（现实中失业保险金约为最低工资的 70%~80%）
  UNEMP_BENEFIT_RATIO: 0.5,
  CONSUMPTION_FLOOR: 8_000, // 一户一个月的基本开销基准：元/月（判定"入不敷出"用）
};

export const SECTORS = ['basic', 'manufacturing', 'service'] as const;

// 各产业初始占比（basic 基础/零售、manufacturing 制造、service 服务）
export const SECTOR_INITIAL_SHARE: Record<string, number> = {
  basic: 0.4,
  manufacturing: 0.35,
  service: 0.25,
};
