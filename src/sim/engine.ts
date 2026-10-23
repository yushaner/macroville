// 仿真引擎：init / tick / applyPolicy + 概念触发检测。

import { CONFIG } from './config';
import { LEVEL_MAX } from './land';
import { generateCity, makeFirm } from '../data/cityGen';
import { blueprintById, DEFAULT_BLUEPRINT, rollGreenfield } from '../data/blueprints';
import { govDemandSample, stepGovernment } from './government';
import { updateTiles, ensureTileFields } from './tiles';
import { stepFirms } from './firms';
import { assignJobs, laborMarket, stepHouseholds } from './households';
import { averagePrice, computeIndicators, employmentRateOf, laborForceOf } from './macro';
import { LESSONS } from '../data/lessons';
import { RNG } from './rng';
import { emergeStats } from './requirements';
import {
  hhScaleOf, syncRealHouseholds, targetSamples,
} from './scale';
import { distributePopulation, pickTileByPop, removePopulation, attractivenessOf } from './population';
import { HOUSEHOLD_SIZE } from '../data/units';
import { ensureTracking, evaluateUnlocks, seedUnlocks, tickUnlocks, type UnlockEvent } from './unlocks';
import { ensureCycle, initCycle, tickCycle, type CycleEvent } from './cycles';
import {
  cycleShape,
  ensureBusinessCycle,
  initCycleState,
  stepBusinessCycle,
  updateOutputGap,
} from './businessCycle';
import { emptyQuiz, normalizeQuiz } from '../state/quiz';
import {
  developedTilesOfType,
  evaluateOrientation,
  evaluateStage,
  growCity,
  stageById,
  stageIndex,
  firmQuota,
  vacantFirmTiles,
  type StageDef,
} from './stages';
import type {
  BlueprintId,
  ConceptTrigger,
  FirmParams,
  Government,
  Household,
  HouseholdParams,
  Series,
  SimState,
  StageId,
  TileData,
} from './types';

const HISTORY_CAP = 600;
const SERIES_CAP = 600;
// 摩擦性失业：换工作过程中的常态失业率。低于这个水平不算「城市在赶人走」。
const FRICTIONAL_UNEMP = 0.04;

export interface TickResult {
  triggered: ConceptTrigger[];
  stageChange: StageChange | null;
  unlocked: UnlockEvent[]; // 本月因玩家决策 / 城市状态而新解锁的名词
  cycleEvent: CycleEvent | null; // 视角轮转 / 进入下一轮
  bankruptcies: number; // 本月倒闭的企业数
}

export function emptySeries(): Series {
  return {
    disposableIncome: [],
    livingStandard: [],
    wealth: [],
    resilience: [],
    avgProfit: [],
    capacityUtil: [],
    avgPrice: [],
    revenue: [],
    bankruptcies: [],
    poorShare: [],
    maxLandValue: [],
    vacancyRate: [],
  };
}

export interface StageChange {
  from: StageId;
  to: StageId;
  name: string;
  icon: string;
  unlockNote: string;
  up: boolean; // true 升级 / false 衰退回落
}

