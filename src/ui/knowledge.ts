// 知识系统 UI：
//  · 经济学图谱——微观/中观/宏观各 30 个名词，随月份逐步解锁；
//  · 概念卡——少数重点概念的深度讲解（实例 / 实验 / 公式）；
//  · 名词释义弹窗——图谱节点、仪表盘指标、政策滑杆共用同一套渲染。

import { showModal } from './modal';
import { openTermQuiz } from './quiz';
import { termMark } from '../state/quiz';
import { LESSONS, lessonById, type Chapter } from '../data/lessons';
import {
  CHAPTER_LABEL,
  TERMS,
  termByKey,
  termProgress,
  termTier,
  tierProgress,
  termsByChapter,
  type TermDef,
} from '../data/glossary';
import type { SimState } from '../sim/types';
import { buildCtx, reqHint, reqMet, reqProgress } from '../sim/requirements';

const CHAPTERS: Chapter[] = ['micro', 'industrial', 'macro'];

export interface KnowledgeOpts {
  // 答完题后的回调（刷新顶栏积分、重绘图谱）
  onQuizDone?: (state: SimState) => void;
  // 名词解锁后要不要自动弹题：手动点开图谱时不弹，程序因解锁而弹出时才弹
  autoQuiz?: boolean;
}

export class KnowledgePanel {
  private state: SimState | null = null;

  constructor(private container: HTMLElement, private opts: KnowledgeOpts = {}) {
    this.buildSkeleton();
  }

  private buildSkeleton(): void {
    let html = `<h3>经济学图谱 <span class="k-count" id="k-count"></span></h3>`;
    html += `<div class="muted" id="k-tier" style="margin:-4px 0 8px;font-size:10.5px"></div>`;
    for (const ch of CHAPTERS) {
      html += `<div class="kchapter"><span>${CHAPTER_LABEL[ch]}</span><span class="k-chcount" data-chcount="${ch}"></span></div>`;
      html += `<div class="kterms" data-ch="${ch}"></div>`;
    }
    html += `<div class="kchapter"><span>深度概念卡</span><span class="k-chcount">${LESSONS.length}</span></div>`;
    html += `<div class="knowledge-tree" data-lessons="1"></div>`;
    this.container.innerHTML = html;
  }

