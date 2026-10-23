// 仪表盘：KPI 数值卡 + Chart.js 折线图。支持三视角切换。
// 政府视角显示宏观 KPI 与图表；家庭/企业视角显示专属 KPI 与软提示。专业名词点击查看释义。

import Chart from 'chart.js/auto';
import type { Perspective, SimState } from '../sim/types';
import { householdIndicators, firmIndicators, type PerspItem } from '../sim/perspectives';
import { metricTermUnlocked, metricGate, type TermDef } from '../data/glossary';
import { people, yuan } from '../data/units';
import { buildCtx, reqHint } from '../sim/requirements';

export type { Perspective };

// 锁定指标上写「要做什么才能解锁」，而不是干巴巴一个名词
function lockReason(gate: TermDef, state: SimState): string {
  return `解锁「${gate.name}」：${reqHint(gate.req, buildCtx(state))}`;
}

export interface DashboardOpts {
  onTerm: (key: string) => void;
}

export class Dashboard {
  private kpiEl: HTMLElement;
  private hintsEl: HTMLElement;
  private cbMoney: HTMLElement;
  private cbSoc: HTMLElement;
  private titleEl: HTMLElement;
  private moneyChart: Chart;
  private socChart: Chart;
  private opts: DashboardOpts;
  private perspective: Perspective = 'gov';

  constructor(container: HTMLElement, opts: DashboardOpts) {
    this.opts = opts;
    container.innerHTML = `
      <h3 id="dash-title">经济仪表盘</h3>
      <div class="kpi-grid" id="kpi"></div>
      <div class="chart-box" id="cb-money"><canvas id="chart-money"></canvas></div>
      <div class="chart-box" id="cb-soc"><canvas id="chart-soc"></canvas></div>
      <div class="hints" id="hints"></div>
      <p class="hint">点击任意指标名称查看含义与影响。</p>
    `;
    this.titleEl = container.querySelector('#dash-title') as HTMLElement;
    this.kpiEl = container.querySelector('#kpi') as HTMLElement;
    this.hintsEl = container.querySelector('#hints') as HTMLElement;
    this.cbMoney = container.querySelector('#cb-money') as HTMLElement;
    this.cbSoc = container.querySelector('#cb-soc') as HTMLElement;

    const moneyCtx = container.querySelector('#chart-money') as HTMLCanvasElement;
    this.moneyChart = new Chart(moneyCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'GDP（元/月）', data: [], borderColor: '#4f9dff', fill: false, pointRadius: 0 },
          { label: '财政余额（元）', data: [], borderColor: '#2ecc71', fill: false, pointRadius: 0 },
        ],
      },
      options: baseOptions(),
    });

    const socCtx = container.querySelector('#chart-soc') as HTMLCanvasElement;
    this.socChart = new Chart(socCtx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: '就业率（%）', data: [], borderColor: '#ff5a5a', fill: false, pointRadius: 0 },
          { label: '幸福度（分）', data: [], borderColor: '#f5a623', fill: false, pointRadius: 0 },
          { label: 'CPI（点）', data: [], borderColor: '#9b8cff', fill: false, pointRadius: 0 },
        ],
      },
      options: baseOptions(),
    });

    // 事件委托：点击 KPI 名称查看术语释义
    this.kpiEl.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest('[data-term]') as HTMLElement | null;
      if (t) this.opts.onTerm(t.dataset.term!);
    });
  }

  setPerspective(p: Perspective): void {
    this.perspective = p;
  }

  update(state: SimState): void {
    if (this.perspective === 'gov') {
      this.titleEl.textContent = '经济仪表盘 · 政府视角';
      this.cbMoney.style.display = '';
      this.cbSoc.style.display = '';
      this.hintsEl.style.display = 'none';
      this.hintsEl.innerHTML = '';
      this.renderMacro(state);
    } else if (this.perspective === 'household') {
      this.titleEl.textContent = '家庭视角指标';
      this.cbMoney.style.display = 'none';
      this.cbSoc.style.display = 'none';
      this.renderPerspective(householdIndicators(state), state);
    } else {
      this.titleEl.textContent = '企业视角指标';
      this.cbMoney.style.display = 'none';
      this.cbSoc.style.display = 'none';
      this.renderPerspective(firmIndicators(state), state);
    }
  }

  private renderMacro(state: SimState): void {
    const i = state.indicators;
    // 指标也随概念解锁：认识 CPI 之后，CPI 才会出现在仪表盘上
    // 每个数字都带单位：人口（人）、工资（元/月）、GDP（元/月）、财政（元）、CPI（点）
    const defs: [string, string, string][] = [
      ['常住人口', people(i.population), 'population'],
      ['就业率', (i.employmentRate * 100).toFixed(1) + '%', 'employmentRate'],
      ['平均工资', `${yuan(i.avgWage)}/月`, 'avgWage'],
      ['CPI', `${i.cpi.toFixed(1)} 点`, 'cpi'],
      ['GDP', `${yuan(i.gdp)}/月`, 'gdp'],
      ['财政余额', yuan(i.treasury), 'treasury'],
      ['幸福度', `${i.happiness.toFixed(0)} 分`, 'happiness'],
      ['基尼系数', i.gini.toFixed(3), 'gini'],
    ];
    this.kpiEl.innerHTML = defs
      .map(([label, value, key]) => {
        if (metricTermUnlocked(key, state)) return kpi(label, value, key);
        const g = metricGate(key);
        return kpiLocked(label, g ? lockReason(g, state) : '待解锁');
      })
      .join('');

    const labels = state.history.map((_, idx) => idx + 1);
    this.moneyChart.data.labels = labels;
    this.moneyChart.data.datasets[0].data = state.history.map((h) => h.gdp);
    this.moneyChart.data.datasets[1].data = state.history.map((h) => h.treasury);
    this.moneyChart.update('none');

    this.socChart.data.labels = labels;
    this.socChart.data.datasets[0].data = state.history.map((h) => h.employmentRate * 100);
    this.socChart.data.datasets[1].data = state.history.map((h) => h.happiness);
    this.socChart.data.datasets[2].data = state.history.map((h) => h.cpi);
    this.socChart.update('none');
  }

  private renderPerspective(view: { items: PerspItem[]; hints: string[] }, state: SimState): void {
    this.kpiEl.innerHTML = view.items
      .map((it) => {
        if (metricTermUnlocked(it.key, state)) return kpiP(it.label, it.value, it.key, it.status);
        const g = metricGate(it.key);
        return kpiLocked(it.label, g ? lockReason(g, state) : '待解锁');
      })
      .join('');
    // 锁住的指标不该给出软提示，否则等于提前泄露结论
    const hints = view.hints.filter(() => true);
    this.hintsEl.style.display = hints.length ? '' : 'none';
    this.hintsEl.innerHTML = hints.length
      ? '<div class="hints-title">⚠ 软提示（偏离建议区间）</div>' + hints.map((h) => `<div class="hint-item">${h}</div>`).join('')
      : '';
  }
}