export class SimEngine {
  init(seed: number, blueprint: BlueprintId = DEFAULT_BLUEPRINT): SimState {
    const bp = blueprintById(blueprint);
    // 「自由实验」蓝图：初始参数与地块倾向全部交给种子决定
    const rolled = bp.id === 'greenfield' ? rollGreenfield(seed) : null;
    const opts = {
      pop: bp.pop,
      industryBias: rolled?.industryBias ?? bp.industryBias,
      commercialBias: rolled?.commercialBias ?? bp.commercialBias,
    };
    const gen = generateCity(seed, opts);
    const gov: Government = {
      treasury: CONFIG.INITIAL_TREASURY,
      taxRate: CONFIG.DEFAULT_TAX,
      minWage: CONFIG.DEFAULT_MIN_WAGE,
      subsidy: { basic: 0, manufacturing: 0, service: 0 },
      publicSpend: CONFIG.DEFAULT_PUBLIC_SPEND,
      industrySubsidy: 0,
      eduSubsidy: 0,
      tradeOpenness: 0,
      welfare: 0,
    };
    const householdParams: HouseholdParams = {
      savingsRate: CONFIG.DEFAULT_SAVINGS_RATE,
      consumptionPropensity: CONFIG.DEFAULT_CONS_PROP,
      laborParticipation: CONFIG.DEFAULT_LABOR_PART,
      skillInvest: CONFIG.DEFAULT_SKILL_INVEST,
      riskAppetite: CONFIG.DEFAULT_RISK_APP,
    };
    const firmParams: FirmParams = {
      markup: CONFIG.DEFAULT_MARKUP,
      wageMultiplier: CONFIG.DEFAULT_WAGE_MULT,
      expansion: CONFIG.DEFAULT_EXPANSION,
      rdInvest: CONFIG.DEFAULT_RD_INVEST,
      inventoryStrategy: CONFIG.DEFAULT_INV_STRATEGY,
    };
    // 蓝图覆盖初始参数：这是「不同开局跑出不同结果」的源头
    Object.assign(gov, bp.gov, rolled?.gov ?? {});
    Object.assign(householdParams, bp.household, rolled?.household ?? {});
    Object.assign(firmParams, bp.firm, rolled?.firm ?? {});
    if (gov.industrySubsidy !== undefined) {
      gov.subsidy = {
        basic: gov.industrySubsidy,
        manufacturing: gov.industrySubsidy,
        service: gov.industrySubsidy,
      };
    }
    const state: SimState = {
      seed,
      stage: 'hamlet',
      peakStage: 'hamlet',
      orientation: 'balanced',
      blueprint: bp.id,
      realHouseholds: gen.realHouseholds,
      city: gen.city,
      households: gen.households,
      firms: gen.firms,
      gov,
      householdParams,
      firmParams,
      month: 0,
      indicators: {
        month: 1,
        year: CONFIG.START_YEAR,
        population: 0, // 预热阶段由 computeIndicators 按「户数 × 户均人口」填
        employmentRate: 0,
        avgWage: 0,
        cpi: 100,
        gdp: 0,
        treasury: gov.treasury,
        gini: 0,
        happiness: 60,
        cyclePhase: 'recovery',
        cycleIndex: 0.1,
        outputGap: 0,
        potentialOutput: 0,
      },
      history: [],
      series: emptySeries(),
      unlocked: [],
      tracking: { leverMax: {}, leverMin: {}, peak: {}, trough: {}, streak: {} },
      cycle: initCycle(),
      business: initCycleState(),
      quiz: emptyQuiz(),
      prevCpi: 100,
      nextId: gen.nextId,
      format: 3,
    };
    // 用企业参数初始化定价与工资出价
    for (const f of state.firms) {
      f.price = clampPrice(CONFIG.BASE_PRICE * (1 + firmParams.markup));
      f.wageOffered = Math.max(state.gov.minWage, CONFIG.BASE_WAGE * firmParams.wageMultiplier);
    }
    // 人口真值以「地块承载」为准：generateCity 已经把初始住户摊到住区上，这里汇总回来。
    // 缺了这一步，第一帧的 realHouseholds 还是画布上的户数，
    // 而抽样倍率 hhScale 就会整体偏大，人口、GDP、财政会被同时放大好几十倍。
    syncRealHouseholds(state);
    resampleTo(state, targetSamples(state));
    // 预热：先做一次劳动力匹配与企业稳态记账。
    // 否则开局快照是一座「0 就业、0 GDP」的空城——玩家还没点开始就看到失业率 100%，
    // 而第一帧的仪表盘、顶部变量条、累积曲线起点全是假的。
    laborMarket(state);
    for (const f of state.firms) {
      const productivity =
        1 + firmParams.rdInvest * CONFIG.RD_OUTPUT_K + 0.5 * CONFIG.SKILL_OUTPUT_K;
      f.output = f.employees.length * CONFIG.LABOR_PER_WORKER * productivity;
      f.inventory = f.output * 0.6; // 稳态库存：产销平衡，不会一开局就触发涨价或降价
      f.revenue = f.output * f.price; // GDP 起点按「生产多少卖多少」计
      f.profit = f.revenue - f.employees.length * f.wageOffered - CONFIG.FIRM_UPKEEP;
    }
    // 预热一次指标
    state.indicators = computeIndicators(state, 100);
    // 预热周期：先把潜在产出锚到开局的产出水平，否则第一个月的产出缺口会是一个假的极大值
    stepBusinessCycle(state);
    updateOutputGap(state, state.indicators.gdp);
    state.indicators = computeIndicators(state, 100);
    // 预热一次地块：让开局地图上就有可信的密度、地价与公共服务分布
    updateTiles(state);
    // 点亮开局即可见的基础名词（只放最浅的一批），并记录初始历史极值
    ensureTracking(state);
    ensureCycle(state);
    seedUnlocks(state);
    updateSeries(state, 0);
    return state;
  }

