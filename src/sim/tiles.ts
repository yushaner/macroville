// 地块属性演化：让地图上的每一格都不再是静态色块，而是随经济运行结果逐月变化的街区。
//
// 每月按固定顺序更新一遍：
//   承载量核算 → 污染排放与扩散 → 公共服务辐射 → 市政配套 → 交通可达 → 路网拥堵
//   → 使用强度 → 地价 → 开发强度（容积率）升降 → 用途演进
// 属性反过来也会影响经济（污染压满意度、公共服务抬满意度），构成一个闭环。
//
// 设计取向：所有属性都用「向目标值缓慢移动」而非直接赋值，
// 这样地图变化是渐进可见的，玩家能看着一条街慢慢旺起来或慢慢荒下去。

import { CONFIG } from './config';
import {
  LEVEL_MAX,
  LEVEL_MIN,
  NET_AREA,
  farOf,
  gfaCapOf,
  jobCapOf,
  planLevelOf,
  planPopCapOf,
  popCapOf,
  ringIndexOf,
  TIER_MAX_LEVEL,
} from './land';
import { stageTier } from './stages';
import { distributePopulation } from './population';
import { hhScaleOf } from './scale';
import { RNG } from './rng';
import type { City, SimState, TileData } from './types';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// 一个月里属性值向目标靠拢的速度（0-1）
const EASE = 0.22;
// 零售 / 服务业的坪效基准：元/㎡·月（月消费额 ÷ 商业建筑面积）。
// 按现实口径标定：人均月消费约 ¥2,500、人均商业建筑面积约 2~3㎡，
// 折算下来每平米商业面积每月承载的营业额在 ¥300~500 量级（万达级购物中心的坪效也在这个区间）。
// 早先写成 ¥1,500，商业景气度被系统性低估到 0.2，商业地块永远达不到加建门槛 ——
// 容积率上不去、岗位供给上不去，城市在两三万人的规模上就没有岗位可用了。
const RETAIL_SALES_PER_M2 = 400;
// 建成区的「基础市政配套」：只要通了路、划进了建成区，水电气与通信就按最低标准到位。
// 没有这一项时，学校医院电厂还没建起来的前几十个月 utility 恒为 0，
// 容积率一步也升不上去 —— 城市会被卡在「一层平房」阶段永远长不大。
const BASE_UTILITY = 0.5;
// 交通可达性的步行上限：走到最近的干道口超过 6 格（1.5km）就算彻底没接上路网
const TRANSIT_REACH = 6;

function forEachNeighbor(city: City, i: number, fn: (n: number) => void): void {
  const W = city.width;
  const H = city.height;
  const x = i % W;
  const y = Math.floor(i / W);
  if (x > 0) fn(i - 1);
  if (x < W - 1) fn(i + 1);
  if (y > 0) fn(i - W);
  if (y < H - 1) fn(i + W);
}

function hasAdjacentRoad(city: City, i: number): boolean {
  let road = false;
  forEachNeighbor(city, i, (n) => {
    if (city.tiles[n].type === 'road' && city.tiles[n].developed) road = true;
  });
  return road;
}

function distanceFromCenter(city: City, i: number): number {
  return Math.hypot((i % city.width) - city.originX, Math.floor(i / city.width) - city.originY);
}

// 归一化距离的分母：城市原点能铺到的最远距离（与 cityGen 的 maxR 同口径）
function maxDistOf(city: City): number {
  return (
    Math.min(
      city.originX,
      city.originY,
      city.width - city.originX - 1,
      city.height - city.originY - 1,
    ) || 1
  );
}

// 公共服务源位到周边的辐射强度与半径（单位是「格」，一格 = 250m）
const AMENITY_SOURCES: Partial<Record<TileData['type'], { strength: number; radius: number }>> = {
  school: { strength: 0.75, radius: 4 }, // ≈1km 服务半径
  hospital: { strength: 0.8, radius: 6 }, // ≈1.5km
  park: { strength: 0.45, radius: 3 },
};

