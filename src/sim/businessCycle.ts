// 经济周期：繁荣 → 衰退 → 萧条 → 复苏 → 繁荣。
//
// 之前所有指标都在向均衡点单调收敛——人口线性爬升、GDP 平滑上涨、CPI 稳在 100 附近，
// 玩家看几个月就明白"再挂机也是这条线"，既不像真实经济，也让"周期"这个词成了摆设。
// 现在引入一个真正的周期引擎，它由三股力量合成，并且**能被玩家的政策改写**：
//
//   ① 内生波动：存货（基钦）周期，由库存策略、扩产意愿、产业补贴共同决定振幅与波长；
//   ② 外生冲击：AR(1) 持续性随机扰动 + 偶发的"外部冲击/金融危机"跳跃；
//   ③ 政策调制：福利、公共支出、税率是自动稳定器（压振幅）；产业补贴、扩产、贸易开放是放大器。
//
// 周期不是叠加在结果上的装饰——它乘在总需求、投资与存货意愿上，
// 再由企业裁员、家庭缩减开支这些个体行为放大，最后才涌现成 GDP 与失业率的起落。

import { RNG } from './rng';
import type { BusinessCycleState, CyclePhase, SimState } from './types';

export const PHASE_META: Record<CyclePhase, { name: string; icon: string; desc: string; hint: string }> = {
  boom: {
    name: '繁荣',
    icon: '🔥',
    desc: '需求旺盛、订单排到几个月后，企业抢着招人和扩产，物价抬头。',
    hint: '产能与物价都在往上顶，此时加税或收紧补贴能给经济降温，但会牺牲增速。',
  },
  recession: {
    name: '衰退',
    icon: '📉',
    desc: '需求转弱，库存开始积压，企业先停止招人、再开始裁员。',
    hint: '裁员先于倒闭发生。此时加大公共支出与福利能托住需求，但会消耗财政。',
  },
  depression: {
    name: '萧条',
    icon: '🥶',
    desc: '谷底。失业高企、物价低迷、企业成批退出，信心跌到最低点。',
    hint: '资源大量闲置。此时扩张性财政的乘数最大，但赤字也会跑得最快。',
  },
  recovery: {
    name: '复苏',
    icon: '🌱',
    desc: '库存出清、订单回暖，企业重新招人，产出缺口由负转正。',
    hint: '最容易被人忽略、却最适合布局的阶段：产能便宜、劳动力充裕。',
  },
};

// 阶段最短持续月数：避免在临界值附近来回抖动，玩家看不清自己到底处在哪个阶段
const PHASE_MIN_MONTHS = 4;

// 周期指数进入"明显过热 / 明显过冷"的阈值
const HOT = 0.34;
const COLD = -0.34;

export function initCycleState(): BusinessCycleState {
  return {
    phase: 'recovery',
    phaseMonths: 0,
    phaseCount: { boom: 0, recession: 0, depression: 0, recovery: 0 },
    index: 0.1,
    prevIndex: 0,
    amplitude: 0.34,
    period: 46,
    t: 0,
    shock: 0,
    demandMult: 1,
    investMult: 1,
    confidence: 0,
    potentialOutput: 0,
    outputGap: 0,
    peakIndex: 0.1,
    troughIndex: 0,
    cycleCount: 0,
    trend: 0,
    trendPerHead: 0,
    history: [],
    gapHistory: [],
  };
}