  tick(state: SimState): TickResult {
    // 先把人口真值从地块上汇总回来：人口住在 tile.pop，而不是 households 数组的长度。
    syncRealHouseholds(state);
    // 代表性倍率：本月每个家庭样本 / 企业样本代表多少真实主体
    const scale = hhScaleOf(state);

    // 经济周期先走一步：本月的景气水平决定需求、投资与存货意愿，
    // 之后所有主体的行为都在这个"天气"下发生——周期不是事后叠加的装饰。
    const bc = stepBusinessCycle(state);
    laborMarket(state);
    stepHouseholds(state, scale);

    // ── 总需求 = 消费 C + 投资 I + 政府支出 G，再除以物价换算成实物需求量 ──
    // （消费额是货币、库存是实物，必须先除以价格才能比大小，否则供需永远对不上。）
    //
    // 下面这段总需求全部按「代表性样本」计：营业收入与库存是同一家的账，
    // 需求量必须和它们同口径，否则百万人口城市的需求会直接把企业库存清空、价格打上天。
    const tradeMult = 1 + state.gov.tradeOpenness * (CONFIG.TRADE_DEMAND_K - 1);
    const consumption = state.households.reduce((a, h) => a + h.consumption, 0) * tradeMult * bc.demandMult;
    // 企业之间的「中间投入」采购也是需求：上月的营收里有 30% 会变成对别的企业的订单。
    // 少了这一块，需求会凭空少掉三成，库存越堆越高。
    const prevRevenue = state.firms.reduce((a, f) => a + f.revenue, 0);
    const materialDemand = prevRevenue * CONFIG.MATERIAL_K * bc.demandMult;
    // 财政支出按真实人口 / 真实企业数计算，必须折回样本口径才能和需求、库存比大小
    const govSpend = govDemandSample(state);
    // 投资是周期里波动最大的一块（加速原理）：景气时成倍扩张，萧条时几乎停摆。
    // 这一项才是把温和的存货波动放大成真正的繁荣与衰退的引擎。
    //
    // 投资的钱有两处来源：① 居民储蓄（按消费规模折算）；② 企业留存的利润再投资。
    // 少了②，利润就会从循环里「漏掉」：企业账面利润率被越推越高（现实里 5~8%，这里能到 40%+），
    // 而总需求始终追不上产能，库存越堆越多、开工率被压到四成以下，工资跟着往下掉。
    const totalProfit = state.firms.reduce((a, f) => a + Math.max(0, f.profit), 0);
    // 投资的钱来自两处：居民储蓄（S = 收入 − 消费，经由银行变成投资）与企业留存利润。
    // 早先投资按"消费的比例"折算，储蓄率一高（比如农耕村落 34%）需求就凭空少一块，
    // 价格一路跌到 CPI 72、城市萎缩到几十人——这不是节俭的美德，是循环断了。
    const netIncome = state.households.reduce(
      (a, h) => a + (h.employed ? h.wage * (1 - state.gov.taxRate) : 0),
      0,
    );
    const householdSaving = Math.max(0, netIncome - state.households.reduce((a, h) => a + h.consumption, 0));
    const investment =
      (householdSaving * CONFIG.SAVINGS_INVEST_K + totalProfit * CONFIG.PROFIT_INVEST_K) * bc.investMult;
    const avgPrice = averagePrice(state);
    const realDemand = (consumption + materialDemand + govSpend + investment) / Math.max(0.01, avgPrice);
    // 企业账上的营收、利润、库存都按「一家代表性企业」计；
    // 但进出国库的钱必须是真值 —— 这一步统一乘以 scale。
    const bankruptcies = stepFirms(state, realDemand, scale);
    stepGovernment(state);
    // 城市边界：住宅住不下了才征地、才往路网外再铺一环
    growCity(state, stageById(state.stage));
    this.migrate(state);
    this.syncSamples(state);
    updateTiles(state); // 地块属性随本月经济结果演化（密度/地价/污染/等级/用途）

    state.month += 1;
    const indicators = computeIndicators(state, state.prevCpi);
    state.indicators = indicators;
    state.history.push(indicators);
    if (state.history.length > HISTORY_CAP) state.history.shift();
    state.prevCpi = indicators.cpi;

    // 产出缺口必须在实际产出出来之后算：它衡量的是"实际围着潜在摆动了多少"
    updateOutputGap(state, indicators.gdp);
    state.indicators.outputGap = state.business.outputGap;
    state.indicators.potentialOutput = state.business.potentialOutput;

    // 城市定位由玩家长期的政策偏向涌现；序列供顶部变量条画累积曲线
    state.orientation = evaluateOrientation(state);
    updateSeries(state, bankruptcies);

    const triggered = this.detectConcepts(state);
    const stageChange = this.syncStage(state);
    this.maintainFirms(state, stageById(state.stage));
    // 解锁判定放在阶段推进之后：阶段升级会让 STG(1)/STG(2) 类条件立刻成立
    const unlocked = tickUnlocks(state);
    const cycleEvent = tickCycle(state);
    return { triggered, stageChange, unlocked, cycleEvent, bankruptcies };
  }

