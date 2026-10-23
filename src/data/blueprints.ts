// 开局蓝图：玩家在开局设定的初始条件。
//
// 设计意图：玩法不该是「挂机等解锁」，而是「你设定一套初始参数 → 个体（家庭/企业/地块）
// 之间自己博弈 → 跑出别人跑不出的结果」。不同蓝图不仅改初始旋钮，还改初始人口与
// 地块构成（工业/商业占比），于是哪怕同一个随机种子，长出来的城市也不一样。

import type { BlueprintId, FirmParams, Government, HouseholdParams } from '../sim/types';

export interface BlueprintDef {
  id: BlueprintId;
  name: string;
  icon: string;
  tagline: string; // 一句话定位
  desc: string; // 这份蓝图是什么
  hint: string; // 它通常会跑出什么故事
  pop: number; // 初始家庭数
  industryBias: number; // 0-1：工业地块倾向（越高工业带越宽）
  commercialBias: number; // 0-1：商业地块倾向
  gov: Partial<Government>;
  household: Partial<HouseholdParams>;
  firm: Partial<FirmParams>;
}

export const BLUEPRINTS: BlueprintDef[] = [
  {
    id: 'rural',
    name: '农耕村落',
    icon: '🌾',
    tagline: '人少、钱紧、靠天吃饭',
    desc: '几百人的小聚落，主街两侧只有几间铺子。储蓄习惯保守，政府几乎不干预。',
    hint: '增长很慢，但一旦站稳，家庭财富与抗风险能力会先于规模长起来。',
    pop: 380,
    industryBias: 0.15,
    commercialBias: 0.25,
    gov: { taxRate: 0.14, publicSpend: 0.22, minWage: 2000 },
    household: { savingsRate: 0.34, consumptionPropensity: 0.85, laborParticipation: 0.82, skillInvest: 0.1, riskAppetite: 0.3 },
    firm: { markup: 0.22, wageMultiplier: 1.0, expansion: 0.2, rdInvest: 0.08, inventoryStrategy: 0.5 },
  },
  {
    id: 'marketTown',
    name: '集市重镇',
    icon: '🛍',
    tagline: '商贸起家，人流就是现金流',
    desc: '处在商路上的老镇。商铺密度高，居民爱消费，地方政府靠流转税吃饭。',
    hint: '商业繁荣、物价敏感，需求端一有波动立刻传导到企业定价与就业。',
    pop: 620,
    industryBias: 0.25,
    commercialBias: 0.72,
    gov: { taxRate: 0.18, publicSpend: 0.3, minWage: 2500, tradeOpenness: 0.25 },
    household: { savingsRate: 0.16, consumptionPropensity: 1.2, laborParticipation: 0.92, skillInvest: 0.2, riskAppetite: 0.65 },
    firm: { markup: 0.34, wageMultiplier: 1.25, expansion: 0.4, rdInvest: 0.15, inventoryStrategy: 0.35 },
  },
  {
    id: 'factory',
    name: '工业新城',
    icon: '🏭',
    tagline: '先污染，后治理',
    desc: '一片被规划成厂区的土地。政府用补贴换岗位，工人多、公共服务少。',
    hint: '岗位充足、人口冲得快，但污染与低工资会先把满意度压下去——典型的增长代价。',
    pop: 700,
    industryBias: 0.85,
    commercialBias: 0.3,
    gov: { taxRate: 0.22, publicSpend: 0.18, minWage: 2300, industrySubsidy: 0.3 },
    household: { savingsRate: 0.14, consumptionPropensity: 1.05, laborParticipation: 0.98, skillInvest: 0.12, riskAppetite: 0.5 },
    firm: { markup: 0.26, wageMultiplier: 1.125, expansion: 0.55, rdInvest: 0.1, inventoryStrategy: 0.55 },
  },
  {
    id: 'port',
    name: '贸易港口',
    icon: '⚓',
    tagline: '外面的世界决定了这里的物价',
    desc: '面向外部市场的港城。贸易开放度起点就高，本地产业要跟外面抢订单。',
    hint: '需求被外部放大，也更容易被外部冲击；价格与就业的波动幅度明显更大。',
    pop: 660,
    industryBias: 0.45,
    commercialBias: 0.6,
    gov: { taxRate: 0.16, publicSpend: 0.26, minWage: 2690, tradeOpenness: 0.55 },
    household: { savingsRate: 0.18, consumptionPropensity: 1.15, laborParticipation: 0.9, skillInvest: 0.22, riskAppetite: 0.7 },
    firm: { markup: 0.3, wageMultiplier: 1.375, expansion: 0.45, rdInvest: 0.2, inventoryStrategy: 0.3 },
  },
  {
    id: 'campus',
    name: '科教新城',
    icon: '🎓',
    tagline: '把钱花在人身上',
    desc: '大学与研究所先来，产业后到。公共支出与研发补贴开局就不低。',
    hint: '短期利润被摊薄、增长偏慢，但技能与生产率会滚雪球，后期工资结构明显更好。',
    pop: 520,
    industryBias: 0.2,
    commercialBias: 0.45,
    gov: { taxRate: 0.24, publicSpend: 0.48, minWage: 2600, eduSubsidy: 0.4 },
    household: { savingsRate: 0.22, consumptionPropensity: 0.95, laborParticipation: 0.86, skillInvest: 0.55, riskAppetite: 0.4 },
    firm: { markup: 0.32, wageMultiplier: 1.5, expansion: 0.3, rdInvest: 0.5, inventoryStrategy: 0.45 },
  },
  {
    id: 'greenfield',
    name: '自由实验',
    icon: '🧪',
    tagline: '全部交给随机数',
    desc: '不预设任何倾向：初始参数在一组合理区间里随机抽取，地块构成由种子决定。',
    hint: '每一局都是新题。适合已经摸清机制、想看看极端组合会跑出什么的玩家。',
    pop: 600,
    industryBias: 0.5,
    commercialBias: 0.5,
    gov: {},
    household: {},
    firm: {},
  },
];

