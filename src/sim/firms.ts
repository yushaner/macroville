// 企业主体步进：生产 → 市场出清 → 定价 → 工资/税收/利润 → 亏损裁员。

import { CONFIG } from './config';
import { jobCapOf } from './land';
import { hhScaleOf } from './scale';
import type { Firm, Household, SimState } from './types';

function hhMap(state: SimState): Map<number, Household> {
  const m = new Map<number, Household>();
  for (const h of state.households) m.set(h.id, h);
  return m;
}

// ——— 一块地上能摆多少张办公桌 ———
// 企业的用工上限不再是一个凭空的常数，而是由它脚下那块地决定：
//   这块地的建筑面积（净用地 × 容积率）÷ 每岗位建筑面积 = 这块地总共能容纳多少岗位。
// 再除以 hhScale 换算回「样本口径」——于是随着样本加密，同一块地能承载的样本岗位也同步变多，
// 就业率不会因为抽样密度的变化而失真。
//
// 一个街区里不会只有一家公司：真实的写字楼和产业园里几十家企业共用一栋楼，
// 所以这块地的岗位指标要在上面的企业之间分摊（谁多占一间办公室，谁就多招几个人）。
// 少了「多家企业共用一地」这条，村落阶段只有四五块商业用地、最多四五家企业，
// 一千五百人里只有两百个岗位，城市一开局就被失业率拖死。
export interface TileJobBudget {
  total: Map<number, number>; // 地块 → 该地块的样本岗位总指标
  firms: Map<number, number>; // 地块 → 该地块上已有几家企业
}

export function tileJobBudget(state: SimState): TileJobBudget {
  const scale = Math.max(0.05, hhScaleOf(state));
  const total = new Map<number, number>();
  const firms = new Map<number, number>();
  for (const f of state.firms) {
    firms.set(f.tile, (firms.get(f.tile) ?? 0) + 1);
    if (total.has(f.tile)) continue;
    const t = state.city.tiles[f.tile];
    total.set(f.tile, t ? jobCapOf(t) / scale : 0);
  }
  return { total, firms };
}

export function maxEmployeesOf(state: SimState, f: Firm, budget?: TileJobBudget): number {
  const t = state.city.tiles[f.tile];
  const base = CONFIG.FIRM_CAPACITY_MAX;
  if (!t) return base;
  const b = budget ?? tileJobBudget(state);
  const landTotal = b.total.get(f.tile) ?? 0;
  const sharers = Math.max(1, b.firms.get(f.tile) ?? 1);
  // 必须取整：岗位数是一个"人头"计数，出现 512.67 这种小数会让
  // 空缺数、招工进度、开工率全部带上一截永远填不满的零头，
  // 表现为「岗位明明在涨，招工却永远差一点」。
  const landCap = Math.floor(landTotal / sharers);
  // 下限 8 人是「沿街底商 / 家庭作坊」这个现实原型给的：
  // 住宅地块自身不产出产业用地指标，但一层临街的铺面天然能养活一个小店。
  // 没有这个下限，早期（商业用地还没出让）所有企业都会被压到 1 人，城市一开局就死。
  return Math.max(8, Math.min(base, landCap));
}

// 退出市场的门槛：连续亏损这么多个月、且已经裁到一个人都不剩，企业就倒闭。
// 这是个体博弈真正"分出胜负"的时刻——玩家拧的税率、工资、补贴会在几个月后
// 变成某几家企业的死亡通知书，而不是一条平滑的平均值曲线。
const BANKRUPT_MONTHS = 8;

