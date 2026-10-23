// 单位口径表：所有数值到底"是什么单位"，集中在这里定义一次。
//
// 之前模型里所有数字都是无量纲的抽象单位——可支配收入 9.6、地价 88、人口的口径也不统一，
// 玩家（甚至开发者）看不出一个数字是大是小。现在全局统一到现实量纲：
//   · 钱：元（¥）。个人或企业级的数写全称，城市级的按 万 / 亿 缩写；
//   · 时间：月（一次 tick = 一个月）；
//   · 人：常住人口（人）。每个家庭方块 = 1 户，按户均 2.6 人折算；
//   · 物：件（标准品），基准出厂价 ¥100/件，含默认 30% 加价后约 ¥130/件；
//   · 土地：元/㎡（楼面地价）；
//   · 指数：点（CPI 基期 100）；
//   · 比率：%。
// 标定后的月度量级大致对齐真实中国的中小城市：税前月薪 ¥10,000、户均储蓄 ¥8 万上下、
// 每户每月开销 ¥8,000、20 人企业月营收 ¥26 万、楼面地价 ¥1,000~4,000/㎡。

// ── 折率 ──
export const HOUSEHOLD_SIZE = 2.6; // 户均人口：1 个家庭方块 = 1 户 = 2.6 人（中国 2023 年户均 2.62 人）

// ── 金额 ──
// 城市级合计用缩写，个人/企业级用全称：¥83,200 比 ¥8.3万 更直观。
export function yuan(v: number): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e8) return `${sign}¥${(a / 1e8).toFixed(2)}亿`;
  if (a >= 1e4) return `${sign}¥${(a / 1e4).toFixed(a >= 1e6 ? 0 : 1)}万`;
  return `${sign}¥${Math.round(a).toLocaleString('zh-CN')}`;
}

// 非负数 + 明确月份 ¥6,240/月 → 用于「每月发生额」
export function yuanMonthly(v: number): string {
  return `${yuan(v)}/月`;
}