// 旧存档兼容：缺字段就补默认值，不让读档后周期直接失效
export function ensureBusinessCycle(state: SimState): BusinessCycleState {
  const c = state.business as Partial<BusinessCycleState> | undefined;
  if (!c || typeof c !== 'object') {
    state.business = initCycleState();
    return state.business;
  }
  const d = initCycleState();
  c.phase = c.phase ?? d.phase;
  c.phaseMonths = typeof c.phaseMonths === 'number' ? c.phaseMonths : 0;
  c.phaseCount = Object.assign({}, d.phaseCount, c.phaseCount ?? {});
  c.index = typeof c.index === 'number' ? c.index : d.index;
  c.prevIndex = typeof c.prevIndex === 'number' ? c.prevIndex : c.index;
  c.amplitude = typeof c.amplitude === 'number' ? c.amplitude : d.amplitude;
  c.period = typeof c.period === 'number' ? c.period : d.period;
  c.t = typeof c.t === 'number' ? c.t : 0;
  c.shock = typeof c.shock === 'number' ? c.shock : 0;
  c.demandMult = typeof c.demandMult === 'number' ? c.demandMult : 1;
  c.investMult = typeof c.investMult === 'number' ? c.investMult : 1;
  c.confidence = typeof c.confidence === 'number' ? c.confidence : 0;
  c.potentialOutput = typeof c.potentialOutput === 'number' ? c.potentialOutput : 0;
  c.outputGap = typeof c.outputGap === 'number' ? c.outputGap : 0;
  c.peakIndex = typeof c.peakIndex === 'number' ? c.peakIndex : c.index;
  c.troughIndex = typeof c.troughIndex === 'number' ? c.troughIndex : c.index;
  c.cycleCount = typeof c.cycleCount === 'number' ? c.cycleCount : 0;
  c.trend = typeof c.trend === 'number' ? c.trend : 0;
  c.trendPerHead = typeof c.trendPerHead === 'number' ? c.trendPerHead : 0;
  c.history = Array.isArray(c.history) ? c.history : [];
  c.gapHistory = Array.isArray(c.gapHistory) ? c.gapHistory : [];
  return c as BusinessCycleState;
}

// ── 政策如何改写周期 ──
// 每个旋钮的作用方向都对应真实世界里的一条机制，玩家拧之前可以先读这行注释。
export interface CycleShape {
  amplitude: number; // 波动幅度 0.12-0.95
  period: number; // 波长（月）
  trendK: number; // 潜在产出的长期增速（月）
  stabilizer: number; // 自动稳定器强度 0-1（越高，萧条被削得越平）
  accelerator: number; // 投资加速数强度（越高，投资波动越大）
}

export function cycleShape(state: SimState): CycleShape {
  const g = state.gov;
  const f = state.firmParams;
  const h = state.householdParams;
  const ind = g.industrySubsidy ?? 0;
  const trade = g.tradeOpenness ?? 0;
  const welfare = g.welfare ?? 0;
  const pub = g.publicSpend ?? 0;
  const edu = g.eduSubsidy ?? 0;
  const tax = g.taxRate ?? 0;

  // 放大器：补贴造成产能过剩、扩产与备货放大存货周期、开放度引入外部冲击
  const amplifiers =
    ind * 0.34 + f.expansion * 0.24 + f.inventoryStrategy * 0.22 + trade * 0.3;
  // 稳定器：福利与公共支出托底需求、高税率自动为过热降温
  const stabilizers = welfare * 0.3 + pub * 0.18 + tax * 0.5;

  const amplitude = clamp(0.22 + amplifiers - stabilizers, 0.1, 0.95);
  // 波长：重补贴/重扩产的短周期（存货驱动），重研发的更长（技术周期）
  const period = clamp(44 + edu * 16 + f.rdInvest * 10 - f.inventoryStrategy * 10 - ind * 8, 28, 76);
  // 长期趋势：研发与人力资本抬升潜在产出，高税率与高补贴拖累配置效率
  const trendK = clamp(
    0.0022 + edu * 0.0032 + h.skillInvest * 0.0018 + f.rdInvest * 0.0026 - tax * 0.0035 - ind * 0.0012,
    0.0004,
    0.008,
  );
  return {
    amplitude,
    period,
    trendK,
    stabilizer: clamp(welfare * 0.7 + pub * 0.4 + tax * 0.6, 0, 1),
    accelerator: clamp(0.55 + f.expansion * 0.9 + ind * 0.5, 0.4, 2.2),
  };
}

