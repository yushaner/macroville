// 闯关问答 UI：解锁名词即弹「简介 + 一道题」，以及顶栏的学习档案。
//
// 参考中级经济师《经济基础知识》的题型：单选 / 多选 / 判断。
// 答完立刻给解析——玩家要的是"知道自己为什么错"，而不是一个对错符号。

import { closeModal, modalRoot, showModal } from './modal';
import { CHAPTER_LABEL, termByKey, TERMS } from '../data/glossary';
import { quizByKey, quizScoreOf, type QuizDef } from '../data/quiz';
import { gradeAnswer, quizSummary, TROPHIES, termMark } from '../state/quiz';
import type { SimState } from '../sim/types';

const TYPE_LABEL: Record<QuizDef['type'], string> = {
  single: '单选题',
  multi: '多选题',
  judge: '判断题',
};

export interface QuizOpts {
  onDone?: (ok: boolean) => void; // 答完回调（用于刷新图谱与顶栏）
  onTerm?: (key: string) => void;
}

// ── 解锁名词后弹出：简介 + 闯关题 ──
export function openTermQuiz(state: SimState, key: string, opts: QuizOpts = {}): void {
  const t = termByKey(key);
  const q = quizByKey(key);
  if (!t) return;
  if (!q) {
    // 没有配套题目（比如新增名词还没出题）时，退化成纯简介，不影响流程
    showModal(`
      <div class="chapter">${CHAPTER_LABEL[t.chapter]}</div>
      <h2>${t.name}</h2>
      <h4>基本定义</h4><p>${t.def}</p>
      <h4>在城里怎么体现</h4><p>${t.effect}</p>
      <button class="close" data-close>知道了</button>`);
    opts.onDone?.(true);
    return;
  }
  renderQuestion(state, q, opts);
}

function renderQuestion(state: SimState, q: QuizDef, opts: QuizOpts): void {
  const t = termByKey(q.key);
  const multi = q.type === 'multi';
  const chosen = new Set<number>();
  const score = quizScoreOf(q);
  const already = state.quiz?.answered[q.key];

  showModal(`
    <div class="chapter">${CHAPTER_LABEL[t?.chapter ?? 'micro']} · ${TYPE_LABEL[q.type]} · ${score} 分</div>
    <h2>📖 ${t?.name ?? q.key}</h2>
    <h4>基本定义</h4><p>${t?.def ?? ''}</p>
    <h4>在城里怎么体现</h4><p>${t?.effect ?? ''}</p>
    <div class="quiz-box">
      <div class="quiz-stem">${q.stem}</div>
      <div class="quiz-opts" id="quiz-opts">
        ${q.options
          .map(
            (o, i) =>
              `<button class="quiz-opt" data-i="${i}"><span class="qo-key">${'ABCDE'[i]}</span>${o}</button>`,
          )
          .join('')}
      </div>
      <div class="quiz-tip">${multi ? '多选题：少选、多选、错选均不得分' : '请选择唯一正确答案'}${
        already ? `　·　此前你已作答 ${already.tries} 次` : '　·　首次答对额外 +5 分'
      }</div>
      <div class="quiz-actions">
        <button class="quiz-submit" id="quiz-submit" disabled>提交</button>
        <button class="quiz-skip" id="quiz-skip">先跳过</button>
      </div>
      <div class="quiz-feedback hidden" id="quiz-fb"></div>
    </div>
  `);

  const root = modalRoot();
  if (!root) return;
  const optBtns = Array.from(root.querySelectorAll<HTMLButtonElement>('.quiz-opt'));
  const submit = root.querySelector<HTMLButtonElement>('#quiz-submit');
  const skip = root.querySelector<HTMLButtonElement>('#quiz-skip');
  const fb = root.querySelector<HTMLElement>('#quiz-fb');

  const sync = () => {
    optBtns.forEach((b) => b.classList.toggle('on', chosen.has(Number(b.dataset.i))));
    if (submit) submit.disabled = chosen.size === 0;
  };
  optBtns.forEach((b) => {
    b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      if (chosen.has(i)) chosen.delete(i);
      else {
        if (!multi) chosen.clear();
        chosen.add(i);
      }
      sync();
    });
  });
  skip?.addEventListener('click', () => {
    closeModal();
    opts.onDone?.(false);
  });
  submit?.addEventListener('click', () => {
    const pick = Array.from(chosen);
    const res = gradeAnswer(state.quiz, q.key, pick);
    if (!res) return;
    // 标出正确/错误
    optBtns.forEach((b) => {
      const i = Number(b.dataset.i);
      b.classList.remove('on');
      b.classList.add(q.answer.includes(i) ? 'right' : 'picked');
      b.disabled = true;
    });
    if (submit) submit.disabled = true;
    if (submit) submit.textContent = res.ok ? `✓ 答对 +${res.gained}` : '✗ 答错';
    const trophyHtml = res.newTrophies.length
      ? `<div class="quiz-trophy">${res.newTrophies
          .map((t2) => `${t2.icon} 获得奖杯「${t2.name}」`)
          .join('　')}</div>`
      : '';
    if (fb) {
      fb.classList.remove('hidden');
      fb.innerHTML = `
        <div class="qf-head ${res.ok ? 'ok' : 'no'}">${res.ok ? `回答正确（+${res.gained} 分）` : '回答错误'}</div>
        <div class="qf-ans">正确答案：${q.answer.map((i) => `${'ABCDE'[i]}. ${q.options[i]}`).join('　')}</div>
        <h4>解析</h4><p>${q.explain}</p>
        <p class="muted">${q.source}</p>
        ${trophyHtml}
        <button class="close" id="quiz-next">${res.ok ? '继续游戏' : '再看看'}</button>`;
      const next = fb.querySelector<HTMLElement>('#quiz-next');
      next?.addEventListener('click', () => {
        closeModal();
        opts.onDone?.(res.ok);
      });
    }
  });
}

