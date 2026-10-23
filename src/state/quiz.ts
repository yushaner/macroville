// 闯关问答的进度与奖励：积分、连对、奖杯。
//
// 与「解锁名词」分开记账：解锁是玩家在城市里做出来的，答题是玩家真正学会了的。
// 两项分开，玩家能自己看出"我见过了多少、又掌握了多少"。

import { TERMS, termByKey } from '../data/glossary';
import { quizByKey, quizScoreOf, type QuizDef } from '../data/quiz';
import type { QuizState } from '../sim/types';

export function emptyQuiz(): QuizState {
  return {
    points: 0,
    correct: 0,
    wrong: 0,
    streak: 0,
    bestStreak: 0,
    answered: {},
    trophies: [],
  };
}

// 旧存档兼容：缺字段补默认值，trophies/answered 损坏时重建
export function normalizeQuiz(q: QuizState | undefined): QuizState {
  const d = emptyQuiz();
  if (!q || typeof q !== 'object') return d;
  q.points = typeof q.points === 'number' ? q.points : 0;
  q.correct = typeof q.correct === 'number' ? q.correct : 0;
  q.wrong = typeof q.wrong === 'number' ? q.wrong : 0;
  q.streak = typeof q.streak === 'number' ? q.streak : 0;
  q.bestStreak = typeof q.bestStreak === 'number' ? q.bestStreak : 0;
  q.answered = q.answered && typeof q.answered === 'object' ? q.answered : {};
  q.trophies = Array.isArray(q.trophies) ? q.trophies : [];
  // 答对数与积分可能与 answered 不一致（手动改档），以 answered 为准重算一次
  let c = 0;
  for (const k of Object.keys(q.answered)) if (q.answered[k]?.ok) c++;
  q.correct = c;
  return q;
}

export interface TrophyDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  check: (q: QuizState) => boolean;
}

export const TROPHIES: TrophyDef[] = [
  { id: 'first', name: '开卷有益', icon: '📗', desc: '答对第一道题', check: (q) => q.correct >= 1 },
  { id: 'streak5', name: '渐入佳境', icon: '🔥', desc: '连续答对 5 道题', check: (q) => q.bestStreak >= 5 },
  { id: 'streak10', name: '势如破竹', icon: '⚡', desc: '连续答对 10 道题', check: (q) => q.bestStreak >= 10 },
  { id: 'points100', name: '小有所成', icon: '🥉', desc: '累计积分达到 100', check: (q) => q.points >= 100 },
  { id: 'points300', name: '学富五车', icon: '🥈', desc: '累计积分达到 300', check: (q) => q.points >= 300 },
  { id: 'points600', name: '满腹经纶', icon: '🥇', desc: '累计积分达到 600', check: (q) => q.points >= 600 },
  { id: 'micro', name: '微观通', icon: '🔍', desc: '微观经济学全部答对', check: (q) => chapterDone(q, 'micro') },
  { id: 'industrial', name: '产业通', icon: '🏭', desc: '产业经济学全部答对', check: (q) => chapterDone(q, 'industrial') },
  { id: 'macro', name: '宏观通', icon: '🌐', desc: '宏观经济学全部答对', check: (q) => chapterDone(q, 'macro') },
  { id: 'half', name: '半部经济学', icon: '📚', desc: '答对全部名词的一半', check: (q) => q.correct >= Math.ceil(TERMS.length / 2) },
  { id: 'economist', name: '经济师在望', icon: '🎓', desc: '全部名词都答对过', check: (q) => q.correct >= TERMS.length },
  { id: 'perfect', name: '满分经济师', icon: '🏆', desc: '全部名词都一次答对', check: (q) => perfectAll(q) },
];

function chapterDone(q: QuizState, ch: 'micro' | 'industrial' | 'macro'): boolean {
  const list = TERMS.filter((t) => t.chapter === ch);
  return list.length > 0 && list.every((t) => q.answered[t.key]?.ok);
}

function perfectAll(q: QuizState): boolean {
  return TERMS.every((t) => q.answered[t.key]?.ok && q.answered[t.key]?.firstTry);
}

// 结算一次作答：更新积分、连对、奖杯，返回本次获得的积分与新奖杯
export interface GradeResult {
  gained: number;
  ok: boolean;
  firstTry: boolean;
  newTrophies: TrophyDef[];
}

