// 存档对话框：自定义命名保存 + 从列表里挑一个读档 + 重命名 / 删除。
//
// 之前的存档只有一个固定槽位，名字还默认取当前视角——玩家既没法给城市起名，
// 也没法在几座城市之间切换。这里把所有操作收进一个弹窗，保存/读档都从列表里走。

import { closeModal, modalRoot, showModal } from './modal';
import {
  activeSaveId,
  deleteSlot,
  listSaves,
  loadSlot,
  overwriteSlot,
  renameSlot,
  saveAsSlot,
  suggestName,
  type SaveMeta,
} from '../state/save';
import { ORIENTATIONS } from '../sim/stages';
import type { SimState } from '../sim/types';

export interface SaveDialogOpts {
  getState: () => SimState;
  onLoad: (state: SimState) => void;
  toast: (msg: string) => void;
}

const ORIENT_NAME: Record<string, string> = Object.fromEntries(
  ORIENTATIONS.map((o) => [o.id, o.name]),
);

function fmtTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function slotRow(m: SaveMeta, active: string | null): string {
  return `
    <div class="save-row ${m.id === active ? 'active' : ''}" data-id="${m.id}">
      <div class="sr-main">
        <div class="sr-name">${m.name}${m.id === active ? '<span class="sr-tag">当前</span>' : ''}</div>
        <div class="sr-meta">${m.stageName} · 第 ${m.month} 月 · 人口 ${m.population.toLocaleString('zh-CN')} 人 · 第 ${m.round} 轮 · 名词 ${m.unlocked}</div>
        <div class="sr-meta">${ORIENT_NAME[m.orientation] ?? '均衡型'} · ${fmtTime(m.updatedAt)}</div>
      </div>
      <div class="sr-ops">
        <button class="sr-btn" data-act="load">读取</button>
        <button class="sr-btn" data-act="save">覆盖</button>
        <button class="sr-btn" data-act="rename">改名</button>
        <button class="sr-btn danger" data-act="del">删除</button>
      </div>
    </div>`;
}

function body(mode: 'save' | 'load', state: SimState): string {
  const list = listSaves();
  const active = activeSaveId();
  const rows = list.length
    ? list.map((m) => slotRow(m, active)).join('')
    : `<p class="muted">还没有任何存档。在下面起个名字，把当前的城市存下来。</p>`;
  const title = mode === 'save' ? '保存城市' : '读取存档';
  return `
    <div class="chapter">存档管理</div>
    <h2>${title}</h2>
    <div class="save-new">
      <input id="save-name" type="text" placeholder="给这座城市起个名字" value="${suggestName(state)}" />
      <button class="close" id="save-new-btn" style="margin:0">存为新档</button>
    </div>
    <h4>已有存档（${list.length}）</h4>
    <div class="save-list">${rows}</div>
    <p class="muted">存档保存在本浏览器本地（localStorage），换浏览器或清缓存会丢失。</p>
    <button class="close" data-close>关闭</button>`;
}

function bind(opts: SaveDialogOpts, mode: 'save' | 'load'): void {
  const root = modalRoot();
  if (!root) return;
  const nameInput = root.querySelector<HTMLInputElement>('#save-name');

  root.querySelector('#save-new-btn')?.addEventListener('click', () => {
    const name = (nameInput?.value || '').trim() || suggestName(opts.getState());
    const id = saveAsSlot(opts.getState(), name);
    if (id) {
      opts.toast(`已保存为「${name}」`);
      openSaveDialog(opts, 'save'); // 刷新列表
    } else {
      opts.toast('保存失败：本地存储空间不足');
    }
  });

  root.querySelectorAll<HTMLElement>('.save-row').forEach((row) => {
    const id = row.dataset.id!;
    row.querySelectorAll<HTMLElement>('.sr-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'load') {
          const s = loadSlot(id);
          if (s) {
            opts.onLoad(s);
            closeModal();
            opts.toast('已读档');
          } else {
            opts.toast('读档失败：存档已损坏');
          }
        } else if (act === 'save') {
          const list = listSaves();
          const meta = list.find((m) => m.id === id);
          overwriteSlot(id, opts.getState(), meta?.name);
          opts.toast(`已覆盖「${meta?.name ?? '存档'}」`);
          openSaveDialog(opts, 'save');
        } else if (act === 'rename') {
          const cur = listSaves().find((m) => m.id === id);
          const next = window.prompt('新的存档名称', cur?.name ?? '');
          if (next && next.trim()) {
            renameSlot(id, next.trim());
            openSaveDialog(opts, 'save');
          }
        } else if (act === 'del') {
          const cur = listSaves().find((m) => m.id === id);
          if (window.confirm(`确定删除存档「${cur?.name ?? ''}」？此操作不可恢复。`)) {
            deleteSlot(id);
            opts.toast('已删除');
            openSaveDialog(opts, mode);
          }
        }
      });
    });
  });
}

export function openSaveDialog(opts: SaveDialogOpts, mode: 'save' | 'load' = 'save'): void {
  showModal(body(mode, opts.getState()));
  bind(opts, mode);
  // 保存模式自动聚焦输入框，方便直接改名
  const nameInput = modalRoot()?.querySelector<HTMLInputElement>('#save-name');
  nameInput?.focus();
  nameInput?.select();
}
