// 顶部实时变量条：随视角切换显示不同的变量，点击可看详情与累积曲线。
//
// 为什么放在顶部：玩家每个月其实只关心"跟我这个身份有关的几个数"。
// 个人视角看家庭账本、企业视角看经营盘面、政府视角看宏观盘面——同一座城市，
// 站在不同位置关心的数字本来就不一样。

import { showModal } from './modal';
import { emergeStats } from '../sim/requirements';
import { stageById, orientationInfo } from '../sim/stages';
import { yuan } from '../data/units';
import type { Perspective, SimState } from '../sim/types';

type Source =
  | { kind: 'series'; key: string }
  | { kind: 'history'; key: keyof SimState['indicators'] }
  | { kind: 'fn'; fn: (s: SimState) => number };

export interface VarDef {
  key: string;
  label: string;
  icon: string;
  term?: string; // 关联名词（详情弹窗里可跳转）
  src: Source;
  fmt: (v: number) => string;
  desc: string; // 这个数是什么、怎么来的
  warn?: (v: number) => boolean; // 偏离合理区间时标黄
  // 派生量（比如失业率 = 1 - 就业率）没有自己的记录数组，
  // 这里显式给出它的历史序列，否则点开详情画不出累积曲线。
  hist?: (s: SimState) => number[];
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const score = (v: number) => `${v.toFixed(0)} 分`;
const perMonth = (v: number) => `${yuan(v)}/月`;
const perItem = (v: number) => `¥${Math.round(v).toLocaleString('zh-CN')}/件`;

// ── 三套变量：个人看家庭账本，企业看经营盘面，政府看宏观盘面 ──
// 每一项都带明确单位（元/月、元、件、分、%），否则"9.6"这种数字玩家没法判断大小。
const HOUSEHOLD_VARS: VarDef[] = [
  {
    key: 'disposableIncome', label: '户均月收入', icon: '💰', term: 'disposableIncome',
    src: { kind: 'series', key: 'disposableIncome' }, fmt: perMonth,
    desc: '就业家庭税后月薪的平均数（元/月）。它由企业工资出价与政府税率共同决定——你在企业视角涨的工资，会以成本的形式回到这里。现实参照：2024 年全国居民人均可支配收入 ¥3,443/月，折一户 2.6 人约 ¥8,900/月。',
    warn: (v) => v < 4000,
  },
  {
    key: 'livingStandard', label: '生活水平', icon: '🙂', term: 'livingStandard',
    src: { kind: 'series', key: 'livingStandard' }, fmt: score,
    desc: '全体居民满意度的平均（0-100 分）。受实际购买力、储蓄缓冲、公共服务、失业率与拥挤成本共同影响。',
    warn: (v) => v < 55,
  },
  {
    key: 'wealth', label: '家庭财富', icon: '🏦', term: 'wealth',
    src: { kind: 'series', key: 'wealth' }, fmt: yuan,
    desc: '一个家庭的平均储蓄余额（元）。储蓄率与收入的长期结果，也是家庭抵抗失业冲击的底气。现实参照：中国住户户均存款约 ¥20~30 万，中位数约 ¥8~12 万。',
    warn: (v) => v < 60000,
  },
  {
    key: 'resilience', label: '抗风险缓冲', icon: '🛟', term: 'resilience',
    src: { kind: 'series', key: 'resilience' }, fmt: (v) => `${v.toFixed(1)} 个月`,
    desc: '储蓄能支撑多少个月的开销（月）。低于 2 个月意味着一次失业就会击穿家庭账本。',
    warn: (v) => v < 2,
  },
  {
    key: 'poorShare', label: '入不敷出', icon: '📉',
    src: { kind: 'series', key: 'poorShare' }, fmt: pct,
    desc: '储蓄撑不过一个月开销的家庭占比（%）。这是个体博弈跑出来的分化指标——平均值好看不代表没有家庭在挨饿。',
    warn: (v) => v > 0.35,
  },
  {
    key: 'employmentRate', label: '就业率', icon: '🔧', term: 'employmentRate',
    src: { kind: 'history', key: 'employmentRate' }, fmt: pct,
    desc: '有工作的劳动力占比（%）。企业招工与居民求职匹配的结果。',
    warn: (v) => v < 0.85,
  },
];

const FIRM_VARS: VarDef[] = [
  {
    key: 'avgProfit', label: '平均利润', icon: '📊', term: 'avgProfit',
    src: { kind: 'series', key: 'avgProfit' }, fmt: perMonth,
    desc: '全城企业的月均利润（元/月）。售价、工资、税收与补贴一起决定它是正是负。',
    warn: (v) => v < 0,
  },
  {
    key: 'capacityUtil', label: '产能利用率', icon: '⚙️', term: 'capacityUtil',
    src: { kind: 'series', key: 'capacityUtil' }, fmt: pct,
    desc: '已雇人数 / 岗位容量（%）。低于 50% 说明需求不足或招不到人；贴近 100% 说明该扩产了。',
    warn: (v) => v < 0.5 || v > 0.97,
  },
  {
    key: 'avgPrice', label: '平均售价', icon: '🏷', term: 'avgPrice',
    src: { kind: 'series', key: 'avgPrice' }, fmt: perItem,
    desc: '标准品的平均单价（元/件）。由加价率锚定、随售罄率浮动，是 CPI 的上游。基准价 ¥100/件，默认加价 30% → ¥130/件。',
  },
  {
    key: 'revenue', label: '总营收', icon: '💵', term: 'totalRevenue',
    src: { kind: 'series', key: 'revenue' }, fmt: perMonth,
    desc: '全城企业本月销售额合计（元/月），也就是这座城市当月的产出规模。',
  },
  {
    key: 'vacancyRate', label: '岗位空缺率', icon: '🪑',
    src: { kind: 'series', key: 'vacancyRate' }, fmt: pct,
    desc: '招不到人的岗位占全部岗位的比例（%）。空缺越多，越会吸引外来人口迁入。',
    warn: (v) => v > 0.4,
  },
  {
    key: 'bankruptcies', label: '累计倒闭', icon: '💀', term: 'firmEntryExit',
    src: { kind: 'fn', fn: (s) => (s.series?.bankruptcies ?? []).reduce((a, b) => a + b, 0) },
    hist: (s) => {
      const b = s.series?.bankruptcies ?? [];
      let acc = 0;
      return b.map((v) => (acc += v));
    },
    fmt: (v) => `${Math.round(v)} 家`,
    desc: '连续亏损 8 个月且已裁到无人可裁的企业总数（家）。政策拧过头，这就是最先响的警报。',
    warn: (v) => v > 10,
  },
];

const GOV_VARS: VarDef[] = [
  {
    key: 'gdp', label: 'GDP', icon: '🏛', term: 'gdp',
    src: { kind: 'history', key: 'gdp' }, fmt: perMonth,
    desc: '当月经济总产出（元/月）。消费 + 投资 + 政府支出共同驱动。现实参照：2024 年中国人均 GDP 约 ¥8,229/月。',
  },
  {
    key: 'unemploymentRate', label: '失业率', icon: '🚩', term: 'unemployment',
    src: { kind: 'fn', fn: (s) => 1 - s.indicators.employmentRate },
    hist: (s) => s.history.map((h) => 1 - (h.employmentRate ?? 0)), fmt: pct,
    desc: '想工作却找不到岗位的人占劳动力的比例（%）。',
    warn: (v) => v > 0.08,
  },
  {
    key: 'cpi', label: 'CPI', icon: '🌡', term: 'cpi',
    src: { kind: 'history', key: 'cpi' }, fmt: (v) => `${v.toFixed(1)} 点`,
    desc: '居民消费价格指数（点），基期 100。高于 100 是通胀，低于 100 是通缩。',
    warn: (v) => v > 105 || v < 95,
  },
  {
    key: 'treasury', label: '财政余额', icon: '🏦', term: 'treasury',
    src: { kind: 'history', key: 'treasury' }, fmt: yuan,
    desc: '税收减去各项支出的累计结余（元）。赤字不是失败，但长期赤字会绑住你后续的政策空间。',
    warn: (v) => v < 0,
  },
  {
    key: 'gini', label: '基尼系数', icon: '⚖️', term: 'gini',
    src: { kind: 'history', key: 'gini' }, fmt: (v) => v.toFixed(3),
    desc: '收入分配的不平等程度，0 完全平均、1 完全集中。',
    warn: (v) => v > 0.45,
  },
  {
    key: 'happiness', label: '幸福度', icon: '😊', term: 'happiness',
    src: { kind: 'history', key: 'happiness' }, fmt: score,
    desc: '全城居民的平均主观感受（0-100 分），决定人口是流入还是流出。',
    warn: (v) => v < 55,
  },
];

const VARS: Record<Perspective, VarDef[]> = {
  household: HOUSEHOLD_VARS,
  firm: FIRM_VARS,
  gov: GOV_VARS,
};

export interface HudOpts {
  onTerm?: (key: string) => void;
}

export class Hud {
  private perspective: Perspective = 'household';
  private state: SimState | null = null;