// ————————————————————————————————————————————————————————————
// 主循环
// ————————————————————————————————————————————————————————————
export function updateTiles(state: SimState): void {
  const city = state.city;
  const tiles = city.tiles;
  const N = tiles.length;
  if (N === 0) return;
  const maxDist = Math.hypot(city.originX, city.originY) || 1;
  const scale = Math.max(0.05, hhScaleOf(state));

  // —— 1) 占位统计：住户与企业落到哪块地上 ——
  for (const t of tiles) {
    t.hhCount = 0;
    t.firmId = null;
  }
  for (const h of state.households) {
    const t = tiles[h.tile];
    if (t) t.hhCount++;
  }
  // 一个街区上会有好几家企业（写字楼里几十家公司共用一栋楼），
  // 岗位要按地块汇总，不能只算 tile.firmId 指向的那一家。
  const jobByTile = new Map<number, number>();
  for (const f of state.firms) {
    const t = tiles[f.tile];
    if (!t) continue;
    if (t.firmId === null) t.firmId = f.id;
    jobByTile.set(f.tile, (jobByTile.get(f.tile) ?? 0) + f.employees.length);
  }

  // —— 2) 污染：工业与电厂排放，车流次之；向邻域扩散并缓慢自净 ——
  const emit = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = tiles[i];
    if (!t.developed) continue;
    // 排放量随开发强度（楼层、产能）上升：容积率越高的厂子排得越多
    let e = 0;
    if (t.type === 'industrial') e += 0.0035 * t.level + (t.firmId !== null ? 0.0025 : 0);
    else if (t.type === 'power') e += 0.0028 * t.level;
    else if (t.type === 'road') e += 0.0009 * t.density * (1 + t.roadClass * 0.4);
    emit[i] = e;
  }
  const pollution = new Float64Array(N);
  // 自净能力来自公共支出：治理投入越高，污染衰减越快（同一份税钱既修学校也买清洁）
  const selfClean = 0.9 + state.gov.publicSpend * 0.06;
  for (let i = 0; i < N; i++) {
    let neiSum = 0;
    let neiCount = 0;
    forEachNeighbor(city, i, (n) => {
      neiSum += tiles[n].pollution;
      neiCount++;
    });
    const neiAvg = neiCount > 0 ? neiSum / neiCount : tiles[i].pollution;
    pollution[i] = clamp(tiles[i].pollution * selfClean + emit[i] + neiAvg * 0.07, 0, 1);
  }

  // —— 3) 公共服务辐射：学校 / 医院 / 公园按半径递减惠及周边 ——
  // 服务质量随公共支出伸缩：削减公共服务预算，学校和医院会「空转」
  const serviceK = 0.5 + state.gov.publicSpend * 1.6;
  const amenity = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t = tiles[i];
    if (!t.developed) continue;
    const src = AMENITY_SOURCES[t.type];
    if (!src) continue;
    const sx = i % city.width;
    const sy = Math.floor(i / city.width);
    const rCeil = Math.ceil(src.radius);
    for (let dy = -rCeil; dy <= rCeil; dy++) {
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        const nx = sx + dx;
        const ny = sy + dy;
        if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) continue;
        const d = Math.hypot(dx, dy);
        if (d > src.radius) continue;
        amenity[ny * city.width + nx] += src.strength * serviceK * (1 - d / src.radius);
      }
    }
  }

  // —— 4) 市政配套（水/电）：水电设施按服务半径覆盖，缺水缺电的地块开发不上去 ——
  const utility = utilityField(state);

  // —— 5) 交通可达性：从已通车的干道做一次多源扩散 ——
  // 现实里「距离地铁站多少米」直接决定租金；这里用的是同一个道理。
  const transit = transitField(city);

  // —— 6) 景气信号：商业按坪效、工业按开工率 ——
  const totalConsumption = state.households.reduce((a, h) => a + h.consumption, 0) * scale;
  let comGfa = 0;
  for (const t of tiles) {
    if (t.developed && t.type === 'commercial') comGfa += NET_AREA * farOf(t.type, t.level);
  }
  // 商业景气 = 实际坪效 ÷ 基准坪效：整座城市的月消费额摊到商业建筑面积上
  const businessActivity = comGfa > 0 ? clamp(totalConsumption / comGfa / RETAIL_SALES_PER_M2, 0, 1.4) : 0;
  let totalEmp = 0;
  let totalCap = 0;
  for (const f of state.firms) {
    totalEmp += f.employees.length;
    totalCap += f.capacity;
  }
  const industrialUtil = totalCap > 0 ? totalEmp / totalCap : 0;
  // 全城出行强度：人口与岗位越多，路越堵
  const trips = totalEmp * 2.2 * scale;

  for (let i = 0; i < N; i++) {
    const t = tiles[i];
    if (!t.developed) {
      t.pollution = pollution[i] * 0.6; // 荒地也有少量背景污染，但不会被完全抹平
      t.amenity = clamp(amenity[i], 0, 1);
      t.utility = clamp(utility[i], 0, 1);
      t.transit = clamp(transit[i], 0, 1);
      t.density = 0;
      t.congestion = 0;
      t.jobs = 0;
      continue;
    }

    t.pollution = pollution[i];
    t.amenity = clamp(amenity[i], 0, 1);
    t.utility = t.utility + (clamp(utility[i], 0, 1) - t.utility) * EASE;
    t.transit = t.transit + (clamp(transit[i], 0, 1) - t.transit) * EASE;

    // 7) 使用强度
    let targetDensity = t.density;
    if (t.type === 'residential') {
      // 入住率：人口 ÷ 承载量。住不下的部分会被 migrate 拦住，这里只是如实反映
      const cap = popCapOf(t);
      targetDensity = cap > 0 ? clamp(t.pop / cap, 0, 1) : 0;
    } else if (t.type === 'commercial') {
      targetDensity = t.firmId !== null ? clamp(0.3 + businessActivity * 0.6, 0, 1) : 0.05;
    } else if (t.type === 'industrial') {
      targetDensity = t.firmId !== null ? clamp(0.35 + industrialUtil * 0.6, 0, 1) : 0.05;
    } else if (t.type === 'road') {
      targetDensity = clamp(trips / 400_000, 0, 1);
    } else {
      targetDensity = 0.5; // 水电校医等设施恒定运转
    }
    t.density += (targetDensity - t.density) * 0.25;

    // 8) 岗位：真实口径 = 该地块上所有企业的样本雇员数 × 倍率
    t.jobs = (jobByTile.get(i) ?? 0) * scale;

    // 9) 拥堵：路网饱和度 = 出行需求 ÷ 通行能力
    if (t.type === 'road') {
      const cap = [0, 600, 1_600, 3_600][t.roadClass] ?? 0;
      // 每条路承担的车流 ≈ 全城出行量按格数摊到路网上，再乘临路开发强度
      const share = cap > 0 ? (trips / Math.max(1, roadCount(city))) / cap : 0;
      const local = hasAdjacentRoad(city, i) ? 1 : 0.6;
      t.congestion = clamp(t.congestion + (clamp(share * local, 0, 1.4) - t.congestion) * 0.2, 0, 1);
    } else {
      t.congestion = clamp(t.congestion * 0.85 + t.transit * 0.02, 0, 1);
    }

    // 10) 地价（元/㎡ 楼面价）：区位 + 交通 + 配套 + 密度 + 公共服务 − 污染 − 拥堵
    const centrality = 1 - Math.min(1, distanceFromCenter(city, i) / maxDist);
    const targetValue = clamp(
      400 +
        centrality * 1_500 +
        t.transit * 1_200 +
        t.utility * 500 +
        t.density * 1_100 +
        t.amenity * 800 -
        t.pollution * 900 -
        t.congestion * 300 +
        (t.level - 1) * 350,
      CONFIG.LAND_VALUE_MIN,
      CONFIG.LAND_VALUE_MAX,
    );
    t.landValue += (targetValue - t.landValue) * 0.18;

    // 11) 开发强度（容积率）等级：房子住满了、地价撑得住，就拆矮楼盖高楼。
    //     这是承载量的唯一来源——同样的地，从一层院落改成十八层塔楼，能多住五倍的人。
    //     但加建有天花板：不得超过控规给这块地定的容积率上限（planLevel）。
    //     这条线把「城市最多装 100 万人」变成了物理约束，而不是一个随便写的数字。
    if (t.type === 'residential' || t.type === 'commercial' || t.type === 'industrial') {
      // 三条线取最紧的一条：控规上限、城市当下规模撑得起的强度、等级表上限
      const tierCap = TIER_MAX_LEVEL[Math.max(0, Math.min(3, stageTier(state.stage)))] ?? LEVEL_MAX;
      const ceiling = Math.min(LEVEL_MAX, tierCap, Math.max(LEVEL_MIN, t.planLevel ?? LEVEL_MAX));
      // 城市衰退时不会一夜拆楼：只有这块地确实空出来了才降一级
      if (t.level > ceiling && t.density < 0.6) t.level -= 1;
      // 「住满 / 用满」且市政跟得上 → 上调容积率。
      // 门槛按用途分开：住宅要住满了才拆矮楼盖高楼（0.9），
      // 商业与工业则是"客流 / 开工率撑得住就加建"（0.55）——
      // 写字楼和厂房不会因为上座率差一点就永远停在平房。
      const fullEnough = t.type === 'residential' ? 0.9 : 0.55;
      if (t.density > fullEnough && t.landValue > 1_400 && t.utility > 0.45 && t.level < ceiling) {
        t.level++;
      } else if (t.density < 0.3 && t.landValue < 700 && t.level > LEVEL_MIN) {
        t.level--;
      }
      // 承载量下调后要立刻把超出的人挤出该地块，否则入住率会长期大于 100%
      if (t.type === 'residential') {
        t.pop = Math.min(t.pop, popCapOf(t));
      }
    }
  }

  // —— 12) 用途演进：地块会「自己改变主意」——
  evolveUsage(state);
}

