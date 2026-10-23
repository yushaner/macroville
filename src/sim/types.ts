// 实体与状态类型定义（MacroVille 经济模型）

export type TileType =
  | 'empty'
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'road'
  | 'power'
  | 'water'
  | 'school'
  | 'hospital'
  | 'park';

// 道路等级：0 = 非道路；1 支路（红线 15m）2 次干道（30m）3 主干道（45m）
export type RoadClass = 0 | 1 | 2 | 3;

// 地块不再是「一个色块」，它是一个带规划指标的街区，同时随经济运行结果逐月变化。
// 这些属性既受经济运行结果影响（人多 -> 入住率高 -> 地价涨），也反过来影响经济
// （污染 -> 满意度降、公共服务 -> 满意度升、交通可达 -> 商业客流）。
//
// 纯规划指标（容积率 / 建筑密度 / 绿地率 / 建筑面积 / 承载量 / 岗位数）不入库存档，
// 它们由「用途 + 等级」按 src/sim/land.ts 的国标口径现算：
// 既省存档体积，也让升级一位 № 立刻反映到承载量上。
export interface TileData {
  type: TileType; // 规划用途
  developed: boolean; // 是否已建成（未开发渲染为荒地 / 农田）
  level: number; // 1-5 现状开发强度等级（决定容积率，也就决定承载量）
  // 控规给定的容积率等级（法定上限）：现状只能在这条线以内加建，level ≤ planLevel。
  // 它把「这座城市最多装 100 万人」落成了物理约束 —— 全城控规指标加总就是承载天花板。
  planLevel: number;
  pop: number; // 常住人口（真实口径，人）—— 人口的真值记在这里
  jobs: number; // 在岗岗位（真实口径，个）
  density: number; // 0-1 使用强度：住区=入住率，商业=客流，工业=开工强度
  landValue: number; // 楼面地价：元/㎡
  pollution: number; // 0-1 污染累积
  amenity: number; // 0-1 学校医院辐射的宜居度
  utility: number; // 0-1 市政配套（水 / 电 / 燃气 / 通信）覆盖水平
  transit: number; // 0-1 交通可达性（到最近主干道 / 环路的距离）
  congestion: number; // 0-1 路网饱和度（仅道路 / 商业受影响）
  roadClass: RoadClass; // 0 非道路；1 支路 2 次干道 3 主干道
  firmId: number | null; // 坐落在该地块上的企业样本
  hhCount: number; // 落在该地块的家庭样本数（用于统计与地图详情）
}

export interface City {
  width: number;
  height: number;
  tiles: TileData[]; // 长度 = width * height
  originX: number; // 城市原点（中轴线交点）：所有区位、通勤、环线的计算基准
  originY: number;
}

export type Sector = 'basic' | 'manufacturing' | 'service';

// 城市发展阶段：随人口与存续时间推进，决定城市规模、可出现的设施与企业数量。
// 细分为 8 档（村落 → 全球城市），每档再归入 4 个 tier，视角解锁按 tier 判定。
export type StageId =
  | 'hamlet'
  | 'village'
  | 'town'
  | 'smallCity'
  | 'midCity'
  | 'bigCity'
  | 'metropolis'
  | 'globalCity';

// 城市定位：政策组合长期偏向某一侧，城市会长成不同的样子。
// 它不是玩家直接选的标签，而是"你一直拧哪些旋钮"涌现出来的结果。
export type CityOrientation = 'balanced' | 'industrial' | 'commercial' | 'tech' | 'eco';

// 玩家视角：随城市成长逐步解锁（个人 → 企业 → 政府）
export type Perspective = 'household' | 'firm' | 'gov';

// 经济周期四阶段：繁荣 → 衰退 → 萧条 → 复苏
export type CyclePhase = 'boom' | 'recession' | 'depression' | 'recovery';