export function stepFirms(state: SimState, totalDemand: number, scale = 1): number {
  const gov = state.gov;
  const fp = state.firmParams;
  const hm = hhMap(state);
  let bankruptcies = 0;
  // 本月各地块的岗位指标与分摊企业数：一个街区的工位要由上面的几家企业分
  const budget = tileJobBudget(state);
  // 景气信心：它决定企业是"多备货、多招人"还是"先清库存、先裁人"。
  // 存货意愿随景气同向摆动，才是基钦周期能自我维持的原因——
  // 繁荣时的乐观备货，正是几个月后衰退时不得不甩卖的库存。
  const conf = Math.max(-1, Math.min(1, state.business?.confidence ?? 0));

  // 1) 生产：研发投入与员工技能决定生产率，库存策略决定目标库存与负荷。
  //    历史教训：① 曾试过「按目标库存补货」，库存趋零→全面售罄→涨价自我强化，
  //    跑出 CPI 300+ 的恶性通胀并引发人口崩塌；② 又试过无条件满产，结果库存无限堆积，
  //    售罄率长期趴在 0.2，价格被一路砸到 CPI 57——玩家什么都没做就撞上「通货紧缩」。
  //    现在的做法是「满产 × 库存负荷系数」：库存超过目标就降负荷，且负荷上限为 1
  //    （不允许超产），两个方向的螺旋都被掐掉。
  for (const f of state.firms) {
    const avgSkill = f.employees.length
      ? f.employees.reduce((a, id) => a + (hm.get(id)?.skill ?? 50), 0) / f.employees.length
      : 50;
    const productivity =
      1 + fp.rdInvest * CONFIG.RD_OUTPUT_K + (avgSkill / 100) * CONFIG.SKILL_OUTPUT_K;
    const fullOutput = f.employees.length * CONFIG.LABOR_PER_WORKER * productivity;
    const targetInv = Math.max(
      1,
      fullOutput * (0.6 + fp.inventoryStrategy * 0.8) * (1 + conf * 0.34),
    );
    const load = clamp(1 / (1 + 0.8 * Math.max(0, f.inventory / targetInv - 1)), 0.25, 1);
    f.output = fullOutput * load * (f.powered ? 1 : 0.4);
    f.inventory += f.output;
  }

  let totalInventory = 0;
  for (const f of state.firms) totalInventory += f.inventory;

  // 2) 市场出清 + 定价 + 财务
  for (const f of state.firms) {
    const invBefore = f.inventory;
    const sold = totalInventory > 0 ? Math.min(invBefore, (totalDemand * invBefore) / totalInventory) : 0;
    f.revenue = sold * f.price;
    f.inventory -= sold;
    // 库存折旧：卖不掉的存货会过时、损耗、降价处理（现实中服装、电子、生鲜尤甚）。
    // 没有这一项时，早期一次过度生产会把「卖不掉的货」永久冻结在账上，
    // 之后每月都按「库存/目标库存」压低开工率，产能利用率被永久压在二三成。
    f.inventory *= 1 - CONFIG.INVENTORY_DECAY;

    const wages = f.employees.length * f.wageOffered;
    // 中间投入：原料、零部件、外购服务，按营收的固定比例计（≈30%）
    const materials = f.revenue * CONFIG.MATERIAL_K;
    // 稳岗补贴：滑杆值（0-1）× 每人每月 ¥1,000 的补贴强度——现实中的用工/稳岗返还就是这个量级
    const subsidy = gov.subsidy[f.sector] * CONFIG.SUBSIDY_PER_EMPLOYEE * f.employees.length;
    // 企业所得税按「利润」计征，不是按营收——否则只要开工就亏，企业永远不扩产、城市永远长不大
    const preTax = f.revenue - materials - wages - CONFIG.FIRM_UPKEEP + subsidy;
    // 企业所得税同样只对「这家企业自己的利润」征，不能乘 scale。
    // 乘了 scale 之后，税率 20% 时只要 scale > 5，税额就超过全部利润 ——
    // 全城企业从此必然亏损、连续裁员、永不扩产，城市在万人规模上就彻底熄火。
    // scale 只用在「这一家样本企业代表多少家真实企业」的国库入账上。
    const corpTax = Math.max(0, preTax) * gov.taxRate;
    f.profit = preTax - corpTax;
    gov.treasury += corpTax * scale;

    // 定价：供不应求（售罄率高）→ 涨价，滞销 → 降价，再向「加价率锚」轻微回归。
    // 注意符号：原式写成 (0.7 - soldRatio)，导致越抢手越降价，企业长期亏损、永远不扩产。
    // 没有产出也没有库存的「空壳企业」不参与调价——它们没有市场信号可供反应。
    if (invBefore > 0 || f.employees.length > 0) {
      // 售罄率必须相对「本月产出」而不是「累计库存」：库存策略本就会留 1 个月左右的存货，
      // 拿累计库存当分母会让产销平衡看起来像滞销（0.5），于是价格被长期压在锚下方，
      // 玩家什么都没做就掉进通缩。产销平衡（产出正好卖完）时信号应为中性。
      const soldRatio = f.output > 0 ? sold / f.output : invBefore > 0 ? sold / invBefore : 1;
      // 定价锚 = 基准成本 ×（1+加价率）× 最低工资带来的成本压力。
      // 锚回归系数必须够强（0.12）：早期只有 0.03，而满产策略长期供过于求，
      // 售罄率信号把价格一路压到 CPI 57——玩家什么都没做就撞上「通货紧缩」，
      // 概念解锁也被这种单边螺旋带偏。
      const wageK = Math.pow(
        Math.max(0.25, state.gov.minWage / CONFIG.DEFAULT_MIN_WAGE),
        0.35,
      );
      const anchor = CONFIG.BASE_PRICE * (1 + fp.markup) * wageK;
      const signal = clamp(soldRatio, 0, 1.3);
      const factor = 1 + CONFIG.PRICE_ADJ_K * (signal - 1) + 0.18 * (anchor / f.price - 1);
      f.price = clampPrice(f.price * factor);
    }

    // 产能利用率：人手越紧张，企业越愿意加价抢人、加快扩产
    const util = f.employees.length / Math.max(1, f.capacity);

    // 2.5) 工资竞争：招不到人时才加价，且不许加到「必然亏损」的价位。
    //      原实现只要盈利就每月 ×1.01 且没有上界，240 个月后工资被顶到天花板，
    //      全城企业集体变成亏损户——这是城市「越长越衰」的隐性原因。
    if (f.employees.length > 0) {
      const revPerEmp = f.revenue / f.employees.length;
      // 可承受工资上限：人均营收的 62%（余下覆盖料件、折旧与利润）
      // 可承受工资上限：人均增加值（营收扣掉中间投入）的 70%，余下覆盖固定开销与利润
      const affordCap = Math.max(state.gov.minWage, revPerEmp * (1 - CONFIG.MATERIAL_K) * 0.7);
      // 名义工资向下黏性：最多比「工资出价政策对应的水平」低 20%。
      // 现实中降薪会遇到合同、惯例与招聘竞争力的抵抗；模型里它同时是防死亡螺旋的闸门——
      // 一旦允许工资无限下探，一次需求冲击就会走成「降薪→消费降→需求降→更亏损」的螺旋。
      const wageFloor = Math.max(state.gov.minWage, CONFIG.BASE_WAGE * fp.wageMultiplier * 0.8);
      const tightLabor = state.households.length > 0
        ? state.households.filter((h) => !h.employed).length / state.households.length < 0.05
        : false;
      if (f.profit > 0 && util > 0.9 && tightLabor && affordCap > f.wageOffered) {
        // 招不到人时才加价，且不超过"人均增加值 70%"的承受上限
        // （上限低于当前工资时不能再"加价"，否则就成了变相降薪）
        f.wageOffered = Math.min(affordCap, f.wageOffered * 1.01);
      } else if (f.profit < 0) {
        // 亏钱才降薪，每月最多 1%，且不低于「工资黏性下限」
        f.wageOffered = Math.max(wageFloor, Math.min(f.wageOffered * 0.99, affordCap));
      }
      // 其余情况「按兵不动」：工资向下是黏的。
      // 早先无论盈亏都把工资压到「人均营收的 62%」，一旦开工率下滑就会触发
      // 降薪 → 消费下降 → 需求下降 → 开工率更低 的死亡螺旋，最后工资一路掉到最低工资线。
    }

    // 3) 扩产：盈利、接近满员、且库存不过剩时才扩张。
    //    少了「库存不过剩」这一条，企业会一路招人扩产能，而需求根本吃不下——
    //    结果岗位数远超订单，开工率长期趴在五成，库存堆到 4 个月产量。
    const stockMonths = f.output > 0 ? f.inventory / f.output : 99;
    // 用地上限：哪怕赚再多，也只能在这块地上安排这么多工位
    const ceiling = maxEmployeesOf(state, f, budget);
    if (f.capacity !== ceiling && f.capacity > ceiling) f.capacity = ceiling;
    if (f.profit > 0 && f.capacity < ceiling && stockMonths < 1.3 && util > 0.5) {
      // 扩产意愿随景气放大：同样是盈利，繁荣时敢押注扩产，衰退时只做维护性补员。
      // util > 0.5 是「还在开工就继续投」的现实门槛：
      // 卡得太严（比如 0.75）会让企业永远等不到满员、岗位不再增长，
      // 城市也就失去了唯一的人口拉力 —— 人会一直往外走，城市永远长不大。
      const urgency = (util > 0.8 ? 1 + (util - 0.8) * 5 : 0.35) * (1 + conf * 0.6);
      f.capacity = Math.min(
        ceiling,
        f.capacity + fp.expansion * CONFIG.CAPACITY_GROWTH_K * urgency,
      );
    }

    // 4a) 用地指标被压缩时（比如这块工业用地改成了公园），超编的人必须依法裁掉。
    //     少了这一步，企业的 capacity 会被新的用地口径压到 8，已有员工却还挂在账上，
    //     于是「在岗人数 > 岗位数」、空缺恒为 0、人口拉力永远为负 —— 城市开局就开始萎缩。
    while (f.employees.length > f.capacity) {
      const id = f.employees.pop()!;
      const hh = hm.get(id);
      if (hh) {
        hh.employed = false;
        hh.employerId = null;
        hh.wage = 0;
      }
    }

    // 4) 亏损渐进裁员：连续亏两个月才动手，且每月 ≤6%。
    //    原实现是「一亏就裁一成」，碰上一次普通的存货周期就让全城企业集体砍掉一成员工，
    //    失业率在每个衰退月跳到 15%，人口被自己的失业率推着往外走 —— 城市永远长不大。
    if (f.profit < 0 && f.lossMonths >= 2 && f.employees.length > 0) {
      const fire = Math.max(1, Math.ceil(f.employees.length * 0.06));
      for (let i = 0; i < fire && f.employees.length > 0; i++) {
        const id = f.employees.pop()!;
        const hh = hm.get(id);
        if (hh) {
          hh.employed = false;
          hh.employerId = null;
          hh.wage = 0;
        }
      }
    } else if (f.profit < 0 && f.employees.length === 0 && f.capacity > 1) {
      // 长期招不到人的空壳企业会缩表：从大厂变成小店铺，至少还能重新被填满
      f.capacity = Math.max(1, f.capacity * 0.9);
    }

    // 5) 退出市场：连续亏损且已无人可裁 → 倒闭。
    //    倒闭后腾出的地块会被后续阶段的新企业重新占用（见 engine.growFirms）。
    if (typeof f.lossMonths !== 'number') f.lossMonths = 0;
    if (f.profit < 0) f.lossMonths += 1;
    else f.lossMonths = 0;
    if (f.lossMonths >= BANKRUPT_MONTHS && f.employees.length === 0) {
      const t = state.city.tiles[f.tile];
      if (t && t.firmId === f.id) t.firmId = null;
      f.capacity = 0; // 标记为待清理
      bankruptcies++;
    }
  }

  if (bankruptcies > 0) {
    state.firms = state.firms.filter((f) => f.capacity > 0);
  }
  return bankruptcies;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampPrice(p: number): number {
  const lo = CONFIG.PRICE_MIN * CONFIG.BASE_PRICE;
  const hi = CONFIG.PRICE_MAX * CONFIG.BASE_PRICE;
  return Math.max(lo, Math.min(hi, p));
}