  // 开局蓝图切换（重开一局时调用）
  setBlueprint(state: SimState, id: BlueprintId): void {
    state.blueprint = id;
  }

  // 城市发展阶段推进：点亮新地块 + 新企业入驻（衰退时只提示，不拆已建成的）
  private syncStage(state: SimState): StageChange | null {
    const target = evaluateStage(state);
    if (target === state.stage) return null;
    const from = state.stage;
    state.stage = target;
    // 峰值只升不降：视角与部分指标按峰值解锁，城市衰退不该把进度收回去
    if (stageIndex(target) > stageIndex(state.peakStage ?? 'village')) state.peakStage = target;
    const def = stageById(target);
    // 生态红线放开一圈：这一步不直接征地，只是允许 growCity 把边界推到新的半径
    this.growFirms(state, def);
    return {
      from,
      to: target,
      name: def.name,
      icon: def.icon,
      unlockNote: def.unlockNote,
      up: stageIndex(target) > stageIndex(from),
    };
  }

  // 每月保底补充：企业会因长期亏损倒闭，市场上也要有新玩家进场顶上。
  // 每月最多进 3 家，让「有企业死掉」这件事在数字上真的看得出来。
  private maintainFirms(state: SimState, def: StageDef): void {
    // 铺面空着也要有人来开：招商目标 = 劳动力需要的岗位 + 还空着的产业用地
    const want = firmQuota(state, def);
    // 企业总数受「阶段上限」和「闲置产业用地」双重约束：
    // 一座城市不可能在没有厂房和铺面的地方凭空开公司
    if (state.firms.length >= want) return;
    // 只有当劳动力真的被抢光了才会有人去开新公司：
    // 没有这道闸门，企业会一直进、岗位一直虚高，失业率被压成 0%，
    // 而「有人没活干」恰恰是城市衰退最该被看见的信号。
    // 但「岗位总量被用地指标卡住」是另一回事 —— 这时候铺面还空着，
    // 只是没人来开，城市会停在假充分就业上：所以这种情形必须放行招商。
    const laborForce = Math.max(1, state.households.length) * 0.9;
    const jobCapNow = state.firms.reduce((a, f) => a + f.capacity, 0);
    const jobsTooTight = jobCapNow < laborForce * 1.08;
    if (employmentRateOf(state) < 0.95 && !jobsTooTight) return;
    const room2 = vacantFirmTiles(state);
    if (room2.length === 0) return;
    const budget = Math.min(3, want - state.firms.length, room2.length);
    const rng = new RNG((state.seed + state.month * 7919) >>> 0);
    const resTiles = developedTilesOfType(state.city, 'residential');
    for (let i = 0; i < budget; i++) {
      const f = makeFirm(state.firms.length, state.nextId++, rng, room2, resTiles);
      f.price = clampPrice(CONFIG.BASE_PRICE * (1 + state.firmParams.markup));
      f.wageOffered = Math.max(state.gov.minWage, CONFIG.BASE_WAGE * state.firmParams.wageMultiplier);
      state.firms.push(f);
      const idx = room2.indexOf(f.tile);
      if (idx >= 0) room2.splice(idx, 1);
      const t = state.city.tiles[f.tile];
      if (t) t.firmId = f.id;
    }
  }

  // 补齐到该阶段应有的企业数量；同时不能超过「已出让但还没入驻」的产业用地数量
  private growFirms(state: SimState, def: StageDef): void {
    const want = Math.min(firmQuota(state, def), state.city.tiles.length);
    if (state.firms.length >= want) return;
    const room2 = vacantFirmTiles(state);
    if (room2.length === 0) return;
    const rng = new RNG((state.seed + state.month * 7919) >>> 0);
    const resTiles = developedTilesOfType(state.city, 'residential');
    while (state.firms.length < want && room2.length > 0) {
      const f = makeFirm(state.firms.length, state.nextId++, rng, room2, resTiles);
      f.price = clampPrice(CONFIG.BASE_PRICE * (1 + state.firmParams.markup));
      f.wageOffered = Math.max(state.gov.minWage, CONFIG.BASE_WAGE * state.firmParams.wageMultiplier);
      state.firms.push(f);
      const idx = room2.indexOf(f.tile);
      if (idx >= 0) room2.splice(idx, 1);
      const t = state.city.tiles[f.tile];
      if (t) t.firmId = f.id;
    }
  }

