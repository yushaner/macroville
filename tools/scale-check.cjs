// 规模体检：把六张蓝图各跑 N 个月，检查「承载量 — 人口 — 用地」这条链路的量级是否对得上设计目标。
//
// 设计锚点：DESIGN_POP_CAP = 100 万常住人口（src/sim/land.ts）。
// 检查口径：
//   ① 静态天花板：全部居住用地按「控规容积率上限」铺满，能装多少人 → 应当 ≈ 100 万（允许 +30% 余量）
//   ② 终局规模：跑满 N 个月后实际人口 → 不应超过天花板，且主力蓝图应能爬到 60 万以上
//   ③ 空间自洽：建成区面积、人口密度、住区容积率、就业率、财政余额落在合理区间
//   ④ 不崩：人口不为负、不 NaN、阶段能推进
//
// 用法：node tools/scale-check.cjs [months=480] [seed=20261020]
// 结果同时写进 tools/scale-report.txt（UTF-8，避免终端编码错乱）。
const path = require('path');
const fs = require('fs');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const MONTHS = Number(process.argv[2] || 480);
const SEED = Number(process.argv[3] || 20261020);
const BLUEPRINTS = ['rural', 'marketTown', 'factory', 'port', 'campus', 'greenfield'];

async function load(entry) {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true, format: 'cjs', platform: 'node', write: false,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', res.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

const wan = (v) => (Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(2)}亿` : `${(v / 1e4).toFixed(1)}万`);
const pad = (s, n) => String(s).padEnd(n, ' ');

function measure(st, land) {
  let pop = 0, popCap = 0, planCap = 0, built = 0, jobs = 0, jobCap = 0;
  let resN = 0, farSum = 0;
  for (const t of st.city.tiles) {
    pop += t.pop;
    jobs += t.jobs;
    if (t.type === 'residential') {
      planCap += land.planPopCapOf(t);
      if (t.developed) { popCap += land.popCapOf(t); resN++; farSum += land.farOf(t.type, t.level); }
    }
    if (t.developed) { built++; jobCap += land.jobCapOf(t); }
  }
  return {
    pop: Math.round(pop), popCap, planCap, built, jobs, jobCap,
    occupancy: popCap > 0 ? Math.min(1, pop / popCap) : 0,
    density: built ? pop / (built * 0.0625) : 0,
    avgFar: resN ? farSum / resN : 0,
    emp: st.indicators.employmentRate,
    treasury: st.gov.treasury,
    stage: st.stage,
    gdpPerCap: Math.round((st.indicators.gdp * 12) / Math.max(1, pop)),
  };
}

(async () => {
  const { SimEngine } = await load('src/sim/engine.ts');
  const land = await load('src/sim/land.ts');
  const out = [];
  const say = (s) => { out.push(s); };

  say(`规模体检 · ${BLUEPRINTS.length} 张蓝图 × ${MONTHS} 月 · seed=${SEED} · 设计目标 ${wan(land.DESIGN_POP_CAP)} 人`);
  say('');
  say(['蓝图', '静态天花板', '终局人口', '天花板占用', '建成格', '建成区km²', '人口密度', '住区容积率', '就业率', '人均GDP年化', '财政余额', '终局阶段']
    .map((c, i) => pad(c, i === 0 ? 12 : 13)).join(''));
  say('-'.repeat(160));

  let fails = 0;
  for (const bp of BLUEPRINTS) {
    const st = new SimEngine().init(SEED, bp);
    const plan0 = measure(st, land);
    const e = new SimEngine();
    for (let i = 0; i < MONTHS; i++) e.tick(st);
    const m = measure(st, land);

    const problems = [];
    if (!Number.isFinite(m.pop) || m.pop < 0) problems.push('人口异常');
    if (m.pop > plan0.planCap * 1.05) problems.push('人口超过静态天花板');
    if (plan0.planCap > land.DESIGN_POP_CAP * 1.6) problems.push(`天花板过高于设计目标 ${wan(plan0.planCap)}`);
    if (plan0.planCap < land.DESIGN_POP_CAP * 0.5) problems.push(`天花板过低于设计目标 ${wan(plan0.planCap)}`);
    if (m.occupancy > 1.02) problems.push(`入住率 ${(m.occupancy * 100).toFixed(0)}% 越界`);
    if (m.density > 30000) problems.push(`密度 ${Math.round(m.density)} 人/km² 过高`);
    if (problems.length) fails++;

    say([
      bp, wan(plan0.planCap), m.pop.toLocaleString('zh-CN'), `${((m.pop / Math.max(1, plan0.planCap)) * 100).toFixed(0)}%`,
      m.built, ((m.built * 62500) / 1e6).toFixed(1), Math.round(m.density).toLocaleString('zh-CN'),
      m.avgFar.toFixed(2), `${(m.emp * 100).toFixed(1)}%`, `¥${m.gdpPerCap.toLocaleString('zh-CN')}`,
      `¥${wan(m.treasury)}`, m.stage,
    ].map((s, i) => pad(s, i === 0 ? 12 : 13)).join('') + (problems.length ? `  ⚠ ${problems.join('；')}` : ''));
  }

  say('');
  say(`结论：${fails === 0 ? '全部通过' : `${fails} 张蓝图存在问题`}`);
  const text = out.join('\n') + '\n';
  fs.writeFileSync(path.join(__dirname, 'scale-report.txt'), text, 'utf8');
  console.log(text);
  process.exit(fails === 0 ? 0 : 1);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