// ————————————————————————————————————————————————————————————
// 场量工具
// ————————————————————————————————————————————————————————————

/** 从水电设施出发的多源覆盖场：确保未配套的区域开发强度上不去 */
function utilityField(state: SimState): Float64Array {
  const city = state.city;
  const N = city.tiles.length;
  const out = new Float64Array(N);
  // 市政管网的服务半径：水厂 / 电厂按管网半径 3~4 格（≈1km）覆盖
  const RADIUS = { water: 4, power: 4, hospital: 3, school: 3 };
  const qual = 0.4 + state.gov.publicSpend * 1.4;
  for (let i = 0; i < N; i++) {
    const t = city.tiles[i];
    if (!t.developed) continue;
    const r = RADIUS[t.type as keyof typeof RADIUS];
    if (!r) continue;
    const sx = i % city.width;
    const sy = Math.floor(i / city.width);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = sx + dx;
        const ny = sy + dy;
        if (nx < 0 || ny < 0 || nx >= city.width || ny >= city.height) continue;
        const d = Math.hypot(dx, dy);
        if (d > r) continue;
        out[ny * city.width + nx] += qual * (1 - d / r) * 0.8;
      }
    }
  }
  // 基础配套：已划进建成区的地块至少通了水电气，管网质量再随公共支出加码。
  // 系数刻意让「默认公共支出」刚过 0.45 这条加建门槛：政府把公共服务拧到 0，
  // 容积率就一步也升不上去 —— 这是玩家该感受到的政策代价。
  for (let i = 0; i < N; i++) {
    if (!city.tiles[i].developed) continue;
    out[i] += BASE_UTILITY * (0.8 + state.gov.publicSpend * 0.4);
  }
  return out;
}

