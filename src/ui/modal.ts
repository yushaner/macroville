// 通用弹窗：概念卡、规则说明、术语释义 共用一个 modal 容器（index.html 的 #concept-modal）。
// 弹出时自动暂停游戏进程，关闭后自动恢复——保证玩家能专注阅读，又不必手动点继续。

let el: HTMLElement | null = null;
let onOpen: (() => void) | null = null;
let onClose: (() => void) | null = null;

export function initModal(node: HTMLElement): void {
  el = node;
  // 点击遮罩空白处关闭
  node.addEventListener('click', (e) => {
    if (e.target === node) closeModal();
  });
  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el && !el.classList.contains('hidden')) closeModal();
  });
}

// 由 main 注册：打开时暂停、关闭时恢复
export function setModalHooks(open: () => void, close: () => void): void {
  onOpen = open;
  onClose = close;
}

export function isModalOpen(): boolean {
  return !!el && !el.classList.contains('hidden');
}

// 需要自定义交互的弹窗（存档列表、开局设定）用它拿到容器，自行绑定事件
export function modalRoot(): HTMLElement | null {
  return el;
}

export function showModal(html: string): void {
  if (!el) return;
  const wasOpen = !el.classList.contains('hidden');
  el.classList.remove('hidden');
  el.innerHTML = `<div class="card">${html}</div>`;
  el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal));
  // 弹窗互相替换时不重复触发暂停钩子
  if (!wasOpen && onOpen) onOpen();
}

export function closeModal(): void {
  if (!el || el.classList.contains('hidden')) return;
  el.classList.add('hidden');
  el.innerHTML = '';
  if (onClose) onClose();
}