// ── 其它量纲 ──
export function people(v: number): string {
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2)} 万人`;
  return `${Math.round(v).toLocaleString('zh-CN')} 人`;
}

export function households(v: number): string {
  return `${Math.round(v).toLocaleString('zh-CN')} 户`;
}

export function landPrice(v: number): string {
  return `¥${Math.round(v).toLocaleString('zh-CN')}/㎡`;
}

export function qty(v: number): string {
  return `${Math.round(v).toLocaleString('zh-CN')} 件`;
}

export function months(v: number): string {
  return `${v.toFixed(1)} 个月`;
}

export function points(v: number): string {
  return `${v.toFixed(1)} 点`;
}

// ── 单位口径说明（弹窗内容用） ──
export interface UnitRow {
  group: string;
  name: string;
  unit: string;
  desc: string; // 本作怎么算的
  real: string; // 现实里的量级参照
}

export const UNIT_ROWS: UnitRow[] = [
  {
    group: '家庭账本',
    name: '工资 / 可支配收入',
    unit: '元/月',
    desc: '就业者的税前月薪；扣除税率后为户均可支配收入。',
    real: '2024 年城镇非私营单位就业人员平均工资约 ¥10,342/月；扣除社保个税后到手约七至八成。',
  },
  {
    group: '家庭账本',
    name: '家庭储蓄 / 财富',
    unit: '元',
    desc: '一个家庭方块累计的存款余额，稳态通常在 ¥8 万上下。',
    real: '中国住户户均存款约 ¥20~30 万（中位数低得多，约 ¥8~12 万），取决于是否被高净值户拉高。',
  },
  {
    group: '家庭账本',
    name: '抗风险缓冲',
    unit: '月',
    desc: '储蓄 ÷ 月开销 = 失业后还能撑几个月。',
    real: '国际经验认为 3~6 个月支出是安全垫，低于 2 个月属于脆弱家庭。',
  },
  {
    group: '企业经营',
    name: '平均售价',
    unit: '元/件',
    desc: '标准品的单价，由基准价 ¥100 加价得来，随产销率上下浮动。',
    real: '本作的「件」是一篮子标准商品，价格口径接近一箱/一批消费品或零组件的单价。',
  },
  {
    group: '企业经营',
    name: '产出 / 库存',
    unit: '件/月',
    desc: '每人每月产出 100 件（技能与研发再加成），超出销量的部分进库存。',
    real: '按人月产值 ¥13,000 折算，相当于每位就业者年创产值约 ¥15.6 万。',
  },
  {
    group: '企业经营',
    name: '总营收 / GDP',
    unit: '元/月',
    desc: '全城企业当月销售额合计，也就是这座城市当月的产出规模。',
    real: '2024 年中国人均 GDP 约 ¥98,749/年（折 ¥8,229/月）；本作按 1 户 2.6 人折算后略低于全国均值，相当于中小城市水平。',
  },
  {
    group: '政府财政',
    name: '财政余额',
    unit: '元',
    desc: '累计税收（个税 + 企业所得税）减去各项支出的结余，可为负。',
    real: '地方政府性基金与一般公共预算合计体量远大于本模型，这里只保留收支结余的方向感。',
  },
  {
    group: '政府财政',
    name: '最低工资',
    unit: '元/月',
    desc: '企业用工的月薪底线，默认为 ¥2,500。',
    real: '中国各地月最低工资约 ¥1,800~2,690（上海最高），通常为当地社平工资的 20%~35%。',
  },
  {
    group: '土地与城市',
    name: '地价',
    unit: '元/㎡',
    desc: '区位、临路、密度、公共服务与污染共同决定的楼面地价。',
    real: '三四线线城市住宅楼面价约 ¥1,000~4,000/㎡，核心地段商业可达 ¥1 万以上。',
  },
  {
    group: '土地与城市',
    name: '人口',
    unit: '人',
    desc: '每个家庭方块 = 1 户，按户均 2.6 人折算为常住人口。',
    real: '中国 2023 年户均人口 2.62 人。',
  },
  {
    group: '价格与周期',
    name: 'CPI',
    unit: '点（基期 100）',
    desc: '平均售价相对基期的定基指数。',
    real: '现实中国家统计局 CPI 以上年同月=100 发布，这里改用定基指数便于跨月比较。',
  },
  {
    group: '价格与周期',
    name: '产出缺口',
    unit: '%',
    desc: '（实际产出 − 潜在产出）/ 潜在产出，正为过热、负为资源闲置。',
    real: '现实中多数年份在 ±3% 内波动，衰退期可到 −5% 以下。',
  },
];

// 单位说明弹窗的正文：用量级对照让玩家自己判断"这个数算大还是小"
export function unitHelpHtml(): string {
  const groups: Record<string, UnitRow[]> = {};
  for (const r of UNIT_ROWS) (groups[r.group] ??= []).push(r);
  const body = Object.entries(groups)
    .map(([g, rows]) => {
      const items = rows
        .map(
          (r) => `<tr>
            <td><b>${r.name}</b></td>
            <td class="u">${r.unit}</td>
            <td>${r.desc}<br><span class="muted">现实参照：${r.real}</span></td>
          </tr>`,
        )
        .join('');
      return `<h4>${g}</h4><table class="unit-table">${items}</table>`;
    })
    .join('');
  return `
    <div class="chapter">阅读须知</div>
    <p>本作所有数字都按<b>现实口径</b>标定：钱是<b>元</b>，时间是<b>月</b>，人是<b>常住人口</b>，
      东西按<b>件</b>计，土地按<b>元/㎡</b>。下表列出每个量的算法与它在真实世界里的量级，
      用来判断"这个数是大还是小"。</p>
    ${body}
    <p class="muted">缩写规则：¥1.2万 = ¥12,000；¥3.4亿 = ¥340,000,000。城市级合计用缩写，家庭/企业级写全称。</p>
  `;
}