/** 交通可达性：沿已通车道路网衰减。现实里「走到最近的干道 / 站点多少米」直接写进租金 */
function transitField(city: City): Float64Array {
  const N = city.tiles.length;
  const out = new Float64Array(N);
  const dist = new Int32Array(N).fill(9999);
  const queue: number[] = [];
  for (let i = 0; i < N; i++) {
    const t = city.tiles[i];
    if (!t.developed || t.type !== 'road') continue;
    // 主干道视作「零距离」，支路要先走出两格才算接上城市路网
    dist[i] = t.roadClass === 3 ? 0 : t.roadClass === 2 ? 1 : 2;
    queue.push(i);
  }
  if (queue.length === 0) return out;
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const base = dist[cur];
    forEachNeighbor(city, cur, (n) => {
      if (base + 1 < dist[n]) {
        dist[n] = base + 1;
        queue.push(n);
      }
    });
  }
  const reach = TRANSIT_REACH;
  for (let i = 0; i < N; i++) {
    if (dist[i] >= 9999) continue;
    out[i] = clamp(1 - dist[i] / reach, 0, 1);
  }
  return out;
}

function roadCount(city: City): number {
  let n = 0;
  for (const t of city.tiles) if (t.developed && t.type === 'road') n++;
  return Math.max(1, n);
}