  applyPolicy(state: SimState, policy: Partial<Government>): void {
    const prevMinWage = state.gov.minWage;
    Object.assign(state.gov, policy);
    // 最低工资变化同步到企业工资报价（需结合企业视角的工资出价倍数）
    if (policy.minWage !== undefined && policy.minWage !== prevMinWage) {
      for (const f of state.firms) {
        f.wageOffered = Math.max(state.gov.minWage, CONFIG.BASE_WAGE * state.firmParams.wageMultiplier);
      }
    }
    // 统一产业补贴映射到各 sector（UI 仅暴露单一滑杆）
    if (policy.industrySubsidy !== undefined) {
      state.gov.subsidy = {
        basic: policy.industrySubsidy,
        manufacturing: policy.industrySubsidy,
        service: policy.industrySubsidy,
      };
    }
  }

  // 兼容旧存档：补齐三视角新增字段，避免读档后滑杆越界或 undefined
  normalize(state: SimState): SimState {
    if (!state.householdParams) {
      state.householdParams = {
        savingsRate: CONFIG.DEFAULT_SAVINGS_RATE,
        consumptionPropensity: CONFIG.DEFAULT_CONS_PROP,
        laborParticipation: CONFIG.DEFAULT_LABOR_PART,
        skillInvest: CONFIG.DEFAULT_SKILL_INVEST,
        riskAppetite: CONFIG.DEFAULT_RISK_APP,
      };
    }
    if (!state.firmParams) {
      state.firmParams = {
        markup: CONFIG.DEFAULT_MARKUP,
        wageMultiplier: CONFIG.DEFAULT_WAGE_MULT,
        expansion: CONFIG.DEFAULT_EXPANSION,
        rdInvest: CONFIG.DEFAULT_RD_INVEST,
        inventoryStrategy: CONFIG.DEFAULT_INV_STRATEGY,
      };
    }
    for (const h of state.households) {
      if (typeof h.seeking !== 'boolean') h.seeking = true;
    }
    for (const f of state.firms) {
      if (typeof f.lossMonths !== 'number') f.lossMonths = 0;
    }
    // 发展阶段：旧存档没有该字段时按当前人口推定，并补齐建成区标记
    if (!state.stage) state.stage = 'hamlet';
    state.stage = evaluateStage(state);
    if (!state.peakStage || stageIndex(state.peakStage) < stageIndex(state.stage)) {
      state.peakStage = state.stage;
    }
    // 循环式玩法 / 城市定位 / 时间序列：旧存档补齐
    state.orientation = state.orientation ?? evaluateOrientation(state);
    state.blueprint = state.blueprint ?? DEFAULT_BLUEPRINT;
    if (!state.series) state.series = emptySeries();
    ensureCycle(state);
    ensureTracking(state);
    // 经济周期与闯关问答：旧存档补齐，缺失时按当前进度重建
    ensureBusinessCycle(state);
    state.quiz = normalizeQuiz(state.quiz);
    // 真值口径：旧存档没有 realHouseholds，按「老规则 = 样本数即户数」补齐。
    // 之后的 tick 会立刻改用地块人口重算，所以这里只需要给一个不崩盘的初值。
    if (typeof state.realHouseholds !== 'number' || !Number.isFinite(state.realHouseholds)) {
      state.realHouseholds = state.households.length * HOUSEHOLD_SIZE;
    }
    // 旧存档的 tiles 可能是纯字符串数组（更早的版本），也可能缺这一版新增的字段。
    // 没有这些字段，承载量就算不出来（level / pop 为 undefined），第一次 updateTiles 就会炸掉。
    const legacy = state.city as unknown as {
      tiles: (string | TileData)[];
      developed?: boolean[];
      originX?: number;
      originY?: number;
    };
    if (typeof legacy.originX !== 'number') legacy.originX = Math.floor((state.city.width - 1) / 2);
    if (typeof legacy.originY !== 'number') legacy.originY = Math.floor((state.city.height - 1) / 2);
    if (legacy.tiles.length > 0 && typeof legacy.tiles[0] === 'string') {
      const oldDeveloped = legacy.developed ?? [];
      legacy.tiles = legacy.tiles.map(
        (t, i): TileData => ({
          type: t as TileData['type'],
          developed: oldDeveloped.length === legacy.tiles.length ? !!oldDeveloped[i] : true,
          level: 1,
          planLevel: LEVEL_MAX,
          pop: 0,
          jobs: 0,
          density: 0,
          landValue: CONFIG.LAND_VALUE_FALLBACK,
          pollution: 0,
          amenity: 0,
          utility: 0,
          transit: 0,
          congestion: 0,
          roadClass: (t as string) === 'road' ? 2 : 0,
          firmId: null,
          hhCount: 0,
        }),
      );
      delete (legacy as { developed?: boolean[] }).developed;
    }
    ensureTileFields(state.city);
    // 旧存档没有「每块地住了多少人」：把人口按各住区承载量摊一遍
    let resPop = 0;
    for (const t of state.city.tiles) if (t.type === 'residential' && t.developed) resPop += t.pop;
    if (resPop <= 0) {
      const resTiles = developedTilesOfType(state.city, 'residential');
      distributePopulation(state.city.tiles, resTiles, state.realHouseholds * HOUSEHOLD_SIZE);
    }
    syncRealHouseholds(state);
    return state;
  }