  constructor(private el: HTMLElement, private opts: HudOpts = {}) {
    this.el.className = 'hud';
  }

  setPerspective(p: Perspective): void {
    this.perspective = p;
    this.render();
  }

  update(state: SimState): void {
    this.state = state;
    this.render();
  }

  private valueOf(def: VarDef, s: SimState): number {
    if (def.src.kind === 'series') {
      const arr = s.series?.[def.src.key];
      return arr && arr.length ? arr[arr.length - 1] : 0;
    }
    if (def.src.kind === 'history') {
      return (s.indicators?.[def.src.key] as number) ?? 0;
    }
    return def.src.fn(s);
  }

  private seriesOf(def: VarDef, s: SimState): number[] {
    if (def.hist) return def.hist(s);
    if (def.src.kind === 'series') return s.series?.[def.src.key] ?? [];
    if (def.src.kind === 'history') {
      const k = def.src.key;
      return s.history.map((h) => (h[k] as number) ?? 0);
    }
    // 没给出历史来源的派生量，只能画不出曲线——但 chip 上的当前值仍然准确
    return [];
  }

  private render(): void {
    const s = this.state;
    if (!s) return;
    const defs = VARS[this.perspective];
    this.el.innerHTML = defs
      .map((d) => {
        const v = this.valueOf(d, s);
        const warn = d.warn ? d.warn(v) : false;
        const prev = this.prevOf(d, s);
        const delta = prev === null ? 0 : v - prev;
        const arrow = Math.abs(delta) < 1e-9 ? '' : delta > 0 ? '▲' : '▼';
        const spark = sparkline(this.seriesOf(d, s), delta >= 0);
        return `<button class="hud-chip ${warn ? 'warn' : ''}" data-v="${d.key}" title="点击查看详细数据与累积曲线">
          <span class="hc-icon">${d.icon}</span>
          <span class="hc-body">
            <span class="hc-label">${d.label}</span>
            <span class="hc-value">${d.fmt(v)}<span class="hc-arrow ${delta >= 0 ? 'up' : 'down'}">${arrow}</span></span>
          </span>
          ${spark}
        </button>`;
      })
      .join('');
    this.el.querySelectorAll<HTMLElement>('.hud-chip').forEach((b) => {
      b.addEventListener('click', () => {
        const key = b.dataset.v;
        const def = defs.find((x) => x.key === key);
        if (def) this.openDetail(def);
      });
    });
  }