// 经济周期状态：由「内生存货周期 + 外生冲击 + 政策调制」三者合成。
// 它不是叠加在结果上的装饰——需求乘数、投资乘数、存货意愿都由它驱动，
// 最后才涌现成 GDP、就业与物价的起落。
export interface BusinessCycleState {
  phase: CyclePhase;
  phaseMonths: number; // 当前阶段已持续月数（带最短持续期，避免闪烁）
  phaseCount: Record<CyclePhase, number>; // 各阶段累计经历过几次
  index: number; // -1..1 合成周期指数
  prevIndex: number; // 上月指数（算斜率判定阶段用）
  amplitude: number; // 波动幅度（政策可调）
  period: number; // 波长（月）
  t: number; // 周期内相位
  shock: number; // AR(1) 外生冲击
  demandMult: number; // 本月消费/总需求乘数
  investMult: number; // 本月投资乘数（波动更大 = 加速原理）
  confidence: number; // -1..1 景气信心，影响家庭与企业行为
  potentialOutput: number; // 潜在产出（趋势线）
  outputGap: number; // 产出缺口（实际-潜在）/潜在
  peakIndex: number;
  troughIndex: number;
  cycleCount: number; // 已走完的完整周期数
  trend: number; // 潜在产出（总量，= 人均趋势 × 人口）
  trendPerHead: number; // 人均产出的滤波中间量（产出缺口按人均口径计算）
  history: number[]; // 周期指数序列（画图）
  gapHistory: number[]; // 产出缺口序列
  jump?: { month: number; mag: number }; // 最近一次大冲击（用于提示玩家）
}

// 一轮循环 = 个人 → 企业 → 政府 各走一段；走完回到个人视角进入下一轮。
// 每轮解锁更深一层的概念，让玩家反复经过同一批主体、每次看到更深的机制。
export interface CycleState {
  round: number; // 第几轮，从 1 开始
  phase: Perspective; // 本轮当前主导视角
  phaseMonths: number; // 当前视角已主导的月数
  roundMonths: number; // 本轮已累计的月数（兜底：慢节奏蓝图不能永远卡在第一轮）
  visited: Perspective[]; // 本轮已经走过的视角
  unlockedThisRound: string[]; // 本轮新解锁的名词
  roundsPlanned: number; // 计划总轮数（3-5）
  lastUnlockMonth: number; // 上一次解锁名词的月份（用于解锁冷却，避免一次弹出一堆）
}

export interface Household {
  id: number;
  tile: number;
  skill: number; // 0-100
  savings: number;
  wage: number; // 当前月薪（失业为 0）
  employed: boolean;
  employerId: number | null;
  satisfaction: number; // 0-100
  consumption: number; // 本月计划消费额
  seeking: boolean; // 是否进入劳动力市场求职（受劳动力参与率影响）
}

// 家庭视角旋钮：典型家庭行为参数（作为群体行为假设作用于全体家庭）
export interface HouseholdParams {
  [key: string]: number; // 便于按 target 动态读写
  savingsRate: number; // 0-0.6 收入中用于储蓄的比例
  consumptionPropensity: number; // 0.6-1.4 边际消费倾向放大
  laborParticipation: number; // 0.5-1 劳动力参与率（求职意愿）
  skillInvest: number; // 0-1 技能/教育投入
  riskAppetite: number; // 0-1 风险偏好（高→更愿消费，低→更爱储蓄）
}

// 企业视角旋钮：典型企业行为参数（作为群体行为假设作用于全体企业）
export interface FirmParams {
  [key: string]: number; // 便于按 target 动态读写
  markup: number; // 0-1 加价率（定价锚）
  wageMultiplier: number; // 0.5-2 工资出价相对基准倍数
  expansion: number; // 0-1 扩产意愿（盈利时扩张产能）
  rdInvest: number; // 0-1 研发投入（提升单位产出）
  inventoryStrategy: number; // 0-1 库存策略（产出缓冲强度）
}

export interface Firm {
  id: number;
  sector: Sector;
  tile: number;
  employees: number[];
  capital: number;
  inventory: number;
  price: number;
  output: number; // 本月产量
  wageOffered: number;
  profit: number;
  revenue: number; // 本月销售额（用于 GDP 统计）
  powered: boolean;
  capacity: number; // 最大雇员数
  lossMonths: number; // 连续亏损月数；长期亏损且无人可裁的企业会退出市场
}

export interface Government {
  treasury: number;
  taxRate: number; // 0-0.5
  minWage: number;
  subsidy: Record<Sector, number>;
  publicSpend: number; // 0-1
  // 随游戏进程解锁的进阶杠杆
  industrySubsidy: number; // 0-1 统一产业补贴（映射到 subsidy 各 sector）
  eduSubsidy: number; // 0-1 研发/人力资本补贴
  tradeOpenness: number; // 0-1 贸易开放度（放大总需求）
  welfare: number; // 0-1 福利支出（转移支付）
}

