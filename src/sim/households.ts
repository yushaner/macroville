// 家庭主体步进：劳动力市场匹配 + 消费/税收/储蓄/满意度。

import { CONFIG } from './config';
import { realPopulationOf } from './scale';
import type { Household, SimState } from './types';

// 劳动力市场：把「正在求职」的失业家庭分配到有空缺、工资达标、已通电的企业。
// 求职者优先挑工资出价高的岗位——按 firms 数组顺序找人会让排在前面的企业吃满、
// 后面的企业永远招不到人（此前 170 家企业里有 75 家常年空转）。
export function laborMarket(state: SimState): void {
  const vacancies = state.firms
    .filter((f) => f.powered && f.wageOffered >= state.gov.minWage && f.employees.length < f.capacity)
    .sort((a, b) => b.wageOffered - a.wageOffered);
  if (vacancies.length === 0) return;

  let cursor = 0;
  for (const hh of state.households) {
    if (hh.employed || !hh.seeking) continue;
    // 找到下一个还有空位的企业（跳过已满的）
    while (cursor < vacancies.length && vacancies[cursor].employees.length >= vacancies[cursor].capacity) {
      cursor++;
    }
    if (cursor >= vacancies.length) break;
    const firm = vacancies[cursor];
    hh.employed = true;
    hh.employerId = firm.id;
    hh.wage = firm.wageOffered;
    firm.employees.push(hh.id);
  }
}

// 给一小批「刚搬进来的家庭样本」找工作。
// 新增样本不是凭空多出来的人口，它只是把原本由别人代表的那批具名住户换成自己，
// 所以必须立刻接上原来的岗位，否则每加一批样本就凭空多出一批失业人口。
export function assignJobs(state: SimState, fresh: Household[]): void {
  if (fresh.length === 0) return;
  const gov = state.gov;
  const open = state.firms
    .filter((f) => f.powered && f.wageOffered >= gov.minWage && f.employees.length < f.capacity)
    .sort((a, b) => b.wageOffered - a.wageOffered);
  let cursor = 0;
  for (const hh of fresh) {
    if (!hh.seeking) continue;
    while (cursor < open.length && open[cursor].employees.length >= open[cursor].capacity) cursor++;
    if (cursor >= open.length) break;
    const firm = open[cursor];
    hh.employed = true;
    hh.employerId = firm.id;
    hh.wage = firm.wageOffered;
    firm.employees.push(hh.id);
  }
}

