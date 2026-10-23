// 存档：多槽位 + 自定义命名 + 选择读取。
//
// 之前只有一个固定 key 的存档，且"保存"会用当前视角名当文件名的默认值——
// 玩家既没法给自己的城市起名，也没法在几个存档之间挑一个读。
// 现在改成槽位制：索引存元信息（名称/时间/阶段/人口/轮次），正文单独存。

import { stageById } from '../sim/stages';
import type { SimState } from '../sim/types';

const INDEX_KEY = 'macroville.saves.index.v2';const SLOT_PREFIX = 'macroville.saves.slot.v2.';
const ACTIVE_KEY = 'macroville.saves.active.v2';
const MAX_SLOTS = 12;

export interface SaveMeta {
  id: string;
  name: string; // 玩家自定义名称
  createdAt: number;
  updatedAt: number;
  month: number;
  stageName: string;
  population: number;
  round: number;
  unlocked: number; // 已解锁名词数
  blueprint: string;
  orientation: string;
}

export interface SaveSlot extends SaveMeta {
  state: SimState;
}

function readIndex(): SaveMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as SaveMeta[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeIndex(list: SaveMeta[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('存档索引写入失败', e);
  }
}

function newId(): string {
  return `s${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

// 从状态里提炼元信息（列表展示用，不存正文）
function metaOf(id: string, name: string, state: SimState, createdAt: number): SaveMeta {
  return {
    id,
    name,
    createdAt,
    updatedAt: Date.now(),
    month: state.month,
    stageName: stageById(state.stage).name,
    population: Math.round(state.indicators?.population ?? state.households.length),
    round: state.cycle?.round ?? 1,
    unlocked: state.unlocked?.length ?? 0,
    blueprint: state.blueprint ?? 'marketTown',
    orientation: state.orientation ?? 'balanced',
  };
}

export function listSaves(): SaveMeta[] {
  return readIndex().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function activeSaveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function setActive(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* 忽略：只是记不住当前槽位，不影响存档本身 */
  }
}

// 生成一个建议名：不再默认按视角命名，而是「城市定位 + 阶段」，玩家可改
export function suggestName(state: SimState): string {
  const stage = stageById(state.stage).name;
  const orientMap: Record<string, string> = {
    balanced: '综合',
    industrial: '工业',
    commercial: '商贸',
    tech: '科创',
    eco: '宜居',
  };
  const o = orientMap[state.orientation ?? 'balanced'] ?? '综合';
  const y = state.indicators?.year ?? 2026;
  return `${o}·${stage}·${y}年`;
}

/** 存为新槽位。返回槽位 id（失败返回 null） */
export function saveAsSlot(state: SimState, name: string): string | null {
  const id = newId();
  const list = readIndex();
  // 槽位上限：超出时先淘汰最久没更新的那个
  if (list.length >= MAX_SLOTS) {
    list.sort((a, b) => a.updatedAt - b.updatedAt);
    const drop = list.shift();
    if (drop) {
      try {
        localStorage.removeItem(SLOT_PREFIX + drop.id);
      } catch {
        /* 忽略 */
      }
    }
  }
  const meta = metaOf(id, name || suggestName(state), state, Date.now());
  try {
    localStorage.setItem(SLOT_PREFIX + id, JSON.stringify(state));
  } catch (e) {
    console.warn('保存失败（可能超出本地存储容量）', e);
    return null;
  }
  list.push(meta);
  writeIndex(list);
  setActive(id);
  return id;
}

/** 覆盖写入已有槽位 */
export function overwriteSlot(id: string, state: SimState, name?: string): boolean {
  const list = readIndex();
  const i = list.findIndex((m) => m.id === id);
  if (i < 0) return false;
  const prev = list[i];
  const meta = metaOf(id, name ?? prev.name, state, prev.createdAt);
  try {
    localStorage.setItem(SLOT_PREFIX + id, JSON.stringify(state));
  } catch (e) {
    console.warn('保存失败（可能超出本地存储容量）', e);
    return false;
  }
  list[i] = meta;
  writeIndex(list);
  setActive(id);
  return true;
}

export function loadSlot(id: string): SimState | null {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + id);
    if (!raw) return null;
    const s = JSON.parse(raw) as SimState;
    upgradeUnits(s);
    setActive(id);
    const list = readIndex();
    const m = list.find((x) => x.id === id);
    if (m) {
      m.updatedAt = Date.now();
      writeIndex(list);
    }
    return s;
  } catch (e) {
    console.warn('读档失败', e);
    return null;
  }
}

export function deleteSlot(id: string): void {
  try {    localStorage.removeItem(SLOT_PREFIX + id);
  } catch {
    /* 忽略 */
  }
  writeIndex(readIndex().filter((m) => m.id !== id));
  if (activeSaveId() === id) {
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* 忽略 */
    }
  }
}

export function renameSlot(id: string, name: string): void {
  const list = readIndex();
  const m = list.find((x) => x.id === id);
  if (!m) return;
  m.name = name;
  m.updatedAt = Date.now();
  writeIndex(list);
}

/** 兼容旧版：单槽存档迁移到槽位制 */
export function migrateLegacy(): void {
  const OLD = 'macroville.save.v1';
  try {
    const raw = localStorage.getItem(OLD);
    if (!raw) return;
    const s = JSON.parse(raw) as SimState;
    if (s && typeof s === 'object' && Array.isArray(s.households)) {
      upgradeUnits(s); // 旧档的数值还是抽象单位，先换算成元/件再存
      saveAsSlot(s, '旧存档（已换算口径）');
    }
    localStorage.removeItem(OLD);
  } catch {
    /* 忽略：没有旧存档或已损坏 */
  }
}

/** 兼容旧调用：读取"最近一个"存档 */
export function loadState(): SimState | null {
  const list = listSaves();
  if (list.length === 0) return null;
  return loadSlot(list[0].id);
}

export function clearState(): void {
  const list = readIndex();
  for (const m of list) {
    try {
      localStorage.removeItem(SLOT_PREFIX + m.id);
    } catch {
      /* 忽略 */
    }
  }
  writeIndex([]);
  try {
    localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* 忽略 */
  }
}

// ── 数值口径升级：旧档（无量纲抽象单位）→ 现实口径 ──
// 换算关系来自一次等价量纲重标定：钱 ×1000（元）、产量 ×100（件）、单价 ×10（元/件）、
// 地价 ×20（元/㎡）、人口 ×2.6（户均人口）。所有比例关系不变，只把"9.6"变成"¥9,600"。
const FORMAT = 2;
const MONEY = 1000;
const QTY = 100;
const PRICE = 10;
const LAND = 20;
const HH = 2.6;

function mul(obj: Record<string, unknown> | undefined, key: string, k: number): void {
  if (!obj) return;
  const v = obj[key];
  if (typeof v === 'number' && Number.isFinite(v)) obj[key] = v * k;
}

export function upgradeUnits(s: SimState): void {
  if (!s || s.format === FORMAT) return;
  const raw = s as unknown as Record<string, unknown>;

  const gov = raw.gov as Record<string, unknown> | undefined;
  mul(gov, 'treasury', MONEY);
  mul(gov, 'minWage', MONEY);

  for (const h of (raw.households as Record<string, unknown>[]) ?? []) {
    mul(h, 'savings', MONEY);
    mul(h, 'wage', MONEY);
    mul(h, 'consumption', MONEY);
  }
  for (const f of (raw.firms as Record<string, unknown>[]) ?? []) {
    mul(f, 'capital', MONEY);
    mul(f, 'profit', MONEY);
    mul(f, 'revenue', MONEY);
    mul(f, 'wageOffered', MONEY);
    mul(f, 'inventory', QTY);
    mul(f, 'output', QTY);
    mul(f, 'price', PRICE);
  }
  for (const t of ((raw.city as Record<string, unknown> | undefined)?.tiles as Record<string, unknown>[]) ?? []) {
    mul(t, 'landValue', LAND);
  }

  const ind = raw.indicators as Record<string, unknown> | undefined;
  for (const k of ['avgWage', 'gdp', 'treasury', 'potentialOutput']) mul(ind, k, MONEY);
  mul(ind, 'population', HH);

  for (const h of (raw.history as Record<string, unknown>[]) ?? []) {
    for (const k of ['avgWage', 'gdp', 'treasury', 'potentialOutput']) mul(h, k, MONEY);
    mul(h, 'population', HH);
  }

  const series = raw.series as Record<string, number[]> | undefined;
  if (series) {
    for (const k of ['disposableIncome', 'wealth', 'avgProfit', 'revenue']) {
      if (Array.isArray(series[k])) series[k] = series[k].map((v) => v * MONEY);
    }
    if (Array.isArray(series.avgPrice)) series.avgPrice = series.avgPrice.map((v) => v * PRICE);
    if (Array.isArray(series.maxLandValue)) series.maxLandValue = series.maxLandValue.map((v) => v * LAND);
  }

  const bc = raw.business as Record<string, unknown> | undefined;
  mul(bc, 'potentialOutput', MONEY);
  mul(bc, 'trend', MONEY);

  s.format = FORMAT;
}
