// 开局设定：选一份「城市蓝图」，再定这一局走几轮循环。
//
// 玩法的核心不是挂机，而是：你先设定一套初始条件 → 家庭/企业/地块之间自己博弈 →
// 跑出别人跑不出的结果。所以开局这一步必须让玩家真的做一次选择。

import { closeModal, modalRoot, showModal } from './modal';
import { BLUEPRINTS, DEFAULT_BLUEPRINT } from '../data/blueprints';
import { MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS } from '../sim/cycles';
import type { BlueprintId } from '../sim/types';

export interface SetupResult {
  blueprint: BlueprintId;
  rounds: number;
}

export const DEFAULT_SETUP: SetupResult = {
  blueprint: DEFAULT_BLUEPRINT,
  rounds: DEFAULT_ROUNDS,
};

function cardHtml(sel: BlueprintId): string {
  return BLUEPRINTS.map(
    (b) => `
      <button class="bp-card ${b.id === sel ? 'sel' : ''}" data-bp="${b.id}">
        <div class="bp-head"><span class="bp-icon">${b.icon}</span><b>${b.name}</b><span class="bp-tag">${b.tagline}</span></div>
        <div class="bp-desc">${b.desc}</div>
        <div class="bp-hint">通常会跑出：${b.hint}</div>
      </button>`,
  ).join('');
}

function body(sel: SetupResult): string {
  return `
    <div class="chapter">开局设定</div>
    <h2>你要建一座什么样的城市？</h2>
    <p>蓝图决定了<b>初始人口、地块构成与一整套初始参数</b>。选完之后，城市会自己长——
      家庭和企业各自盘算，跑出什么结果取决于你开的这个头，以及你后面拧的每一根旋钮。</p>
    <div class="bp-grid">${cardHtml(sel.blueprint)}</div>
    <h4>这一局走几轮循环？</h4>
    <p class="muted">一轮 = 个人 → 企业 → 政府 各走一段，走完回到个人视角再来一遍。
      每一轮只会放出对应深度的一批概念，所以轮数越多，你能学到的层次越深。</p>
    <div class="round-pick">
      ${[MIN_ROUNDS, 4, MAX_ROUNDS]
        .map(
          (n) =>
            `<button class="rp-btn ${n === sel.rounds ? 'sel' : ''}" data-r="${n}">${n} 轮${n === DEFAULT_ROUNDS ? '（推荐）' : ''}</button>`,
        )
        .join('')}
    </div>
    <div class="setup-actions">
      <button class="close" id="setup-go">开始这一局</button>
    </div>`;
}

export function openSetup(
  current: SetupResult,
  onDone: (r: SetupResult) => void,
  opts: { canCancel?: boolean } = {},
): void {
  let sel: SetupResult = { ...current };
  showModal(body(sel));
  const root = modalRoot();
  if (!root) return;

  root.querySelectorAll<HTMLElement>('.bp-card').forEach((c) => {
    c.addEventListener('click', () => {
      sel.blueprint = c.dataset.bp as BlueprintId;
      root.querySelectorAll('.bp-card').forEach((x) => x.classList.toggle('sel', x === c));
    });
  });
  root.querySelectorAll<HTMLElement>('.rp-btn').forEach((b) => {
    b.addEventListener('click', () => {
      sel.rounds = Number(b.dataset.r);
      root.querySelectorAll('.rp-btn').forEach((x) => x.classList.toggle('sel', x === b));
    });
  });
  root.querySelector('#setup-go')?.addEventListener('click', () => {
    closeModal();
    onDone(sel);
  });
}
