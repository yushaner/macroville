// 每月的解锁判定：把「玩家做过的决策」和「城市变成的样子」翻译成图谱里新亮起的名词。
//
// 顺序很重要：
//   ① 先刷新历史极值与旋钮痕迹（updateTracking）
//   ② 再统计「连续满足」的月数（streak）——它依赖 ① 的结果
//   ③ 最后逐条求值名词条件，把新解锁的写进 state.unlocked
//
// 节奏控制（玩家反馈：一次解锁一批名词会看不过来，也理解不了关联）：
//   · 每次最多点亮 1 个名词，且两次解锁之间至少隔 UNLOCK_GAP 个月；
//   · 名词按「循环轮次」分层，第 N 轮只放出第 N 层，由浅入深；
//   · 候选多个时取「条件最浅」的那个，保证先学基础再学进阶。

import { TERMS, termTier } from '../data/glossary';
import { buildCtx, collectStreaks, reqMet, reqText, updateTracking } from './requirements';
import { ensureCycle } from './cycles';
import type { SimState } from './types';

let streakCache: { id: string; cond: Req }[] | null = null;
type Req = Parameters<typeof reqMet>[0];

// 解锁冷却：点亮一个名词后至少隔几个月才点亮下一个
const UNLOCK_GAP = 2;

function streaks(): { id: string; cond: Req }[] {
  if (!streakCache) streakCache = collectStreaks(TERMS);
  return streakCache;
}

export interface UnlockEvent {
  key: string;
  name: string;
  reason: string;
  tier: number;
}

// 本轮允许解锁的名词层：第 N 轮放出第 N 层。
// 计划轮次全部走完后不再设限——剩下的深层概念留作通关后的自由探索，
// 但仍然受「一次一个 + 冷却」约束，不会哗啦全亮。
function tierAllowed(state: SimState, key: string): boolean {
  const cyc = ensureCycle(state);
  if (cyc.round >= cyc.roundsPlanned) return true;
  return termTier(key) <= cyc.round;
}

// 按「条件最浅优先」挑出最多 limit 个可解锁的名词
function pickFresh(state: SimState, ctx: ReturnType<typeof buildCtx>, limit: number): UnlockEvent[] {
  const cands: { t: (typeof TERMS)[number]; tier: number }[] = [];
  for (const t of TERMS) {
    if (state.unlocked.includes(t.key)) continue;
    if (!tierAllowed(state, t.key)) continue;
    if (!reqMet(t.req, ctx)) continue;
    cands.push({ t, tier: termTier(t.key) });
  }
  if (cands.length === 0) return [];
  // 先按层级、再按图谱顺序（TERMS 本身就是微观→产业→宏观排列的）
  cands.sort((a, b) => a.tier - b.tier || TERMS.indexOf(a.t) - TERMS.indexOf(b.t));
  const fresh: UnlockEvent[] = [];
  for (const c of cands.slice(0, limit)) {
    state.unlocked.push(c.t.key);
    const cyc = ensureCycle(state);
    if (!cyc.unlockedThisRound.includes(c.t.key)) cyc.unlockedThisRound.push(c.t.key);
    fresh.push({ key: c.t.key, name: c.t.name, reason: reqText(c.t.req), tier: c.tier });
  }
  return fresh;
}

// 只做「当前状态是否满足」的结算，不推进任何时间相关的统计。
// 玩家刚拧完旋钮时用它：立刻点亮，但同样受「一次一个 + 冷却」约束，
// 免得一次拧到位就哗啦亮起一片。
export function evaluateUnlocks(state: SimState): UnlockEvent[] {
  const cyc = ensureCycle(state);
  if (state.month - (cyc.lastUnlockMonth ?? -99) < UNLOCK_GAP) return [];
  updateTracking(state);
  const ctx = buildCtx(state);
  const fresh = pickFresh(state, ctx, 1);
  if (fresh.length > 0) cyc.lastUnlockMonth = state.month;
  return fresh;
}

// 每月调用一次，返回本月新解锁的名词（含解锁原因，供 toast / 弹窗展示）
export function tickUnlocks(state: SimState): UnlockEvent[] {
  const cyc = ensureCycle(state);
  updateTracking(state);
  const ctxAfterPeak = buildCtx(state);

  // 连续月数统计：满足则 +1，中断则清零
  for (const s of streaks()) {
    const ok = reqMet(s.cond, ctxAfterPeak);
    state.tracking.streak[s.id] = ok ? (state.tracking.streak[s.id] ?? 0) + 1 : 0;
  }

  if (state.month - (cyc.lastUnlockMonth ?? -99) < UNLOCK_GAP) return [];
  const fresh = pickFresh(state, ctxAfterPeak, 1);
  if (fresh.length > 0) cyc.lastUnlockMonth = state.month;
  return fresh;
}

// 初始化时点亮开局即可见的基础名词。
// 只放最浅的一批（SEED_LIMIT 个），其余全部留到游戏里逐个解锁。
const SEED_LIMIT = 8;

export function seedUnlocks(state: SimState): string[] {
  const ctx = buildCtx(state);
  const seeded: string[] = [];
  for (const t of TERMS) {
    if (seeded.length >= SEED_LIMIT) break;
    if (state.unlocked.includes(t.key)) continue;
    if (termTier(t.key) !== 1) continue;
    if (reqMet(t.req, ctx)) {
      state.unlocked.push(t.key);
      seeded.push(t.key);
    }
  }
  const cyc = ensureCycle(state);
  cyc.unlockedThisRound = [...seeded];
  cyc.lastUnlockMonth = 0;
  return seeded;
}

// 兼容旧存档：没有 tracking 字段的存档补一个空的
export function ensureTracking(state: SimState): void {
  const tr = state.tracking as Partial<SimState['tracking']> | undefined;
  if (!tr || typeof tr !== 'object') {
    state.tracking = { leverMax: {}, leverMin: {}, peak: {}, trough: {}, streak: {} };
    return;
  }
  tr.leverMax = tr.leverMax ?? {};
  tr.leverMin = tr.leverMin ?? {};
  tr.peak = tr.peak ?? {};
  tr.trough = tr.trough ?? {};
  tr.streak = tr.streak ?? {};
}