  // 统一入口：三视角旋钮都走这里。
  // 旋钮一动就记录痕迹并立刻结算解锁——玩家能直接看到「我调了什么 → 学到了什么」。
  applyLever(
    state: SimState,
    scope: 'gov' | 'household' | 'firm',
    target: string,
    value: number,
  ): UnlockEvent[] {
    const tr = state.tracking;
    tr.leverMax[target] = Math.max(tr.leverMax[target] ?? value, value);
    tr.leverMin[target] = Math.min(tr.leverMin[target] ?? value, value);
    // 城市定位是政策偏好的涌现结果：拧完立刻重算，玩家能马上看到自己把城市带向了哪里
    state.orientation = evaluateOrientation(state);
    // 周期形状同样是政策的产物：拧完立刻刷新振幅，玩家能当场看到
    // "我加的福利把波动削平了"或"我加的补贴把波动放大了"。
    ensureBusinessCycle(state);
    state.business.amplitude = cycleShape(state).amplitude;
    if (scope === 'gov') {
      this.applyPolicy(state, { [target]: value } as Partial<Government>);
      return evaluateUnlocks(state);
    }
    if (scope === 'household') {
      state.householdParams[target] = value;
      if (target === 'laborParticipation') rerollSeeking(state);
      return evaluateUnlocks(state);
    }
    if (scope === 'firm') {
      state.firmParams[target] = value;
      if (target === 'wageMultiplier') {
        for (const f of state.firms) {
          f.wageOffered = Math.max(state.gov.minWage, CONFIG.BASE_WAGE * value);
        }
      }
      if (target === 'markup') {
        for (const f of state.firms) f.price = clampPrice(CONFIG.BASE_PRICE * (1 + value));
      }
    }
    return evaluateUnlocks(state);
  }

  private detectConcepts(state: SimState): ConceptTrigger[] {
    const out: ConceptTrigger[] = [];
    for (const L of LESSONS) {
      if (!state.unlocked.includes(L.id) && L.check(state)) {
        state.unlocked.push(L.id);
        out.push({ id: L.id, title: L.title, chapter: L.chapter });
      }
    }
    return out;
  }