export function gradeAnswer(q: QuizState, key: string, chosen: number[]): GradeResult | null {
  const def = quizByKey(key);
  if (!def) return null;
  const before = q.answered[key];
  const ok = sameSet(chosen, def.answer);
  const firstTry = !before; // 第一次作答
  let gained = 0;
  if (ok) {
    // 已经答对过的题再答只给一半，避免靠重复刷分
    const base = quizScoreOf(def);
    const bonus = before ? 0 : 5;
    gained = before?.ok ? Math.round(base * 0.3) : base + bonus;
    q.points += gained;
    q.streak += 1;
    q.bestStreak = Math.max(q.bestStreak, q.streak);
  } else {
    q.wrong += 1;
    q.streak = 0;
  }
  const prev = q.answered[key];
  q.answered[key] = {
    ok: ok || !!prev?.ok,
    tries: (prev?.tries ?? 0) + 1,
    firstTry: !!prev?.firstTry || (firstTry && ok),
  };
  // 答对数按 answered 重算，保证与图谱显示一致
  let c = 0;
  for (const k of Object.keys(q.answered)) if (q.answered[k]?.ok) c++;
  q.correct = c;

  const newTrophies: TrophyDef[] = [];
  for (const t of TROPHIES) {
    if (!q.trophies.includes(t.id) && t.check(q)) {
      q.trophies.push(t.id);
      newTrophies.push(t);
    }
  }
  return { gained, ok, firstTry, newTrophies };
}

function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

// ── 跨局留存：学习成果属于玩家，不属于某一局存档 ──
// 开新城市不该把已经学会的东西清零，所以积分、奖杯与答题记录单独落在 localStorage，
// 每次开新局/读档都合并进当前 state。
const PROFILE_KEY = 'macroville.quiz.profile.v1';

export function loadQuizProfile(): QuizState {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return emptyQuiz();
    return normalizeQuiz(JSON.parse(raw) as QuizState);
  } catch {
    return emptyQuiz();
  }
}

export function saveQuizProfile(q: QuizState): void {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(q));
  } catch {
    /* 忽略：本地存储不可用时，进度只存在于本局 */
  }
}

// 合并两份进度：取各自答对过的并集，积分取较大值，奖杯取并集
export function mergeQuiz(a: QuizState, b: QuizState): QuizState {
  const out = emptyQuiz();
  out.answered = { ...a.answered, ...b.answered };
  for (const k of Object.keys(out.answered)) {
    const x = a.answered[k];
    const y = b.answered[k];
    if (x && y) {
      out.answered[k] = {
        ok: x.ok || y.ok,
        tries: x.tries + y.tries,
        firstTry: x.firstTry || y.firstTry,
      };
    }
  }
  out.points = Math.max(a.points, b.points);
  out.wrong = Math.max(a.wrong, b.wrong);
  out.bestStreak = Math.max(a.bestStreak, b.bestStreak);
  out.streak = Math.max(a.streak, b.streak);
  out.trophies = Array.from(new Set([...a.trophies, ...b.trophies]));
  let c = 0;
  for (const k of Object.keys(out.answered)) if (out.answered[k]?.ok) c++;
  out.correct = c;
  return out;
}

export interface QuizSummary {
  total: number;
  answered: number;
  correct: number;
  points: number;
  bestStreak: number;
  trophies: TrophyDef[];
  next: TrophyDef | null; // 下一个还没拿到的奖杯
}

export function quizSummary(q: QuizState): QuizSummary {
  const got = TROPHIES.filter((t) => q.trophies.includes(t.id));
  const next = TROPHIES.find((t) => !q.trophies.includes(t.id)) ?? null;
  return {
    total: TERMS.length,
    answered: Object.keys(q.answered).length,
    correct: q.correct,
    points: q.points,
    bestStreak: q.bestStreak,
    trophies: got,
    next,
  };
}

// 名词的学习状态：用于图谱上给每个胶囊打标记
export type TermQuizMark = 'none' | 'wrong' | 'ok';

export function termMark(q: QuizState, key: string): TermQuizMark {
  const a = q.answered[key];
  if (!a) return 'none';
  return a.ok ? 'ok' : 'wrong';
}

export function quizOf(key: string): QuizDef | undefined {
  const t = termByKey(key);
  return t ? quizByKey(key) : undefined;
}