export function stepHouseholds(state: SimState, scale = 1): void {
  const gov = state.gov;
  const hp = state.householdParams;
  // 在职者的工资必须跟着企业的「当前工资出价」走。
  // 早先只在入职那一刻写下 hh.wage，企业后来降薪时老员工收入不变——
  // 于是「工资总额」和「家庭收入」两本账对不上，企业账面利润率被虚推到 40% 以上。
  const offerById = new Map<number, number>();
  for (const f of state.firms) offerById.set(f.id, f.wageOffered);
  // 物价水平：工资要除以它才是真实购买力（通胀会侵蚀满意度）
  const cpiFactor = Math.max(0.2, state.indicators.cpi / 100);
  const unemployedShare =
    state.households.length > 0
      ? state.households.filter((h) => !h.employed).length / state.households.length
      : 0;
  // 拥挤成本：城市越大，通勤与生活成本越高（规模不经济），这也是人口不会无限膨胀的原因。
  // 按真实人口计：百万人口的城市扣满 8 分左右，万人小镇几乎不用扣。
  const congestion = Math.min(10, realPopulationOf(state) / 120_000);
  // 景气信心：繁荣时敢花钱，衰退时先攥紧钱包。它是周期从"企业"传导到"家庭"的通道——
  // 没有这一项，周期只会体现在 GDP 曲线上，居民该花多少还花多少。
  const conf = Math.max(-1, Math.min(1, state.business?.confidence ?? 0));
  const confSpend = 1 + conf * 0.22;
  for (const hh of state.households) {
    // 居住环境：自家地块的公共服务辐射减去污染累积（-1 ~ 1）。
    // 这是地块属性反过来影响经济的通道——工厂围城会真的把人赶走。
    // 公共服务是「有没有」的问题（辐射衰减快，基数小），所以放大后再与污染相抵。
    const home = state.city.tiles[hh.tile];
    const envQuality = home
      ? Math.max(-1, Math.min(1, home.amenity * 2.2 - home.pollution * 1.6))
      : 0;
    if (hh.employed) {
      if (hh.employerId != null) {
        const offer = offerById.get(hh.employerId);
        if (offer !== undefined) hh.wage = offer;
      }
      const wage = hh.wage;
      // 税率是对「这一户自己的收入」征的，不能乘 scale ——
      // scale 是「这个样本代表多少户真实家庭」，它只该用来把国库收支换成真值。
      // 早先写成 wage × taxRate × scale，等于让一个样本家庭替它代表的所有家庭缴税：
      // scale 超过 1/税率（税率 20% 时是 5）时，税额就超过它自己的全部收入，
      // 净收入变成负数，储蓄被抽干、满意度永远压在 55 分上下，人口再也长不动。
      const incomeTax = wage * gov.taxRate;
      gov.treasury += incomeTax * scale;
      const net = wage - incomeTax;
      hh.savings += net;
      // 技能成长：政府研发补贴 + 家庭自身技能投入
      hh.skill = Math.min(100, hh.skill + gov.eduSubsidy * 1.5 + hp.skillInvest * CONFIG.SKILL_GROWTH_K);
      // 消费：保留储蓄率后，按消费倾向与风险偏好决定动用储蓄的比例
      const consProp = hp.consumptionPropensity;
      const riskK = CONFIG.CONS_SAVINGS_K;
      const spend = Math.min(
        hh.savings,
        (net * (1 - hp.savingsRate) * 0.6 + hh.savings * (0.02 + hp.riskAppetite * riskK)) *
          consProp *
          confSpend,
      );
      hh.consumption = Math.max(0, spend);
      hh.savings -= hh.consumption;
      // 满意度 = 税后实际工资的购买力 + 储蓄缓冲 + 公共服务 + 人力资本投入 − 失业焦虑
      // 这是城市人口迁入/迁出的唯一动力源，必须与真实经济状况挂钩，否则城市会卡死不长
      // 实际购买力 = 月薪能买多少「一个人一个月的产出」。
      // 分母必须是「基准价 × 每人月产量」：只除单价会得到一个几百量纲的数，
      // 满意度会被直接顶到 100——这是重标定数量级时最容易踩的坑。
      const purch = net / cpiFactor / (CONFIG.BASE_PRICE * CONFIG.LABOR_PER_WORKER);
      const buffer = Math.min(10, hh.savings / CONFIG.SAT_BUFFER_SCALE); // 抗风险缓冲，最多 +10
      hh.satisfaction = clamp(
        50 +
          purch * 12 +
          buffer +
          gov.publicSpend * 15 +
          gov.eduSubsidy * 6 -
          unemployedShare * 10 -
          congestion +
          envQuality * 12 +
          conf * 5,
      );
    } else {
      const benefit = gov.treasury > 0 ? gov.minWage * CONFIG.UNEMP_BENEFIT_RATIO : 0;
      gov.treasury -= benefit * scale;
      const spend = Math.min(hh.savings, (benefit + gov.welfare * CONFIG.WELFARE_BENEFIT_K) * 0.8);
      hh.consumption = Math.max(0, spend);
      hh.savings -= hh.consumption;
      hh.satisfaction = clamp(30 + gov.publicSpend * 12 + gov.welfare * 15 + envQuality * 10);
    }
  }
}

function clamp(v: number, lo = CONFIG.SATISFACTION_MIN, hi = CONFIG.SATISFACTION_MAX): number {
  return Math.max(lo, Math.min(hi, v));
}