  // 人口迁移：净流量作用在「真实户数」上，落位受每块居住用地的承载量硬约束。
  //
  // 这是这一版和上一版最关键的差别：城市能不能长起来，不再只看工资和满意度，
  // 还要看有没有房子、有没有产业用地的岗位。土地供给一旦被你自己的政策卡住
  // （比如公共服务不投入、住区容积率爬不上去），人口就会停在台阶上。
  private migrate(state: SimState): void {
    const resTiles = developedTilesOfType(state.city, 'residential');
    if (resTiles.length === 0) return;
    const people = state.realHouseholds * HOUSEHOLD_SIZE;
    const avgSat =
      state.households.length > 0
        ? state.households.reduce((a, h) => a + h.satisfaction, 0) / state.households.length
        : 0;
    // 岗位空缺本身就是城市吸引力：企业在招人，就会持续有人搬进来。
    // 只靠满意度会自我熄火——移民按「城市平均水平 -1」入场，每来一批就把平均值往下拉，
    // 平均满意度被锁回目标线，城市长到一定规模就永久停摆。
    const vacancies = state.firms.reduce(
      (a, f) => a + (f.powered ? Math.max(0, f.capacity - f.employees.length) : 0), 0);
    // 景气也影响人往哪儿走：萧条年景连招人的岗位都在缩，外来人口自然不会往这儿挤。
    const cyclePull = 1 + Math.max(-0.85, Math.min(0.6, state.business?.confidence ?? 0) * 0.5);
    const samples = Math.max(1, state.households.length);
    // 拉力有两条腿，缺一条城市就会在「充分就业」时自我熄火：
    //   ① 岗位空缺：企业正招人，说明进得来就能上岗
    //   ② 工资溢价：本城月薪高于外部基准，哪怕眼下人人有活干，外面的人还是会进来
    //       —— 他们进来之后需求变大，企业再扩产招人，这才是城市持续长大的闭环。
    const vacPull = clamp(
      (vacancies / Math.max(300, samples)) * CONFIG.JOB_PULL_K * cyclePull,
      0,
      CONFIG.JOB_PULL_CAP,
    );
    const wageGap = state.indicators.avgWage / Math.max(1, CONFIG.BASE_WAGE) - 1;
    const wagePull = clamp(wageGap * 0.8, 0, CONFIG.JOB_PULL_CAP * 0.5);
    const jobPull =
      avgSat > CONFIG.SAT_TARGET - 8 ? Math.min(CONFIG.JOB_PULL_CAP, vacPull + wagePull) : 0;
    // 失业把人推走：找不到工作的城市不会无限堆积外来人口。
    //
    // 这里必须用「结构性失业」而不是月末失业率：企业裁员发生在 stepFirms 里，
    // 这些人次月就会被重新雇走，属于正常的月度流动；直接拿月末失业率当信号，
    // 会把这种流动误判成「城市在赶人走」，人口每个月被自己的失业率推回去，永远长不大。
    // 结构性失业 = 求职人数里，连现有岗位空缺都填不上的那部分。
    // 同时留一道「摩擦性失业」的免赔额 —— 现实里几个百分点的失业是换工作过程中的常态。
    const openJobs = state.firms.reduce(
      (a, f) => a + (f.powered ? Math.max(0, f.capacity - f.employees.length) : 0),
      0,
    );
    const jobless = state.households.reduce((a, h) => a + (h.seeking && !h.employed ? 1 : 0), 0);
    const structural = Math.max(0, jobless - openJobs) / Math.max(1, laborForceOf(state));
    const unempPush = CONFIG.UNEMP_PULL * Math.max(0, structural - FRICTIONAL_UNEMP) * 2;
    const satPush = Math.min(
      0,
      ((avgSat - CONFIG.SAT_TARGET) / CONFIG.SAT_TARGET) * CONFIG.SAT_MIGRATION_K,
    );
    const rate = clamp(
      satPush + jobPull - unempPush,
      -CONFIG.MIGRATION_CAP,
      CONFIG.MIGRATION_CAP,
    );
    let deltaPeople = Math.round(people * rate);

    if (deltaPeople > 0) {
      // 只往"还有空房"的地方塞：超出住房供给的部分人自来也会去别处谋生
      const placed = distributePopulation(state.city.tiles, resTiles, deltaPeople);
      deltaPeople = placed;
    } else if (deltaPeople < 0) {
      removePopulation(state.city.tiles, resTiles, -deltaPeople);
    }
    syncRealHouseholds(state);
  }

  // 抽样密度维护：人口规模变了，代表的户数跟着变，于是样本数量要缓缓跟上。
  // 每月只调整一部分，避免一次性加几百个样本把就业率、基尼这些分布指标打歪。
  private syncSamples(state: SimState): void {
    const want = targetSamples(state);
    const cur = state.households.length;
    if (want > cur) {
      resampleTo(state, Math.min(want, cur + 24));
    } else if (want < cur) {
      resampleTo(state, Math.max(want, cur - 16));
    }
    // 让 2% 的家庭样本每月换一次住址：单次影响可以忽略，
    // 但样本住址必须跟着 tile.pop 的分布漂移，否则「人住哪儿」会和真实分布脱节。
    const move = Math.max(1, Math.round(state.households.length * 0.02));
    const rng = new RNG((state.seed + state.month * 104729) >>> 0);
    for (let i = 0; i < move && i < state.households.length; i++) {
      const idx = rng.int(0, state.households.length - 1);
      const h = state.households[idx];
      const from = state.city.tiles[h.tile];
      if (from && from.hhCount > 0) from.hhCount--;
      h.tile = pickTileByPop(state.city.tiles, () => rng.float());
      const t = state.city.tiles[h.tile];
      if (t) t.hhCount++;
    }
  }
}