// 用途演进：住区满员 + 临路 + 地价高 → 沿街破墙开店；长期萧条的地块退回住区
function evolveUsage(state: SimState): number[] {
  const city = state.city;
  const tiles = city.tiles;
  const changed: number[] = [];
  let displaced = 0; // 因改用途而失去住房的常住人口，本月内重新安置

  // 「住房是否宽裕」：住区承载量还剩多少余量。
  // 这道闸门是必须的 —— 沿街破墙开店本身没错，但城市越繁荣、住区越满员，
  // 被改成商铺的住区就越多；跑上几百年，全城居住用地会被自己改光，
  // 规划承载量从 110 万掉到 50 万 —— 城市把自己的房子拆成了商场。
  // 现实中也是这个道理：住房紧张时，控规不会再批复「居改商」。
  let resCap = 0;
  let resPop = 0;
  for (const t of tiles) {
    if (t.type !== 'residential' || !t.developed) continue;
    resCap += popCapOf(t);
    resPop += t.pop;
  }
  const housingTight = resCap < resPop * 1.25;

  // 随机性必须是「种子 + 月份」派生的：用 Math.random() 会让同一 seed 跑两次结果不同，
  // 承载量体检也就没法复核了（tools/scale-check.cjs 正是靠可复现才有意义）。
  const rng = new RNG((state.seed + state.month * 7919 + 57) >>> 0);

  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    if (!t.developed) continue;
    if (t.firmId !== null) continue; // 有产业坐落的格子保持不变
    if (t.type !== 'residential' && t.type !== 'commercial') continue;
    if (rng.float() > 0.03) continue; // 每月仅少量地块重新评估用途

    const nearRoad = hasAdjacentRoad(city, i);

    // 住区满员 + 临路 + 地价高 → 沿街破墙开店（住房紧张时不批）
    if (!housingTight && t.type === 'residential' && nearRoad && t.density > 0.9 && t.landValue > 2_400) {
      // 改用途之前必须先把居民搬走：留在原地的住户会变成"住在商业用地上的人"，
      // 既不计入住区承载量，又占着人口数 —— 于是入住率被虚报成 100%，
      // 征地逻辑以为房子还够住，城市就再也不往外铺了。
      if (t.pop > 0) {
        displaced += t.pop;
        t.pop = 0;
      }
      t.type = 'commercial';
      changed.push(i);
      continue;
    }
    // 商铺长期无人问津、地价低迷 → 退回住区
    if (t.type === 'commercial' && t.density < 0.15 && t.landValue < 800) {
      t.type = 'residential';
      changed.push(i);
    }
  }
  // 被拆掉住房的人要在本月内安置到别的住区，否则人口会凭空蒸发
  if (displaced > 0) {
    const resTiles: number[] = [];
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i].type === 'residential' && tiles[i].developed) resTiles.push(i);
    }
    distributePopulation(tiles, resTiles, displaced);
  }

  // 转换后同步一次等级与密度，避免渲染出「等级 5 的空地」这类突兀组合
  for (const i of changed) {
    const t = tiles[i];
    // 用途改了，控规指标也要跟着改：居住街坊改成商业后按商业的容积率上限重新定档
    t.planLevel = planLevelOf(t.type, ringIndexOf(distanceFromCenter(city, i) / maxDistOf(city)));
    t.level = Math.max(LEVEL_MIN, Math.min(t.level - 1, t.planLevel));
    t.density = Math.min(t.density, 0.3);
  }
  return changed;
}