// 玩家痕迹与历史极值：名词解锁靠它判定「你做过什么、城市变成什么样」。
// 挂机不会推进它——只有真的拧旋钮、真的把经济跑出某种状态，对应概念才会解锁。
export interface Tracking {
  leverMax: Record<string, number>; // 玩家把每个旋钮拧到过的最高值
  leverMin: Record<string, number>; // 玩家把每个旋钮拧到过的最低值
  peak: Record<string, number>; // 各指标历史最高
  trough: Record<string, number>; // 各指标历史最低
  streak: Record<string, number>; // 连续满足某条件的月数
}

export interface Indicators {
  month: number;
  year: number;
  population: number;
  employmentRate: number; // 0-1
  avgWage: number;
  cpi: number; // 指数，基准 100
  gdp: number;
  treasury: number;
  gini: number; // 0-1
  happiness: number; // 0-100
  // —— 经济周期 ——
  cyclePhase: CyclePhase;
  cycleIndex: number; // -1..1
  outputGap: number; // 负=资源闲置，正=过热
  potentialOutput: number;
}

export interface ConceptTrigger {
  id: string;
  title: string;
  chapter: 'micro' | 'industrial' | 'macro';
}

// 每月追加一条的扩展时间序列（视角专属变量、涌现量等），供顶部变量条画累积曲线
export interface Series {
  disposableIncome: number[];
  livingStandard: number[];
  wealth: number[];
  resilience: number[];
  avgProfit: number[];
  capacityUtil: number[];
  avgPrice: number[];
  revenue: number[];
  bankruptcies: number[]; // 本月破产/退出企业数
  poorShare: number[]; // 储蓄不足以支撑 1 个月消费的家庭占比
  maxLandValue: number[];
  vacancyRate: number[];
  [key: string]: number[];
}

export interface SimState {
  seed: number;
  stage: StageId; // 当前发展阶段（8 档细分）
  // 真实总户数：人口的真值。
  // households 数组只是「统计样本」——一座百万人口的城市不可能真的建 38 万个家庭对象，
  // 我们只模拟几千户代表性家庭，再乘以 hhScale 换算成真值（见 src/sim/scale.ts）。
  realHouseholds: number;
  peakStage: StageId; // 历史最高阶段；视角与部分指标按峰值解锁，避免城市衰退后又被锁回去
  orientation: CityOrientation; // 当前城市定位（由政策组合涌现）
  city: City;
  households: Household[];
  firms: Firm[];
  gov: Government;
  householdParams: HouseholdParams;
  firmParams: FirmParams;
  month: number;
  indicators: Indicators;
  history: Indicators[]; // 时间序列，供图表
  series: Series; // 视角变量与涌现量的累积曲线
  unlocked: string[]; // 已解锁概念 / 名词的 key
  tracking: Tracking; // 玩家痕迹与历史极值（解锁判定用）
  cycle: CycleState; // 循环式玩法：第几轮、当前主导视角
  business: BusinessCycleState; // 经济周期（繁荣/衰退/萧条/复苏）
  quiz: QuizState; // 闯关问答：积分、连对、奖杯
  blueprint: BlueprintId; // 开局选定的城市蓝图（初始参数设定）
  prevCpi: number;
  nextId: number; // 自增 id 分配
  // 数值口径版本：2 = 元 / 件 / 元每平方米 / 常住人口
  // 3 = 实数城市口径：地块按 250m 街区计量（容积率 / 承载量），家庭为代表性样本
  // （旧版本 1 是无量纲抽象单位，读档时由 save.upgradeUnits 换算）
  format?: number;
}

// 闯关问答进度：每解锁一个名词就弹一道题，答对积分，累计奖杯。
// 通关全部名词 ≈ 走完一遍中级经济师的知识地图。
export interface QuizAttempt {
  ok: boolean; // 是否答对过
  tries: number; // 累计尝试次数
  firstTry: boolean; // 是否一次答对
}

export interface QuizState {
  points: number; // 累计积分
  correct: number; // 答对题数（去重）
  wrong: number; // 累计答错次数
  streak: number; // 当前连对
  bestStreak: number; // 最高连对
  answered: Record<string, QuizAttempt>; // key = 名词 key
  trophies: string[]; // 已获得奖杯 id
}

// 开局蓝图：玩家在开局设定的初始条件，决定城市会长成什么样。
// 不同蓝图 → 不同的初始参数与地块构成 → 个体博弈跑出不同的涌现结果。
export type BlueprintId =
  | 'rural'
  | 'marketTown'
  | 'factory'
  | 'port'
  | 'campus'
  | 'greenfield';