export function blueprintById(id: BlueprintId): BlueprintDef {
  return BLUEPRINTS.find((b) => b.id === id) ?? BLUEPRINTS[1];
}

export const DEFAULT_BLUEPRINT: BlueprintId = 'marketTown';

// 「自由实验」蓝图用种子随机出一套自洽的初始参数
export function rollGreenfield(seed: number): {
  gov: Partial<Government>;
  household: Partial<HouseholdParams>;
  firm: Partial<FirmParams>;
  industryBias: number;
  commercialBias: number;
} {
  // 简单的确定性伪随机（不引 RNG，避免循环依赖）
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const pick = (lo: number, hi: number) => lo + rnd() * (hi - lo);
  return {
    gov: {
      taxRate: pick(0.1, 0.34),
      minWage: Math.round(pick(1800, 3000) / 10) * 10,
      publicSpend: pick(0.15, 0.5),
      industrySubsidy: pick(0, 0.35),
      eduSubsidy: pick(0, 0.45),
      tradeOpenness: pick(0, 0.6),
      welfare: pick(0, 0.4),
    },
    household: {
      savingsRate: pick(0.1, 0.4),
      consumptionPropensity: pick(0.8, 1.3),
      laborParticipation: pick(0.75, 1),
      skillInvest: pick(0.05, 0.6),
      riskAppetite: pick(0.2, 0.8),
    },
    firm: {
      markup: pick(0.18, 0.45),
      wageMultiplier: pick(0.9, 1.6),
      expansion: pick(0.15, 0.6),
      rdInvest: pick(0.05, 0.55),
      inventoryStrategy: pick(0.2, 0.7),
    },
    industryBias: pick(0.15, 0.85),
    commercialBias: pick(0.25, 0.8),
  };
}