  private prevOf(def: VarDef, s: SimState): number | null {
    const arr = this.seriesOf(def, s);
    if (arr.length >= 2) return arr[arr.length - 2];
    return null;
  }

  // 详情：当前值 + 说明 + 累积曲线 + 关联概念
  private openDetail(def: VarDef): void {
    const s = this.state;
    if (!s) return;
    const arr = this.seriesOf(def, s);
    const cur = this.valueOf(def, s);
    const chart =
      arr.length >= 2
        ? lineChart(arr, def.fmt)
        : `<p class="muted">这项数据还没有足够的历史（需要再跑几个月才能画出曲线）。</p>`;
    const stats =
      arr.length >= 2
        ? `<div class="det-row"><span>区间最高</span><b>${def.fmt(Math.max(...arr))}</b></div>
           <div class="det-row"><span>区间最低</span><b>${def.fmt(Math.min(...arr))}</b></div>
           <div class="det-row"><span>区间均值</span><b>${def.fmt(avg(arr))}</b></div>
           <div class="det-row"><span>记录月数</span><b>${arr.length}</b></div>`
        : '';
    const em = emergeStats(s);
    const extra =
      def.key === 'poorShare'
        ? `<div class="det-row"><span>最富 10% 财富份额</span><b>${(em.wealthTop10 * 100).toFixed(0)}%</b></div>`
        : def.key === 'bankruptcies'
          ? `<div class="det-row"><span>亏损企业占比</span><b>${(em.lossFirmShare * 100).toFixed(0)}%</b></div>`
          : def.key === 'vacancyRate'
            ? `<div class="det-row"><span>现存企业数</span><b>${s.firms.length}</b></div>`
            : '';
    showModal(`
      <div class="chapter">${stageById(s.stage).name} · ${orientationInfo(s.orientation).name} · 第 ${s.cycle?.round ?? 1} 轮</div>
      <h2>${def.icon} ${def.label}</h2>
      <div class="det-now">${def.fmt(cur)}</div>
      <h4>这个数是什么</h4>
      <p>${def.desc}</p>
      <h4>累积曲线</h4>
      ${chart}
      <div class="det-stats">${stats}${extra}</div>
      ${def.term ? `<p class="muted">关联概念：${def.term}</p>` : ''}
      <button class="close" data-close>关闭</button>
    `);
  }
}

// 迷你趋势线（嵌在 chip 里）
function sparkline(arr: number[], up: boolean): string {
  if (arr.length < 2) return '';
  const tail = arr.slice(-48);
  const min = Math.min(...tail);
  const max = Math.max(...tail);
  const span = max - min || 1;
  const pts = tail
    .map((v, i) => `${(i / (tail.length - 1)) * 44 + 1},${13 - ((v - min) / span) * 11}`)
    .join(' ');
  const color = up ? 'var(--good)' : 'var(--bad)';
  return `<svg class="hc-spark" viewBox="0 0 46 15" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.2"/></svg>`;
}

// 详情弹窗里的大图：带网格、最大值标注与首尾值
function lineChart(arr: number[], fmt: (v: number) => string): string {
  const data = arr.slice(-120);
  const W = 480;
  const H = 150;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pad = 24;
  const x = (i: number) => (data.length === 1 ? pad : pad + (i / (data.length - 1)) * (W - pad * 2));
  const y = (v: number) => H - 20 - ((v - min) / span) * (H - 44);
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${x(0).toFixed(1)},${(H - 20).toFixed(1)} ${pts} ${x(data.length - 1).toFixed(1)},${(H - 20).toFixed(1)}`;
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((r) => `<line x1="${pad}" y1="${(20 + r * (H - 44)).toFixed(1)}" x2="${W - pad}" y2="${(20 + r * (H - 44)).toFixed(1)}" stroke="#2a2f3e" stroke-width="1"/>`)
    .join('');
  return `<svg class="det-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${grid}
      <polygon points="${area}" fill="rgba(79,157,255,.14)"/>
      <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"/>
      <text x="4" y="14" fill="#8b93a7" font-size="10">${fmt(max)}</text>
      <text x="4" y="${H - 6}" fill="#8b93a7" font-size="10">${fmt(min)}</text>
      <text x="${W - pad}" y="14" text-anchor="end" fill="#e6e9f0" font-size="10">${fmt(data[data.length - 1])}</text>
    </svg>
    <div class="det-axis"><span>最早</span><span>最近 ${data.length} 个月</span></div>`;
}
