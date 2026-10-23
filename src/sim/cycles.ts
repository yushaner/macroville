// 循环式玩法：个人 → 企业 → 政府 → 回到个人，一轮一轮往下走。
//
// 为什么要循环：同一批主体，站在不同位置看到的是同一决策的不同侧面。
// 第一轮你只摸到最表层的概念；等你把企业、政府的参数都拧过一遍，再回到个人视角，
// 才会发现"我当年调的那个储蓄率"是怎么被税率和工资出价反作用的。
// 概念按轮次分层解锁，每轮只放出对应深度的一批，避免一次弹出一堆名词让人看不过来。

import { isPerspectiveUnlocked } from './stages';
import type { CycleState, Perspective, SimState } from './types';

// 一个轮次内部的视角顺序
export const PHASE_ORDER: Perspective[] = ['household', 'firm', 'gov'];

// 切换视角所需的最短主导月数
// - 切到本轮还没走过的视角：短一些，让玩家尽快体验新身份
// - 本轮三个视角都走完、准备进入下一轮：长一些，给玩家消化这一轮的时间
const SWITCH_NEW_PHASE = 10;
const SWITCH_NEXT_ROUND = 14;

export const DEFAULT_ROUNDS = 4; // 计划总轮数（3-5 轮）
export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 5;

export interface CycleEvent {
  kind: 'phase' | 'round';
  phase: Perspective;
  round: number;
  finished: boolean; // 全部轮次走完
}

export function initCycle(roundsPlanned: number = DEFAULT_ROUNDS): CycleState {
  return {
    round: 1,
    phase: 'household',
    phaseMonths: 0,
    roundMonths: 0,
    visited: ['household'],
    unlockedThisRound: [],
    roundsPlanned: Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, roundsPlanned)),
    lastUnlockMonth: -99, // 开局允许立刻点亮第一批基础名词
  };
}

// 旧存档兼容：没有 cycle 字段就补一个，并按当前进度推断轮次
export function ensureCycle(state: SimState): CycleState {
  const c = state.cycle as Partial<CycleState> | undefined;
  if (!c || typeof c !== 'object') {
    state.cycle = initCycle();
    return state.cycle;
  }
  c.round = typeof c.round === 'number' && c.round >= 1 ? c.round : 1;
  c.phase = c.phase ?? 'household';
  c.phaseMonths = typeof c.phaseMonths === 'number' ? c.phaseMonths : 0;
  c.roundMonths = typeof c.roundMonths === 'number' ? c.roundMonths : c.phaseMonths;
  c.visited = Array.isArray(c.visited) ? c.visited : [c.phase];
  c.unlockedThisRound = Array.isArray(c.unlockedThisRound) ? c.unlockedThisRound : [];
  c.lastUnlockMonth = typeof c.lastUnlockMonth === 'number' ? c.lastUnlockMonth : -99;
  c.roundsPlanned =
    typeof c.roundsPlanned === 'number' ? Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, c.roundsPlanned)) : DEFAULT_ROUNDS;
  return state.cycle;
}

export interface CycleProgress {
  round: number;
  roundsPlanned: number;
  phase: Perspective;
  phaseMonths: number;
  visited: Perspective[];
  needMonths: number; // 还要几个月才切到下一站
  finished: boolean;
}

export function cycleProgress(state: SimState): CycleProgress {
  const c = ensureCycle(state);
  const avail = PHASE_ORDER.filter((p) => isPerspectiveUnlocked(state, p));
  const unvisited = avail.filter((p) => !c.visited.includes(p));
  const need = Math.max(0, (unvisited.length ? SWITCH_NEW_PHASE : SWITCH_NEXT_ROUND) - c.phaseMonths);
  return {
    round: c.round,
    roundsPlanned: c.roundsPlanned,
    phase: c.phase,
    phaseMonths: c.phaseMonths,
    visited: c.visited,
    needMonths: need,
    finished: c.round >= c.roundsPlanned && unvisited.length === 0,
  };
}

// 每月调用一次：决定要不要换视角 / 进入下一轮
// 兜底：慢节奏的蓝图（比如农耕村落）可能很久长不到中等城市，政府视角迟迟不解锁。
// 本轮已经走过两个视角、且累计够久，就允许进入下一轮，不让玩家永远停在第一轮。
const ROUND_FALLBACK_MONTHS = 60;

export function tickCycle(state: SimState): CycleEvent | null {
  const c = ensureCycle(state);
  c.phaseMonths += 1;
  c.roundMonths += 1;

  const avail = PHASE_ORDER.filter((p) => isPerspectiveUnlocked(state, p));
  if (avail.length === 0) return null;

  const allUnlocked = avail.length === PHASE_ORDER.length;
  const unvisited = avail.filter((p) => !c.visited.includes(p));
  const needMonths = unvisited.length ? SWITCH_NEW_PHASE : SWITCH_NEXT_ROUND;
  if (c.phaseMonths < needMonths) return null;

  if (unvisited.length > 0) {
    // 本轮还有没走过的视角 → 切过去
    const next = unvisited[0];
    c.phase = next;
    c.phaseMonths = 0;
    if (!c.visited.includes(next)) c.visited.push(next);
    return { kind: 'phase', phase: next, round: c.round, finished: false };
  }

  // 本轮已走遍当前可用的视角。
  // 三个视角全解锁才算真的走完；否则停在个人视角等城市长大——不能空转着把轮次刷过去
  // （早期版本会在第 14 个月就"进入第 2 轮"，轮次毫无意义）。
  const canAdvance =
    allUnlocked || (avail.length >= 2 && c.roundMonths >= ROUND_FALLBACK_MONTHS);
  if (!canAdvance) {
    c.phase = avail[0];
    c.phaseMonths = 0;
    c.visited = [avail[0]];
    return null; // 不算新一轮，静默等待
  }

  const finished = c.round >= c.roundsPlanned;
  if (finished) {
    // 计划轮次已走完：停在最后一轮，不再反复播报
    c.phaseMonths = 0;
    return null;
  }
  c.round += 1;
  c.visited = [avail[0]];
  c.unlockedThisRound = [];
  c.phase = avail[0];
  c.phaseMonths = 0;
  c.roundMonths = 0;
  return { kind: 'round', phase: c.phase, round: c.round, finished: false };
}

// 玩家手动切视角时同步状态（不重置计时，避免玩家来回点就把轮次刷过去）
export function markPhaseVisited(state: SimState, p: Perspective): void {
  const c = ensureCycle(state);
  c.phase = p;
  if (!c.visited.includes(p)) c.visited.push(p);
}

export const PHASE_LABEL: Record<Perspective, string> = {
  household: '个人视角',
  firm: '企业视角',
  gov: '政府视角',
};