// ── 顶栏学习档案按钮 ──
export class QuizStatus {
  constructor(private el: HTMLElement, private opts: QuizOpts = {}) {
    this.el.className = 'quiz-status';
    this.el.addEventListener('click', () => this.open());
  }

  private state: SimState | null = null;

  update(state: SimState): void {
    this.state = state;
    this.render();
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const q = s.quiz;
    const sum = quizSummary(q);
    this.el.innerHTML = `
      <span class="qs-icon">🎓</span>
      <span class="qs-main">${sum.points} 分</span>
      <span class="qs-sub">${sum.correct}/${sum.total} 题</span>
      <span class="qs-sub">🏆 ${sum.trophies.length}</span>`;
  }

  private open(): void {
    const s = this.state;
    if (!s) return;
    openArchive(s, this.opts);
  }
}

// ── 学习档案：积分、奖杯、章节进度、错题重做 ──
export function openArchive(state: SimState, opts: QuizOpts = {}): void {
  const sum = quizSummary(state.quiz);
  const chapRows = (['micro', 'industrial', 'macro'] as const)
    .map((ch) => {
      const list = TERMS.filter((t) => t.chapter === ch);
      const ok = list.filter((t) => state.quiz.answered[t.key]?.ok).length;
      const locked = list.filter((t) => !state.unlocked.includes(t.key)).length;
      return `<div class="det-row"><span>${CHAPTER_LABEL[ch]}</span><b>${ok}/${list.length} 题　·　未解锁 ${locked}</b></div>`;
    })
    .join('');
  const trophyHtml = TROPHIES.map((t) => {
    const got = state.quiz.trophies.includes(t.id);
    return `<div class="tro ${got ? 'got' : ''}" title="${t.desc}">
      <span class="tro-icon">${got ? t.icon : '🔒'}</span>
      <span class="tro-name">${t.name}</span>
      <span class="tro-desc">${t.desc}</span>
    </div>`;
  }).join('');
  // 已解锁但还没答（或答错）的名词，列出来供重做
  const pending = TERMS.filter((t) => state.unlocked.includes(t.key)).filter(
    (t) => termMark(state.quiz, t.key) !== 'ok',
  );
  const pendingHtml = pending.length
    ? pending
        .slice(0, 40)
        .map(
          (t) =>
            `<button class="kchip ${termMark(state.quiz, t.key) === 'wrong' ? 'wrong' : ''}" data-req="${t.key}">${
              termMark(state.quiz, t.key) === 'wrong' ? '✗' : ''
            }${t.name}</button>`,
        )
        .join('')
    : '<p class="muted">已解锁的名词你都答对了。继续玩，解锁更多名词就会来新题。</p>';

  showModal(`
    <div class="chapter">学习档案</div>
    <h2>🎓 ${sum.points} 分　·　${sum.correct}/${sum.total} 题　·　🏆 ${sum.trophies.length}/${TROPHIES.length}</h2>
    <p class="muted">全部 ${sum.total} 个名词都答对一遍，就相当于把中级经济师《经济基础知识》的主干知识点走了一遍。</p>
    <div class="det-stats">
      <div class="det-row"><span>累计答对</span><b>${sum.correct} 题</b></div>
      <div class="det-row"><span>累计答错</span><b>${state.quiz.wrong} 次</b></div>
      <div class="det-row"><span>最高连对</span><b>${state.quiz.bestStreak} 题</b></div>
      <div class="det-row"><span>当前连对</span><b>${state.quiz.streak} 题</b></div>
      ${chapRows}
    </div>
    <h4>奖杯</h4>
    <div class="tro-grid">${trophyHtml}</div>
    <h4>待答 / 答错的名词（点开重做）</h4>
    <div class="kterms">${pendingHtml}</div>
    ${sum.next ? `<p class="muted">下一个目标：${sum.next.icon} 「${sum.next.name}」——${sum.next.desc}</p>` : '<p class="muted">全部奖杯已到手，你已经是这座城邦的首席经济师了。</p>'}
    <button class="close" data-close>关闭</button>
  `);

  const root = modalRoot();
  root?.querySelectorAll<HTMLElement>('[data-req]').forEach((b) => {
    b.addEventListener('click', () => {
      const key = b.dataset.req!;
      openTermQuiz(state, key, {
        ...opts,
        onDone: () => {
          closeModal();
          opts.onDone?.(true);
        },
      });
    });
  });
}