  render(state: SimState): void {
    this.state = state;
    const ctx = buildCtx(state);

    const prog = termProgress(state);
    const tp = tierProgress(state);
    const countEl = this.container.querySelector('#k-count') as HTMLElement;
    // 本轮（本层）进度 + 总进度：让玩家清楚"这一轮我要啃下哪一层"
    if (countEl) {
      countEl.innerHTML = `第 ${tp.tier} 层 <b>${tp.unlocked}</b>/${tp.total} · 总计 ${prog.unlocked}/${prog.total}`;
    }
    const tierEl = this.container.querySelector('#k-tier') as HTMLElement;
    if (tierEl) {
      tierEl.innerHTML = `概念按<b>循环轮次</b>分层：第 N 轮只放出第 N 层，一次点亮一个、隔几个月才来下一个。`;
    }

    for (const ch of CHAPTERS) {
      const wrap = this.container.querySelector(`[data-ch="${ch}"]`) as HTMLElement;
      const cnt = this.container.querySelector(`[data-chcount="${ch}"]`) as HTMLElement;
      if (!wrap) continue;
      const list = termsByChapter(ch);
      const un = list.filter((t) => state.unlocked.includes(t.key)).length;
      if (cnt) cnt.textContent = `${un}/${list.length}`;
      wrap.innerHTML = list
        .map((t) => {
          const ok = state.unlocked.includes(t.key);
          const tier = termTier(t.key);
          // 答题状态直接打在胶囊上：✓ 已答对、✗ 答错过、· 还没答
          const mark = ok ? termMark(state.quiz, t.key) : 'none';
          const badge = mark === 'ok' ? '✓' : mark === 'wrong' ? '✗' : ok ? '·' : '🔒';
          // 未解锁的名词也给出「要做什么 / 第几轮才开放」，让图谱变成一张待办清单
          const tip = ok
            ? `${t.def}（答题状态：${mark === 'ok' ? '已答对' : mark === 'wrong' ? '答错过，可重做' : '还没答题'}）`
            : `第 ${tier} 层${tier > tp.tier ? `（第 ${tier} 轮才开放）` : ''}：${reqHint(t.req, ctx)}`;
          return `<button class="kchip ${ok ? 'unlocked' : 'locked'} q-${mark}" data-term="${t.key}" title="${tip}">${badge}${t.name}</button>`;
        })
        .join('');
    }

    // 深度概念卡
    const lWrap = this.container.querySelector('[data-lessons="1"]') as HTMLElement;
    if (lWrap) {
      lWrap.innerHTML = LESSONS.map((l) => {
        const unlocked = state.unlocked.includes(l.id);
        return `<div class="knode ${unlocked ? 'unlocked' : 'locked'}" data-id="${l.id}">${
          unlocked ? '✓ ' : '🔒 '
        }${l.title}</div>`;
      }).join('');
    }

    // 统一事件委托：图谱节点 / 概念卡
    this.container.querySelectorAll('.kchip').forEach((el) => {
      el.addEventListener('click', () => {
        const key = (el as HTMLElement).dataset.term!;
        const t = termByKey(key);
        if (!t) return;
        if (state.unlocked.includes(key)) {
          // 点已解锁的名词 = 复习 + 答题（简介在同一屏里，答完才知道自己真懂了没）
          openTermQuiz(state, key, {
            onDone: () => {
              this.render(state);
              this.opts.onQuizDone?.(state);
            },
          });
        } else this.showLockedTerm(t, state);
      });
    });
    this.container.querySelectorAll('.knode').forEach((el) => {
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.id!;
        if (state.unlocked.includes(id)) this.showConcept(id);
        else this.showLocked(id);
      });
    });
  }

  // —— 名词释义（图谱节点 / 指标 / 滑杆共用）——
  showTerm(key: string): void {
    const t = termByKey(key);
    if (!t) return;
    const related = t.related.length
      ? t.related
          .map((k) => {
            const r = termByKey(k);
            return r ? `<span class="tag">${r.name}</span>` : '';
          })
          .join('')
      : '—';
    const unlocks = this.unlockHtml(t);
    showModal(`
      <div class="chapter">${CHAPTER_LABEL[t.chapter]}</div>
      <h2>${t.name}</h2>
      <h4>定义</h4><p>${t.def}</p>
      <h4>影响</h4><p>${t.effect}</p>
      ${unlocks ? `<h4>解锁了哪些可调参数</h4><p>${unlocks}</p>` : ''}
      <h4>关联名词</h4><p>${related}</p>
      <button class="close" data-close>关闭</button>
    `);
  }

  private unlockHtml(t: TermDef): string {
    const parts: string[] = [];
    if (t.unlocks?.levers?.length) parts.push(`政策滑杆：${t.unlocks.levers.join('、')}`);
    if (t.unlocks?.metrics?.length) parts.push(`仪表盘指标：${t.unlocks.metrics.join('、')}`);
    return parts.join('；');
  }

  // 统一入口：已解锁看完整释义，未解锁只给定义 + 还差什么条件
  openTerm(key: string, state: SimState): void {
    const t = termByKey(key);
    if (!t) return;
    if (state.unlocked.includes(key)) this.showTerm(key);
    else this.showLockedTerm(t, state);
  }

  private showLockedTerm(t: TermDef, state: SimState): void {
    const ctx = buildCtx(state);
    const done = reqMet(t.req, ctx);
    const pct = Math.round(reqProgress(t.req, ctx) * 100);
    const unlocks = this.unlockHtml(t);
    const tier = termTier(t.key);
    const round = state.cycle?.round ?? 1;
    const gate = tier > round ? `<h4>还要等多久</h4><p>它属于第 <b>${tier}</b> 层，要等你走完第 ${round} 轮、进入第 ${tier} 轮循环才会开放。</p>` : '';
    showModal(`
      <div class="chapter">${CHAPTER_LABEL[t.chapter]} · 第 ${tier} 层概念</div>
      <h2>🔒 ${t.name}</h2>
      <h4>基本定义</h4><p>${t.def}</p>
      ${gate}
      <h4>解锁条件</h4><p>${reqHint(t.req, ctx)}${done ? '' : `　<span class="muted">（完成度 ${pct}%）</span>`}</p>
      <p class="muted">名词不会因为挂机太久自动出现——它来自<b>你亲手做过的决策</b>，以及这些决策把城市变成了什么样。</p>
      ${unlocks ? `<h4>解锁后会给你</h4><p>${unlocks}</p>` : ''}
      <button class="close" data-close>关闭</button>
    `);
  }

  // —— 深度概念卡 ——
  showConcept(id: string): void {
    const L = lessonById(id);
    if (!L) return;
    showModal(`
      <div class="chapter">${CHAPTER_LABEL[L.chapter]}</div>
      <h2>${L.title}</h2>
      <h4>定义</h4><p>${L.definition ?? '（待填写）'}</p>
      <h4>本局实例</h4><p>${L.example ?? '（待填写）'}</p>
      <h4>你可以做的对照实验</h4><p>${L.experiment ?? '（待填写）'}</p>
      ${L.advanced ? '<h4>进阶 · 公式与延伸</h4><p>' + L.advanced + '</p>' : ''}
      ${L.affectedBy ? '<h4>会受什么影响</h4><p>' + L.affectedBy + '</p>' : ''}
      ${L.affects ? '<h4>又会影响什么</h4><p>' + L.affects + '</p>' : ''}
      <button class="close" data-close>关闭</button>
    `);
  }

  showLocked(id: string): void {
    const L = lessonById(id);
    if (!L) return;
    showModal(`
      <div class="chapter">${CHAPTER_LABEL[L.chapter]}</div>
      <h2>🔒 ${L.title}</h2>
      <h4>基本定义</h4><p>${L.definition ?? '（待填写）'}</p>
      <h4>解锁条件</h4><p>${L.unlockHint ?? '继续游玩即可解锁。'}</p>
      <p class="muted">解锁后可查看本局实例、对照实验、进阶公式，以及它与其他指标的关联。</p>
      <button class="close" data-close>关闭</button>
    `);
  }
}
