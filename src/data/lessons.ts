// 知识系统：概念卡定义（结构化模板）。
// 触发条件 check() 由助手搭好；definition / example / experiment / advanced 为样板文案，
// 由玉山儿（备考中）以标准经济学大纲 + 本局实例校准/替换。
// unlockHint（解锁条件）、affectedBy（会受什么影响）、affects（又会影响什么）为本次新增。

import { CONFIG } from '../sim/config';
import type { SimState } from '../sim/types';

export type Chapter = 'micro' | 'industrial' | 'macro';

export interface LessonDef {
  id: string;
  title: string;
  chapter: Chapter;
  /** 触发条件：返回 true 即首次解锁该概念卡 */
  check: (s: SimState) => boolean;
  /** 以下字段为样板文案，待校准 */
  definition?: string;
  example?: string; // 本局实例（引用当前指标/事件）
  experiment?: string; // 玩家可做的对照实验
  advanced?: string; // 进阶：官方定义/公式/延伸阅读
  unlockHint?: string; // 未解锁时显示的解锁条件
  affectedBy?: string; // 该概念会受哪些杠杆/指标影响
  affects?: string; // 该概念又会影响哪些指标/主体
}

const employedCount = (s: SimState) => s.households.filter((h) => h.employed).length;
const unemployedCount = (s: SimState) => s.households.filter((h) => !h.employed).length;
const meanEmployees = (s: SimState) =>
  s.firms.length ? s.firms.reduce((a, f) => a + f.employees.length, 0) / s.firms.length : 0;