// 每月推进一次：先算政策塑形，再合成指数，最后定阶段。
// 必须在算完本月 GDP 之前调用（引擎里放在 tick 开头），这样需求乘数当月就生效。
export function stepBusinessCycle(state: SimState): BusinessCycleState {
  const c = ensureBusinessCycle(state);
  const shape = cycleShape(state);
  const rng = new RNG((state.seed + state.month * 104729 + 17) >>> 0);

  // 1) 外生冲击：AR(1)，持续性够强才会形成"一波"而不是"噪声"
  const rho = 0.86;
  const sigma = 0.055 * (1 + (state.gov.tradeOpenness ?? 0) * 1.4 + shape.amplitude);
  const eps = (rng.float() + rng.float() + rng.float() - 1.5) * 1.4; // 近似正态
  c.shock = clamp(rho * c.shock + sigma * eps, -0.7, 0.7);

  // 偶发的大冲击：外部危机 / 突然的需求井喷。贸易越开放，被外部波及的概率越高。
  const jumpP = 0.012 + (state.gov.tradeOpenness ?? 0) * 0.02;
  if (rng.float() < jumpP) {
    const mag = rng.range(0.35, 0.8) * (rng.float() < 0.5 ? -1 : 1);
    c.shock = clamp(c.shock + mag, -0.85, 0.85);
    c.jump = { month: state.month, mag };
  }

  // 2) 内生波动：存货周期（基钦）
  c.t += 1;
  if (c.t > shape.period) c.t -= shape.period;
  const wave = Math.sin((2 * Math.PI * c.t) / shape.period);

  c.amplitude = shape.amplitude;
  c.period = shape.period;

  // 3) 合成周期指数，并用自动稳定器削掉谷底的深度（萧条不再是无底洞）
  c.prevIndex = c.index;
  let idx = wave * shape.amplitude + c.shock;
  if (idx < 0) idx *= 1 - shape.stabilizer * 0.45;
  c.index = clamp(idx, -1, 1);
  c.peakIndex = Math.max(c.peakIndex, c.index);
  c.troughIndex = Math.min(c.troughIndex, c.index);

  // 4) 需求 / 投资 / 信心：投资的波动远大于消费，这正是"加速原理"的现实投影
  c.demandMult = Math.max(0.35, 1 + c.index * 0.26);
  c.investMult = Math.max(0.05, 1 + c.index * 0.62 * shape.accelerator);
  c.confidence = c.index;

  // 5) 阶段判定：看水位也看方向，并带最短持续期，避免闪烁
  const slope = c.index - c.prevIndex;
  let next: CyclePhase = c.phase;
  if (c.index >= HOT) next = 'boom';
  else if (c.index <= COLD) next = 'depression';
  else if (slope >= 0.004) next = 'recovery';
  else if (slope <= -0.004) next = 'recession';

  if (next !== c.phase) {
    if (c.phaseMonths >= PHASE_MIN_MONTHS || next === 'boom' || next === 'depression') {
      // 从谷底回升 = 走完一个完整周期
      if (c.phase === 'depression' && next === 'recovery') c.cycleCount += 1;
      c.phase = next;
      c.phaseMonths = 0;
      c.phaseCount[next] += 1;
    }
  }
  c.phaseMonths += 1;

  c.history.push(c.index);
  c.gapHistory.push(c.outputGap);
  if (c.history.length > 600) c.history.shift();
  if (c.gapHistory.length > 600) c.gapHistory.shift();
  return c;
}

// 用本月实际产出更新潜在产出与产出缺口。
// 潜在产出是一个缓慢移动的"趋势线"（HP 滤波的思路），实际产出围着它上下摆动，
// 二者之差就是产出缺口——它同时是通胀压力与失业的先行信号。
export function updateOutputGap(state: SimState, actualOutput: number): void {
  const c = ensureBusinessCycle(state);
  const shape = cycleShape(state);
  if (!Number.isFinite(actualOutput) || actualOutput <= 0) return;
  if (c.trend <= 0) {
    c.trend = actualOutput;
    c.potentialOutput = actualOutput;
    c.outputGap = 0;
    return;
  }
  // 关键：缺口必须按「人均产出」算。
  // 用总量算的话，城市变大（人口增长）会让实际产出持续跑在趋势线上方，
  // 产出缺口被机械地拉成一整段正值——那反映的是"城变大了"，而不是"景气过热"。
  // 人均口径下，缺口才真的度量资源利用程度。
  const pop = Math.max(1, state.households.length);
  const perHead = actualOutput / pop;
  if (c.trendPerHead <= 0) {
    c.trendPerHead = perHead;
    c.outputGap = 0;
    c.potentialOutput = actualOutput;
    return;
  }
  // 趋势线：向实际人均产出缓慢靠拢，并叠加长期技术进步带来的增长
  const k = 0.05;
  c.trendPerHead = c.trendPerHead * (1 + shape.trendK) * (1 - k) + perHead * k;
  c.outputGap = clamp((perHead - c.trendPerHead) / Math.max(0.01, c.trendPerHead), -0.6, 0.6);
  // 对外仍按总量报告潜在产出（= 人均趋势 × 人口），这样它与 GDP 同一量纲、可直接对比
  c.potentialOutput = c.trendPerHead * pop;
  c.trend = c.potentialOutput;
}

export function cyclePhaseName(p: CyclePhase): string {
  return PHASE_META[p]?.name ?? p;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
