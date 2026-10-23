// 正交路网规划。
//
// 现实里的城市道路网有三种东西：骨架（主干道）、联络（次干道）、微循环（支路），
// 它们大多是横平竖直的方格网 —— 北京、西安、纽约、巴塞罗那都是这个路子。
// 而真实的方格网又不是尺子画的：间距会抖、有的支路只对了一半就成了断头路、
// 环路会在某个方向先建起来。所以这里用「规则 + 种子随机」来生成：
//
//   ① 中轴线：一条横一条竖穿过城市原点，永远是主干道（城市就是围着它长起来的）
//   ② 主干道：以原点为中心向两侧扩展，间距 7~10 格随机（≈ 1.8~2.5 km，与真实干道间距同量级）
//   ③ 次干道：在相邻主干道之间插 1~2 条，位置随机，15% 的区间会缺一条
//   ④ 支路  ：在剩下的街区里再细分，35% 的缺口才会补，且三成只修一半（断头路）
//   ⑤ 环路  ：矩形快速环路，半径随机，某些方向会先缺席
//
// 输出的 roadClass（0 非道路 / 1 支路 / 2 次干道 / 3 主干道）是「规划图纸」：
// 全城的道路一次性规划好，但只有城市扩张到的那一段会真正通车（tile.developed）。
// 于是玩家能看见路网跟着城市一圈一圈往外长 —— 而不是开局就把整张地图铺满马路。

import { RNG } from './rng';
import type { RoadClass } from './types';

export interface RoadPlan {
  width: number;
  height: number;
  cls: Uint8Array; // 每格的道路等级 0-3
  originX: number; // 城市原点（中轴线交点）
  originY: number;
  rows: number[]; // 被划为东西向道路的行号
  cols: number[]; // 被划为南北向道路的列号
}

// —— 生成参数（都带抖动，避免看起来像棋盘）——
// 间距的单位是「格」= 250m：主干道 10~14 格 ≈ 2.5~3.5km，与真实城市干道间距同量级；
// 次干道把它切到 ~1.5km，支路再切到 600~800m —— 正好是一个街坊的合理尺度。
// （注意：路网占用的格子比例要控制在三成上下，否则剩下的建设用地就不够住一百万人口了。）
const ARTERIAL_STEP: [number, number] = [10, 14];
const SECONDARY_MIN_GAP = 8; // 次干道只在这么宽的街区里补
const SECONDARY_SKIP_P = 0.2; // 有 20% 的主干道区间不设次干道
const SECONDARY_SPLIT: [number, number] = [1, 1]; // 每个区间插入 1 条
const BRANCH_MIN_GAP = 5; // 支路只在这么宽的街区里补
const BRANCH_P = 0.35; // 35% 的街区加支路
const BRANCH_STUB_P = 0.32; // 其中三成只修一部分（断头路）
const RING_COUNT: [number, number] = [1, 2]; // 环路条数
const RING_START = 9; // 第一条环路的起始半径
const RING_STEP: [number, number] = [6, 9]; // 环路间距
const RING_EDGE_MISS_P = 0.22; // 每个方向的环路段有 22% 缺席（先建半环很常见）

type Span = { from: number; to: number };

// 在闭区间 [lo, hi] 里按方法论插入若干条线：位置抖动、数量随机
function insertLines(positions: number[], lo: number, hi: number, n: number, rng: RNG): void {
  for (let k = 1; k <= n; k++) {
    const frac = k / (n + 1);
    // 抖动幅度限制在 ±18%，保证线不会贴到已有骨架上
    const jitter = rng.range(-0.18, 0.18);
    const pos = Math.round(lo + (hi - lo) * Math.min(0.82, Math.max(0.18, frac + jitter)));
    if (pos > lo && pos < hi && !positions.includes(pos)) positions.push(pos);
  }
}

