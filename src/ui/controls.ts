// 控制条：时间速度、政策滑杆（按视角与游戏年份逐步解锁）、存档/读档/重置。

import type { Government, SimState } from '../sim/types';
import { leversFor, lockedLeversFor, type LeverDef, type LeverScope } from '../data/levers';

const SCOPE_TITLE: Record<LeverScope, string> = {
  gov: '政府政策',
  household: '家庭决策',
  firm: '企业经营',
};

export interface ControlsOpts {
  controlsEl: HTMLElement; // 顶栏右侧
  policyEl: HTMLElement; // 侧栏政策面板
  onSpeed: (speed: number) => void;
  onLever: (scope: LeverScope, target: string, value: number) => void;
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
  onTerm: (key: string) => void; // 点击专业名词查看释义
}

export class Controls {
  private speed = 1;
  private renderedKeys: string[] = [];
  private scope: LeverScope = 'gov';

  constructor(private opts: ControlsOpts) {
    this.buildSpeed();
    this.buildPolicySkeleton();
  }

  setScope(scope: LeverScope): void {
    this.scope = scope;
    this.renderedKeys = []; // 强制重建
    const h = this.opts.policyEl.querySelector('h3');
    if (h) h.textContent = SCOPE_TITLE[scope];
  }

  private buildSpeed(): void {
    const el = this.opts.controlsEl;
    const speeds = [
      { label: '⏸', v: 0 },
      { label: '1×', v: 1 },
      { label: '2×', v: 2 },
      { label: '4×', v: 4 },
    ];
    el.innerHTML = '';
    for (const s of speeds) {
      const b = document.createElement('button');
      b.textContent = s.label;
      b.dataset.v = String(s.v);
      if (s.v === 1) b.classList.add('active');
      b.addEventListener('click', () => {
        this.speed = s.v;
        el.querySelectorAll('button.speed').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        this.opts.onSpeed(s.v);
      });
      b.classList.add('speed');
      el.appendChild(b);
    }
    const save = btn('存档', () => this.opts.onSave());
    const load = btn('读档', () => this.opts.onLoad());
    const reset = btn('新局', () => this.opts.onReset());
    save.title = '命名保存 / 覆盖已有存档';
    load.title = '从存档列表里挑一个读';
    reset.title = '重新选一份城市蓝图，开新的一局';
    el.append(save, load, reset);
  }

  private buildPolicySkeleton(): void {
    const el = this.opts.policyEl;
    el.className = 'panel';
    el.innerHTML = `<h3>${SCOPE_TITLE[this.scope]}</h3><div id="levers"></div>`;
    const note = document.createElement('p');
    note.style.cssText = 'color:#8b93a7;font-size:11px;margin-top:8px';
    note.textContent =
      '拖动滑杆即改变经济系统的约束；点击名称查看释义。随城市成长与概念解锁，会放出更多调节工具。';
    el.appendChild(note);
  }

  // 按当前视角、年份与已解锁概念渲染杠杆；仅在集合变化时重建，避免打断拖动
  refreshLevers(state: SimState): void {
    const list = leversFor(this.scope, state.indicators.year, state);
    const locked = lockedLeversFor(this.scope, state.indicators.year, state);
    const keys = [...list.map((l) => l.id), ...locked.map((x) => 'lock:' + x.lever.id)];
    const same =
      keys.length === this.renderedKeys.length && keys.every((k, i) => k === this.renderedKeys[i]);
    if (same) return;
    this.renderedKeys = keys;

    const wrap = this.opts.policyEl.querySelector('#levers') as HTMLElement;
    if (!wrap) return;
    wrap.innerHTML = '';
    for (const l of list) {
      const value = leverValue(state, l);
      wrap.appendChild(
        slider(l.label, l.min, l.max, l.step, value, (val) => {
          this.opts.onLever(l.scope, l.target, val);
        }, l.fmt, () => this.opts.onTerm(l.id)),
      );
    }
    // 未解锁的旋钮不隐藏，而是显示锁定原因——让「还能解锁什么」可见
    for (const { lever, reason } of locked) {
      const row = document.createElement('div');
      row.className = 'slider-row locked-row';
      const lab = document.createElement('label');
      lab.textContent = `🔒 ${lever.label}`;
      lab.style.cursor = 'help';
      lab.title = '点击查看概念释义';
      lab.addEventListener('click', () => this.opts.onTerm(lever.id));
      const note = document.createElement('span');
      note.className = 'lock-note';
      note.textContent = reason;
      row.append(lab, note);
      wrap.appendChild(row);
    }
  }

  private highlightSpeed(v: number): void {
    this.opts.controlsEl.querySelectorAll('button.speed').forEach((x) => x.classList.remove('active'));
    const b = this.opts.controlsEl.querySelector(`button.speed[data-v="${v}"]`);
    b?.classList.add('active');
  }

  // 弹窗弹出时临时暂停：高亮 ⏸ 并通知上层停止计时
  pause(): void {
    this.speed = 0;
    this.highlightSpeed(0);
    this.opts.onSpeed(0);
  }

  // 弹窗关闭后恢复到暂停前的速度继续运行
  resume(speed: number): void {
    if (speed <= 0) return;
    this.speed = speed;
    this.highlightSpeed(speed);
    this.opts.onSpeed(speed);
  }

  syncFrom(state: SimState): void {
    this.renderedKeys = [];
    this.refreshLevers(state);
  }
}

function leverValue(state: SimState, l: LeverDef): number {
  if (l.scope === 'gov') return govValue(state.gov, l.target);
  if (l.scope === 'household') return state.householdParams[l.target];
  return state.firmParams[l.target];
}

// Government 含 subsidy 等非数值字段，需按字段名安全取数
function govValue(g: Government, target: string): number {
  const v = (g as unknown as Record<string, unknown>)[target];
  return typeof v === 'number' ? v : 0;
}

function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function slider(
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
  fmt: (v: number) => string,
  onLabelClick: () => void,
): HTMLElement {
  const row = document.createElement('div');
  row.className = 'slider-row';
  const lab = document.createElement('label');
  lab.textContent = label;
  lab.style.cursor = 'help';
  lab.title = '点击查看释义';
  lab.addEventListener('click', onLabelClick);
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = fmt(value);
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = fmt(v);
    onInput(v);
  });
  row.append(lab, input, val);
  return row;
}