// —— 供其它模块读取的聚合量 ——
export interface TileSummary {
  avgLandValue: number;
  avgPollution: number;
  avgAmenity: number;
  avgTransit: number;
  builtTiles: number;
  totalTiles: number;
  // —— 承载量与供给 ——
  resTiles: number;
  popCap: number; // 已建成住区能装多少人
  resPop: number; // 实际住了多少人
  occupancy: number;
  planPopCap: number; // 全部规划居住用地铺满后能装多少人
  jobCap: number; // 已建成产业用地的岗位上限
  builtGfa: number; // 已建成建筑面积（㎡）
}

export function tileSummary(state: SimState): TileSummary {
  const tiles = state.city.tiles;
  let v = 0;
  let p = 0;
  let a = 0;
  let tr = 0;
  let built = 0;
  let resTiles = 0;
  let popCap = 0;
  let resPop = 0;
  let jobCap = 0;
  let builtGfa = 0;
  let planPopCap = 0;
  for (const t of tiles) {
    if (t.type === 'residential') planPopCap += popCapOf(t);
    if (!t.developed) continue;
    built++;
    v += t.landValue;
    p += t.pollution;
    a += t.amenity;
    tr += t.transit;
    builtGfa += gfaCapOf(t);
    if (t.type === 'residential') {
      resTiles++;
      popCap += popCapOf(t);
      resPop += t.pop;
    }
    jobCap += jobCapOf(t);
  }
  return {
    avgLandValue: built ? v / built : 0,
    avgPollution: built ? p / built : 0,
    avgAmenity: built ? a / built : 0,
    avgTransit: built ? tr / built : 0,
    builtTiles: built,
    totalTiles: tiles.length,
    resTiles,
    popCap,
    resPop,
    occupancy: popCap > 0 ? resPop / popCap : 0,
    planPopCap,
    jobCap,
    builtGfa,
  };
}

// 地块用途中文名（图例与详情面板共用）
export const TILE_LABELS: Record<string, string> = {
  empty: '非建设用地',
  residential: '居住用地',
  commercial: '商业服务业用地',
  industrial: '工业用地',
  road: '道路与交通设施用地',
  power: '供电设施用地',
  water: '供水设施用地',
  school: '中小学用地',
  hospital: '医疗卫生用地',
  park: '公园绿地',
};

// 兜底：旧存档或异常数据缺字段时补齐，避免渲染阶段炸掉
export function ensureTileFields(city: City): void {
  for (const t of city.tiles) {
    if (typeof t.developed !== 'boolean') t.developed = true;
    if (typeof t.density !== 'number') t.density = 0;
    if (typeof t.level !== 'number' || t.level < LEVEL_MIN) t.level = LEVEL_MIN;
    if (typeof t.planLevel !== 'number' || t.planLevel < LEVEL_MIN) {
      t.planLevel = Math.max(t.level, LEVEL_MIN);
    }
    if (typeof t.landValue !== 'number') t.landValue = CONFIG.LAND_VALUE_FALLBACK;
    if (typeof t.pollution !== 'number') t.pollution = 0;
    if (typeof t.amenity !== 'number') t.amenity = 0;
    if (typeof t.utility !== 'number') t.utility = 0;
    if (typeof t.transit !== 'number') t.transit = 0;
    if (typeof t.congestion !== 'number') t.congestion = 0;
    if (typeof t.roadClass !== 'number') t.roadClass = t.type === 'road' ? 1 : 0;
    if (typeof t.pop !== 'number') t.pop = t.hhCount * 2.6;
    if (typeof t.jobs !== 'number') t.jobs = 0;
    if (t.firmId === undefined) t.firmId = null;
    if (typeof t.hhCount !== 'number') t.hhCount = 0;
  }
  if (typeof city.originX !== 'number') city.originX = Math.floor((city.width - 1) / 2);
  if (typeof city.originY !== 'number') city.originY = Math.floor((city.height - 1) / 2);
}
