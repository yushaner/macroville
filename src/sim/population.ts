// 人口落位：把迁移产生的「真实人口」分配到具体的居住用地上。
//
// 这一步是这一版模型和上一版最大的不同：人口不再直接等于 households 数组的长度，
// 而是住在地块的 tile.pop 上（真实口径），受每块地按容积率算出的承载量硬约束。
// 于是「有没有房子」第一次成了城市能不能长起来的物理瓶颈 ——
// 玩家会发现光把工资和满意度拉满没用，还得让 gov 把公共服务跟上、得住区的容积率爬上去。

import { CONFIG } from './config';
import { popCapOf } from './land';
import type { TileData } from './types';

/** 本轮需要的家庭样本数：每个样本至少代表 1 户、最多代表 HH_PER_SAMPLE_MAX 户 */
export function sampleCountFor(realHouseholds: number): number {
  const real = Math.max(1, realHouseholds);
  const floor = Math.max(CONFIG.MIN_SAMPLES, Math.ceil(real / CONFIG.HH_PER_SAMPLE_MAX));
  // 样本数不能超过真实户数，否则会冒出「一个样本代表 0.6 户」这种说不通的比例
  return Math.max(1, Math.min(Math.ceil(real), Math.min(CONFIG.MAX_SAMPLES, floor)));
}

/** 地块的宜居吸引力：公共服务 + 交通可达 + 市政配套 − 污染 */
export function attractivenessOf(t: TileData): number {
  return Math.max(0.02, 0.35 + t.amenity * 0.4 + t.transit * 0.35 + t.utility * 0.2 - t.pollution * 0.5);
}

/**
 * 把 people 个人按「剩余容量」加权摊到住区地块上。
 * 返回实际安置的人数 —— 房屋供给不足时，安置不了的那部分人被挤出这座城市。
 */
export function distributePopulation(tiles: TileData[], residential: number[], people: number): number {
  if (residential.length === 0 || people <= 0) return 0;
  let room = 0;
  const left = residential.map((i) => {
    const gap = Math.max(0, popCapOf(tiles[i]) - tiles[i].pop);
    room += gap;
    return gap;
  });
  if (room <= 0) return 0;
  const quota = Math.min(people, room);
  for (let k = 0; k < residential.length; k++) {
    tiles[residential[k]].pop += quota * (left[k] / room);
  }
  return quota;
}

/** 人口流失：先从最不宜居的地块里退租 */
export function removePopulation(tiles: TileData[], residential: number[], people: number): number {
  if (residential.length === 0 || people <= 0) return 0;
  const weights = residential.map((i) => Math.max(0.01, tiles[i].pop) / attractivenessOf(tiles[i]));
  let total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) total = 1;
  let done = 0;
  for (let k = 0; k < residential.length; k++) {
    const take = Math.min(tiles[residential[k]].pop, people * (weights[k] / total));
    tiles[residential[k]].pop -= take;
    done += take;
  }
  return done;
}

/** 按现有人口加权随机抽一个住宅地块（给新建家庭样本落户用） */
export function pickTileByPop(tiles: TileData[], rnd: () => number): number {
  let total = 0;
  let fallback = -1;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.type !== 'residential' || !t.developed) continue;
    if (fallback < 0) fallback = i;
    total += Math.max(1, t.pop);
  }
  if (total <= 0) return fallback < 0 ? 0 : fallback;
  let r = rnd() * total;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (t.type !== 'residential' || !t.developed) continue;
    r -= Math.max(1, t.pop);
    if (r <= 0) return i;
  }
  return fallback;
}
