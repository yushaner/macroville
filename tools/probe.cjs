// 量级体检：跑 N 个月后把关键口径全部打印出来，核对彼此是否自洽、是否贴近现实。
const path = require('path');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');

async function load(entry) {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true, format: 'cjs', platform: 'node', write: false,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', res.outputText || res.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const { SimEngine } = await load('src/sim/engine.ts');
  const months = Number(process.argv[2] || 120);
  const bp = process.argv[3] || 'marketTown';
  const st = new SimEngine().init(20261020, bp);
  const e = new SimEngine();
  for (let i = 0; i < months; i++) e.tick(st);

  // 取最近 12 个月的平均，避免恰好采在衰退月/繁荣月而误判
  const acc = [];
  for (let i = 0; i < 12; i++) {
    e.tick(st);
    const hh = st.households;
    const emp = hh.filter((h) => h.employed);
    const firms = st.firms;
    acc.push({
      cpi: st.indicators.cpi,
      wage: st.indicators.avgWage,
      gdp: st.firms.reduce((a, f) => a + f.revenue * 0.7, 0),
      pop: st.indicators.population,
      empRate: st.indicators.employmentRate,
      profit: firms.reduce((a, f) => a + f.profit, 0),
      revenue: firms.reduce((a, f) => a + f.revenue, 0),
      cons: hh.reduce((a, h) => a + h.consumption, 0),
      perWorker: firms.reduce((a, f) => a + f.revenue, 0) / Math.max(1, firms.reduce((a, f) => a + f.employees.length, 0)),
      stock: firms.reduce((a, f) => a + f.inventory, 0) / Math.max(1, firms.reduce((a, f) => a + f.output, 0)),
    });
  }
  const m12 = (k) => acc.reduce((a, x) => a + x[k], 0) / acc.length;

  const hhs = st.households;
  const employed = hhs.filter((h) => h.employed);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const totalCons = hhs.reduce((s, h) => s + h.consumption, 0);
  const totalSav = hhs.reduce((s, h) => s + h.savings, 0);
  const firms = st.firms;
  const empCnt = firms.reduce((s, f) => s + f.employees.length, 0);
  const revenue = firms.reduce((s, f) => s + f.revenue, 0);
  const output = firms.reduce((s, f) => s + f.output, 0);
  const stock = firms.reduce((s, f) => s + f.inventory, 0);
  const profit = firms.reduce((s, f) => s + f.profit, 0);
  const cap = firms.reduce((s, f) => s + f.capacity, 0);
  const pop = st.indicators.population;

  const L = [];
  const p = (k, v) => L.push(`${k.padEnd(26)} ${v}`);
  p('蓝图 / 月数', `${bp} / ${months}`);
  p('家庭（户） / 常住人口（人）', `${hhs.length} / ${pop}`);
  p('就业人数 / 岗位容量', `${empCnt} / ${Math.round(cap)}（利用率 ${(empCnt / cap * 100).toFixed(0)}%）`);
  p('就业率 / 失业率（12 月均值）', `${(m12('empRate') * 100).toFixed(1)}% / ${((1 - m12('empRate')) * 100).toFixed(1)}%`);
  p('平均税前月薪（12 月均值）', `¥${Math.round(m12('wage')).toLocaleString('zh-CN')}`);
  p('户均可支配月收入', `¥${Math.round(avg(employed.map((h) => h.wage * (1 - st.gov.taxRate)))).toLocaleString('zh-CN')}`);
  p('户均月消费', `¥${Math.round(totalCons / hhs.length).toLocaleString('zh-CN')}`);
  p('户均储蓄', `¥${Math.round(totalSav / hhs.length).toLocaleString('zh-CN')}`);
  p('抗风险缓冲', `${(totalSav / Math.max(1, totalCons) ).toFixed(1)} 个月`);
  p('CPI（12 月均值） / 售价', `${m12('cpi').toFixed(1)} 点 / ¥${Math.round(avg(firms.map((f) => f.price)))}/件`);
  p('月 GDP（增加值，12 月均值）', `¥${Math.round(m12('gdp')).toLocaleString('zh-CN')}`);
  p('人均 GDP（年化）', `¥${Math.round(m12('gdp') * 12 / m12('pop')).toLocaleString('zh-CN')}`);
  p('每就业者月产值', `¥${Math.round(revenue / Math.max(1, empCnt)).toLocaleString('zh-CN')}`);
  p('全城月消费支出', `¥${Math.round(totalCons).toLocaleString('zh-CN')}`);
  p('消费 / GDP', `${(totalCons / Math.max(1, revenue) * 100).toFixed(0)}%`);
  p('企业月利润合计 / 家均', `¥${Math.round(profit / 10000)}万 / ¥${Math.round(profit / Math.max(1, firms.length) / 1000)}千`);
  p('利润率（12 月均值）', `${(m12('profit') / Math.max(1, m12('revenue')) * 100).toFixed(1)}%`);
  p('库存 / 月产出（月数）', `${m12('stock').toFixed(2)} 个月`);
  p('财政余额', `¥${Math.round(st.gov.treasury).toLocaleString('zh-CN')}`);
  p('最低工资 / 市场工资', `¥${st.gov.minWage.toLocaleString('zh-CN')} / ¥${Math.round(st.indicators.avgWage).toLocaleString('zh-CN')}`);
  p('地价（均值/最高）', `¥${Math.round(st.city.tiles.reduce((s, t) => s + t.landValue, 0) / st.city.tiles.length)}/㎡ / ¥${Math.round(Math.max(...st.city.tiles.map((t) => t.landValue)))}/㎡`);
  p('基尼 / 幸福度', `${st.indicators.gini.toFixed(3)} / ${st.indicators.happiness.toFixed(0)}`);
  console.log(L.join('\n'));
})();