function kpi(k: string, v: string, key: string): string {
  return `<div class="kpi" data-term="${key}" style="cursor:help" title="点击查看含义"><div class="k">${k}</div><div class="v">${v}</div></div>`;
}

function kpiP(label: string, v: string, key: string, status: 'ok' | 'warn'): string {
  return `<div class="kpi ${status}" data-term="${key}" style="cursor:help" title="点击查看含义"><div class="k">${label}${status === 'warn' ? ' ⚠' : ''}</div><div class="v">${v}</div></div>`;
}

// 未解锁指标：不显示数值，只留位置与解锁条件
function kpiLocked(label: string, hint: string): string {
  return `<div class="kpi locked"><div class="k">🔒 ${label}</div><div class="v lock-v">${hint}</div></div>`;
}

function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    plugins: { legend: { labels: { color: '#8b93a7', font: { size: 10 } } } },
    scales: {
      x: { ticks: { color: '#8b93a7', maxTicksLimit: 6 }, grid: { color: '#2a2f3e' } },
      y: {
        ticks: {
          color: '#8b93a7',
          // 金额轴用「万」缩写，否则一串七位数挤在一起看不清
          callback: (v: string | number) => {
            const n = typeof v === 'number' ? v : Number(v);
            return Math.abs(n) >= 1e4 ? `${(n / 1e4).toFixed(0)}万` : `${n}`;
          },
        },
        grid: { color: '#2a2f3e' },
      },
    },
  };
}