// 沿某轴线生成一条骨干平滑，返回可用区间的行/列号
function buildAxis(
  size: number,
  origin: number,
  reach: number,
  rng: RNG,
): { arterial: number[]; secondary: number[]; branch: number[] } {
  const lo = Math.max(1, origin - reach);
  const hi = Math.min(size - 2, origin + reach);

  // ① 中轴线 + 两侧随机间距的主干道
  const arterial: number[] = [origin];
  for (let p = origin; ; ) {
    p -= rng.int(ARTERIAL_STEP[0], ARTERIAL_STEP[1]);
    if (p <= lo) break;
    arterial.push(p);
  }
  for (let p = origin; ; ) {
    p += rng.int(ARTERIAL_STEP[0], ARTERIAL_STEP[1]);
    if (p >= hi) break;
    arterial.push(p);
  }
  arterial.sort((a, b) => a - b);

  // ② 次干道：在每个主干道区间里插 1~2 条
  const secondary: number[] = [];
  for (let i = 0; i + 1 < arterial.length; i++) {
    const a = arterial[i];
    const b = arterial[i + 1];
    if (b - a < SECONDARY_MIN_GAP) continue;
    if (rng.float() < SECONDARY_SKIP_P) continue;
    const n = Math.min(rng.int(SECONDARY_SPLIT[0], SECONDARY_SPLIT[1]), Math.floor((b - a) / 2));
    insertLines(secondary, a, b, Math.max(1, n), rng);
  }

  // ③ 支路：在「骨架 ∪ 次干道」之后再细分一轮
  const trunk = [...arterial, ...secondary].sort((a, b) => a - b);
  const branch: number[] = [];
  for (let i = 0; i + 1 < trunk.length; i++) {
    const a = trunk[i];
    const b = trunk[i + 1];
    if (b - a < BRANCH_MIN_GAP) continue;
    if (rng.float() >= BRANCH_P) continue;
    insertLines(branch, a, b, 1, rng);
  }
  return { arterial, secondary, branch };
}

export function buildRoadPlan(seed: number, width: number, height: number, reach: number): RoadPlan {
  const rng = new RNG(seed ^ 0x5f3a91c7);
  const cls = new Uint8Array(width * height);
  const at = (x: number, y: number): number => y * width + x;
  const put = (x: number, y: number, c: RoadClass): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = at(x, y);
    // 等级高的道路覆盖等级低的：主干道优先，支路不覆盖已有干道
    if (cls[i] < c) cls[i] = c;
  };

  // 城市原点略偏离几何中心：完全对称的方格网看起来像贴图，不像城市
  const originX = Math.floor(width / 2) + rng.int(-2, 2);
  const originY = Math.floor(height / 2) + rng.int(-2, 2);

  const rx = buildAxis(width, originX, reach, rng);
  const ry = buildAxis(height, originY, reach, rng);

  const rows: number[] = [];
  const cols: number[] = [];
  const drawLine = (positions: number[], c: RoadClass, isRow: boolean, stubs: boolean): void => {
    for (const p of positions) {
      // 每一条线的通车范围：默认贯通全轴，支路有概率只修一段（断头路）
      let span: Span = { from: 0, to: isRow ? width - 1 : height - 1 };
      if (stubs && rng.float() < BRANCH_STUB_P) {
        const len = span.to - span.from + 1;
        const cut = Math.round(len * rng.range(0.45, 0.85));
        const startAtZero = rng.float() < 0.5;
        span = startAtZero
          ? { from: span.from, to: span.from + cut }
          : { from: span.to - cut, to: span.to };
      }
      for (let q = span.from; q <= span.to; q++) {
        if (isRow) put(q, p, c);
        else put(p, q, c);
      }
      (isRow ? rows : cols).push(p);
    }
  };

  drawLine(ry.arterial, 3, true, false);
  drawLine(rx.arterial, 3, false, false);
  drawLine(ry.secondary, 2, true, false);
  drawLine(rx.secondary, 2, false, false);
  drawLine(ry.branch, 1, true, true);
  drawLine(rx.branch, 1, false, true);

  // ④ 环路：矩形快速路。半径与条数随机，某些方向的段落会缺席（半环很常见）
  let r = RING_START;
  const ringCount = rng.int(RING_COUNT[0], RING_COUNT[1]);
  for (let n = 0; n < ringCount; n++) {
    r += rng.int(RING_STEP[0], RING_STEP[1]);
    if (r > reach - 1) break;
    const x0 = originX - r;
    const x1 = originX + r;
    const y0 = originY - r;
    const y1 = originY + r;
    const miss = (): boolean => rng.float() < RING_EDGE_MISS_P;
    if (!miss()) for (let x = x0; x <= x1; x++) put(x, y0, 3);
    if (!miss()) for (let x = x0; x <= x1; x++) put(x, y1, 3);
    if (!miss()) for (let y = y0; y <= y1; y++) put(x0, y, 3);
    if (!miss()) for (let y = y0; y <= y1; y++) put(x1, y, 3);
    // 环路所在的四条边也记进 rows/cols，方便 UI 单独高亮环线
    rows.push(y0, y1);
    cols.push(x0, x1);
  }

  return { width, height, cls, originX, originY, rows, cols };
}

/** 规划路网占用的格子比例（标定与自检用） */
export function roadShare(plan: RoadPlan): number {
  let n = 0;
  for (let i = 0; i < plan.cls.length; i++) if (plan.cls[i] > 0) n++;
  return plan.cls.length > 0 ? n / plan.cls.length : 0;
}