export const LESSONS: LessonDef[] = [
  // —— 微观经济学 ——
  {
    id: 'micro-supply-demand',
    title: '供需定律',
    chapter: 'micro',
    check: (s) => s.month > 2 && s.firms.some((f) => Math.abs(f.price - CONFIG.BASE_PRICE) > 0.5),
    definition:
      '价格由供给与需求共同决定：需求大于供给时价格上升、出现短缺；供给大于需求时价格下降、出现过剩。市场通过价格涨跌自发调节供需，达到均衡。',
    example:
      '观察右侧某企业的「售罄率」与「库存」。当某类企业连续数月库存积压（库存↑、售罄率↓），仿真会自动下调其 price；反之若居民需求旺盛、库存清空，price 被推高。这就是「看不见的手」在定价。',
    experiment:
      '把「最低工资」滑杆调高 20%，看企业用工成本上升后是否转嫁为更高产出价格（成本推动型涨价）；再把「产业补贴」拉满，看供给扩张后价格如何回落。',
    advanced:
      '需求定律：价格↑ → 需求量↓；供给定律：价格↑ → 供给量↑。均衡价格 = 需求量 Qd 与供给量 Qs 相等时的价格，即 Qd(P*) = Qs(P*)。需求/供给曲线任一移动都会改变均衡点。',
    unlockHint: '当某类商品价格偏离基准价 0.5 以上时解锁（通常第 3 个月后出现）。',
    affectedBy: '受最低工资（成本端）与产业补贴（供给端）影响：成本上升推价，补贴增加压价。',
    affects: '价格信号反过来调节企业产量与居民购买量，是市场出清的核心机制。',
  },
  {
    id: 'micro-opportunity-cost',
    title: '机会成本',
    chapter: 'micro',
    check: () => true, // 游戏一开始即有「工作 vs 闲暇」的取舍，立即解锁
    definition:
      '做出某一选择所放弃的、价值最高的替代选项。资源有限，有得必有舍。真正衡量一项决策的代价，是次优选择带来的收益。',
    example:
      '本局每个居民家庭每天都在「工作赚取工资」与「闲暇/家务」之间取舍。当税率过高，税后工资下降，工作的机会成本（放弃的闲暇）变高，部分居民会选择不就业——你在宏观面会看到失业率上升。',
    experiment:
      '对比「高税率 vs 低税率」两种玩法下同一城市的就业率：低税率下居民更愿意工作（机会成本低），就业率通常更高。',
    advanced:
      '机会成本 ≠ 会计成本（后者只看账面支出）。理性决策原则：当且仅当某行动的边际收益 ≥ 其机会成本时才值得去做。沉没成本（已发生、不可收回）不应纳入决策。',
    unlockHint: '开局即解锁——游戏一开始就有「工作 vs 闲暇」的取舍。',
    affectedBy: '受税率影响：税率越高，税后工资越低，工作的机会成本上升，更多人选择不就业。',
    affects: '决定劳动力供给规模，进而影响企业招工难度、工资水平与整体产出。',
  },
  {
    id: 'micro-unemployment',
    title: '失业',
    chapter: 'micro',
    check: (s) => unemployedCount(s) > 0,
    definition:
      '有劳动能力且愿意工作的人找不到工作的状态。分三类：摩擦性（换工作间隙）、结构性（技能与岗位不匹配）、周期性（总需求不足导致企业裁员）。',
    example:
      '看顶部「失业率」指标。本局开局若企业数量少、岗位不足，会出现失业者。若失业率持续走高，往往是企业利润被高工资/高税挤压、停止招工所致（周期性失业）。',
    experiment:
      '用「产业补贴」刺激企业扩招，或直接降低「最低工资」减轻企业负担，观察接下来 1–2 年失业率是否回落。',
    advanced:
      '自然失业率 = 摩擦性 + 结构性失业（经济健康时也存在的底线）；周期性失业随经济周期波动，是政策主要调控对象。奥肯定律：实际 GDP 低于潜在 GDP 时，失业率高于自然率，且缺口越大失业越多。',
    unlockHint: '当出现失业居民（失业率 > 0）时解锁。',
    affectedBy: '受最低工资、产业补贴、总需求影响：高最低工资与低需求推高失业，补贴与开放度降低失业。',
    affects: '失业抬高社会负担、拉低幸福度与消费，形成需求不足的恶性循环。',
  },

  // —— 产业 / 中观经济学 ——
  {
    id: 'industrial-agglomeration',
    title: '集聚效应',
    chapter: 'industrial',
    check: (s) => meanEmployees(s) > 5,
    definition:
      '同类或相关产业在空间上集中，带来共享基础设施、劳动力池与知识溢出，从而降低平均成本、提升生产效率。',
    example:
      '本局当某区域企业平均雇员规模突破 5，说明产业开始集聚。你会发现单位产出所需的工资/基建成本相对下降，城市 GDP 增速加快。',
    experiment:
      '集中对某一产业发放补贴，引导企业扎堆建在同一片区，对比分散布局时的总产出与幸福度。',
    advanced:
      '源自马歇尔（Marshall）外部经济理论，现代表现为产业集群（如硅谷、长三角制造带）。注意：集聚过度也会产生拥堵、地价上涨等负外部性，存在最优规模。',
    unlockHint: '当平均企业雇员规模 > 5（产业开始集聚）时解锁。',
    affectedBy: '受产业补贴与公共支出影响：补贴引导企业扎堆，基建完善强化集聚。',
    affects: '集聚降低平均成本、提升全要素生产率，加速 GDP 增长，但过度集聚产生负外部性。',
  },
  {
    id: 'industrial-externality',
    title: '外部性',
    chapter: 'industrial',
    check: (s) => s.indicators.happiness < 50,
    definition:
      '一个经济主体的行为对旁观者产生未补偿的影响。正外部性（教育、绿地）惠及他人；负外部性（污染、拥堵）损害他人，二者都会导致市场失灵。',
    example:
      '本局当幸福度（happiness）跌破 50，往往源于产业密集带来的拥堵/污染等负外部性——企业获利但居民买单，GDP 涨了幸福却跌了。',
    experiment:
      '在幸福度走低时，提高「公共服务支出」或「福利支出」补贴绿化与基建，看能否抵消负外部性、把幸福度拉回 50 以上。',
    advanced:
      '外部性导致市场失灵，需政府干预：对负外部性征税（庇古税 Pigouvian tax），对正外部性补贴。延伸阅读：科斯定理——只要产权界定清晰、交易成本为零，当事人可谈判将外部性内部化。',
    unlockHint: '当幸福度 < 50（产业密集的负外部性显现）时解锁。',
    affectedBy: '受产业规模与公共/福利支出影响：产业越密负外部性越强，公共与福利支出可抵消。',
    affects: '负外部性拉低幸福度、触发人口迁出；正外部性（教育/绿地）惠及长期增长。',
  },

  // —— 宏观经济学 ——
  {
    id: 'macro-gdp',
    title: 'GDP（国内生产总值）',
    chapter: 'macro',
    check: (s) => s.month > 1,
    definition:
      '一国/一城在一定时期内生产的全部最终产品和服务的市场价值。支出法构成：GDP = 消费 C + 投资 I + 政府支出 G + 净出口 NX。',
    example:
      '本局 GDP 由居民总消费（雇员工资 × 消费倾向）、企业投资（新增产能）、政府支出（公共基建/补贴）加总。开局第 2 个月即可在仪表盘看到 GDP 曲线。',
    experiment:
      '把「税率」从低档拉到高档，观察政府支出 G 增加，但居民可支配收入与消费 C 下降，GDP 可能先升后降——体会乘数效应与挤出效应。',
    advanced:
      '名义 GDP（按当年价）vs 实际 GDP（剔除物价变动，以基期价格计）。本游戏以基期价格计，近似实际 GDP。GDP 衡量产出规模，但不衡量收入分配公平与居民福祉。',
    unlockHint: '第 2 个月起即可查看 GDP 走势。',
    affectedBy: '受消费、投资、政府支出、净出口共同驱动；税率、补贴、开放度、工资都改变它。',
    affects: 'GDP 增长带来更多就业与财政，是绝大多数政策的最终目标变量。',
  },
  {
    id: 'macro-inflation',
    title: '通货膨胀（CPI）',
    chapter: 'macro',
    check: (s) => s.indicators.cpi > 102,
    definition:
      '经济体物价总水平持续、普遍上涨，货币购买力下降。CPI（居民消费价格指数）是衡量通胀的核心指标，以 100 为基期。CPI > 100 即相对基期涨价。',
    example:
      '当本局 CPI 突破 102（相对基期涨 2%+），说明出现温和通胀。常见成因：产业补贴/公共服务支出过猛 → 需求过热 → 企业提价。',
    experiment:
      '连续多年把「产业补贴」和「公共服务支出」拉满，制造需求过热，观察 CPI 是否被推过 105 甚至更高，并看政府是否应通过提税给经济降温。',
    advanced:
      '通胀三类成因：需求拉动（总需求 > 总供给）、成本推动（工资/原料↑推高成本）、货币超发（过多货币追逐过少商品）。恶性通胀会扭曲价格信号、侵蚀储蓄。',
    unlockHint: '当 CPI > 102（相对基期涨 2% 以上）时解锁。',
    affectedBy: '受需求拉动（补贴/开放度过热）、成本推动（工资上涨）与货币扩张影响。',
    affects: '高通胀侵蚀储蓄与固定收入者购买力，扭曲价格信号，倒逼政府收紧政策。',
  },
  {
    id: 'macro-fiscal',
    title: '财政政策（税收与支出）',
    chapter: 'macro',
    check: (s) => s.month > 1,
    definition:
      '政府通过税收（T）与支出（G）调节总需求，影响就业与物价。扩张性财政：减税 + 增支（刺激经济）；紧缩性财政：增税 + 减支（给经济降温）。',
    example:
      '本局你可拖动「税率」与「公共服务支出 / 产业补贴」滑杆。拉高税率 → 财政盈余↑但居民与企业活力↓；提高公共支出 → 幸福度与基建↑但可能财政赤字。',
    experiment:
      '对比两种剧本——剧本 A「高税低支」、剧本 B「低税高支」，各跑 5 年，比较两城的 GDP、失业率、幸福度与财政余额，体会财政的权衡取舍。',
    advanced:
      '乘数效应：政府支出 1 元可撬动 >1 元的总需求，乘数 k = 1 / (1 − MPC)（MPC 为边际消费倾向）。李嘉图等价定理则认为，理性人预期未来增税会抵消当前减税，长期效果有限。',
    unlockHint: '第 2 个月起即可查看财政运行。',
    affectedBy: '受税率（收入）与各项支出（公共/补贴/福利/研发）共同决定。',
    affects: '财政盈余可投资未来，赤字不可持续会削弱政府调节能力，影响长期稳定。',
  },
];

export function lessonById(id: string): LessonDef | undefined {
  return LESSONS.find((l) => l.id === id);
}