// 每月追加一条扩展序列：三视角的实时变量 + 个体涌现量。
// 顶部变量条与详情弹窗的累积曲线都读这里，因此它必须和玩家看到的是同一份数据。
function updateSeries(state: SimState, bankruptcies: number): void {
  if (!state.series) state.series = emptySeries();
  const s = state.series;
  const push = (arr: number[] | undefined, v: number): void => {
    if (!arr) return;
    arr.push(Number.isFinite(v) ? v : 0);
    if (arr.length > SERIES_CAP) arr.shift();
  };
  const num = (v: number): number => (Number.isFinite(v) ? v : 0);

  const hhs = state.households;
  const emp = hhs.filter((h) => h.employed);
  const disposable = emp.length
    ? emp.reduce((a, h) => a + h.wage * (1 - state.gov.taxRate), 0) / emp.length
    : 0;
  const living = hhs.length ? hhs.reduce((a, h) => a + h.satisfaction, 0) / hhs.length : 0;
  const wealth = hhs.length ? hhs.reduce((a, h) => a + h.savings, 0) / hhs.length : 0;
  const cons = hhs.length ? hhs.reduce((a, h) => a + h.consumption, 0) / hhs.length : 0;
  const resilience = cons > 0 ? wealth / cons : wealth;

  const firms = state.firms;
  const avgProfit = firms.length ? firms.reduce((a, f) => a + f.profit, 0) / firms.length : 0;
  const cap = firms.reduce((a, f) => a + f.capacity, 0);
  const empCnt = firms.reduce((a, f) => a + f.employees.length, 0);
  const util = cap > 0 ? empCnt / cap : 0;
  const avgPrice = firms.length ? firms.reduce((a, f) => a + f.price, 0) / firms.length : 0;
  const revenue = firms.reduce((a, f) => a + f.revenue, 0);

  const em = emergeStats(state);

  push(s.disposableIncome, num(disposable));
  push(s.livingStandard, num(living));
  push(s.wealth, num(wealth));
  push(s.resilience, num(resilience));
  push(s.avgProfit, num(avgProfit));
  push(s.capacityUtil, num(util));
  push(s.avgPrice, num(avgPrice));
  push(s.revenue, num(revenue));
  push(s.bankruptcies, num(bankruptcies));
  push(s.poorShare, num(em.poorShare));
  push(s.maxLandValue, num(em.maxLandValue));
  push(s.vacancyRate, num(em.vacancyRate));
}

// 家庭样本是「人口的一趟抽样」：真实户数涨了就把抽样加密，
// 每个样本代表超过 HH_PER_SAMPLE_MAX 户时就再加一层，直到样本数封顶。
// 加密/抽稀都不改变这批样本的行为参数 —— 工资、满意度、分布一概不受影响。
function resampleTo(state: SimState, want: number): void {
  const cur = state.households.length;
  if (want === cur) return;
  const rng = new RNG((state.seed + state.month * 7919 + 31) >>> 0);
  const avgSat = cur > 0
    ? state.households.reduce((a, h) => a + h.satisfaction, 0) / cur
    : 60;

  if (want > cur) {
    const add: Household[] = [];
    for (let i = 0; i < want - cur; i++) {
      const h: Household = {
        id: state.nextId++,
        tile: pickTileByPop(state.city.tiles, () => rng.float()),
        skill: 20 + Math.floor(rng.float() * 70),
        savings: CONFIG.INIT_SAVINGS_MIN + rng.float() * (CONFIG.INIT_SAVINGS_MAX - CONFIG.INIT_SAVINGS_MIN),
        wage: 0,
        employed: false,
        employerId: null,
        // 加密只是「把原来代表的人再细分一次」，中性入场：给平均分，免得把抽样本身推歪
        satisfaction: clamp(avgSat, 0, 100),
        consumption: 0,
        seeking: rng.float() < state.householdParams.laborParticipation,
      };
      state.households.push(h);
      add.push(h);
      const t = state.city.tiles[h.tile];
      if (t) t.hhCount++;
    }
    // 抽样加密后必须立刻接岗：否则凭空多出一批失业人口，就业率会被假数据打歪
    assignJobs(state, add);
  } else {
    // 抽稀：随机丢弃（如果专挑最不满意的丢，会把满意度分布整体削歪）
    const drop = cur - want;
    const firmEmp = new Map<number, number[]>();
    for (const f of state.firms) firmEmp.set(f.id, f.employees);
    for (let i = 0; i < drop; i++) {
      const idx = rng.int(0, state.households.length - 1);
      const h = state.households.splice(idx, 1)[0];
      if (!h) break;
      const t = state.city.tiles[h.tile];
      if (t && t.hhCount > 0) t.hhCount--;
      if (h.employerId != null) {
        const em = firmEmp.get(h.employerId);
        if (em) {
          const k = em.indexOf(h.id);
          if (k >= 0) em.splice(k, 1);
        }
      }
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampPrice(p: number): number {
  const lo = CONFIG.PRICE_MIN * CONFIG.BASE_PRICE;
  const hi = CONFIG.PRICE_MAX * CONFIG.BASE_PRICE;
  return Math.max(lo, Math.min(hi, p));
}

// 劳动力参与率变化时，对尚未就业者重新决定求职意愿
function rerollSeeking(state: SimState): void {
  const p = state.householdParams.laborParticipation;
  // 与全项目一致：随机性由「种子 + 月份」派生，保证同一 seed 可复现
  const rng = new RNG((state.seed + state.month * 104729 + 91) >>> 0);
  for (const h of state.households) {
    if (!h.employed) h.seeking = rng.float() < p;
  }
}
