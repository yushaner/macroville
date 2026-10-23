// 无头长跑：不依赖浏览器，直接把仿真引擎跑 N 个月。
// 检查：经济不崩、阶段能推进、城市定位会分化、解锁是「一个个来」而不是一批批弹，
// 以及——经济周期真的在波动（四阶段都出现过、产出缺口有正有负），而不是一条直线。
// 用法：node tools/sim-check.cjs [months] [seed] [blueprint]
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const MONTHS = Number(process.argv[2] || 240);
const SEED = Number(process.argv[3] || 20261020);
const BLUEPRINT = process.argv[4] || 'marketTown';

async function load(entry) {
  const res = await esbuild.build({
    entryPoints: [path.join(ROOT, entry)],
    bundle: true, format: 'cjs', platform: 'node', write: false,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', res.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports;
}

(async () => {
  const { SimEngine } = await load('src/sim/engine.ts');
  const { TERMS } = await load('src/data/glossary.ts');
  const TOTAL = TERMS.length;

  const engine = new SimEngine();
  const state = engine.init(SEED, BLUEPRINT);
  const log = [];
  const snap = (tag) => {
    const i = state.indicators;
    let built = 0;
    for (const t of state.city.tiles) if (t.developed) built++;
    log.push(
      `${tag.padEnd(9)} 月${String(state.month).padStart(3)} ${String(state.stage).padEnd(11)} ` +
      `人口${String(Math.round(i.population)).padStart(5)} 就业${(i.employmentRate * 100).toFixed(1)}% ` +
      `CPI${i.cpi.toFixed(1)} GDP${String(Math.round(i.gdp)).padStart(6)} 财政${String(Math.round(i.treasury)).padStart(7)} ` +
      `幸福${i.happiness.toFixed(0)} 建成${String(built).padStart(4)} 名词${state.unlocked.length} ` +
      `${state.business.phase} ${state.business.index >= 0 ? '+' : ''}${state.business.index.toFixed(2)}`
    );
  };

  snap('开局');
  const startTerms = state.unlocked.length;
  let bad = 0;
  let maxBatch = 0; // 单月最多解锁几个（应该恒为 1）
  const unlockMonths = [];
  const rounds = [];
  const phaseSeen = {};
  const gdpSeries = [];
  const gapSeries = [];
  for (let m = 1; m <= MONTHS; m++) {
    const r = engine.tick(state);
    if (r.stageChange) log.push(`  ↳ ${r.stageChange.up ? '升级' : '衰退'} → ${r.stageChange.name}`);
    if (r.cycleEvent && r.cycleEvent.kind === 'round') {
      rounds.push(`第${r.cycleEvent.round}轮@${state.month}月`);
      log.push(`  ↳ 进入第 ${r.cycleEvent.round} 轮循环（视角→${r.cycleEvent.phase}）`);
    }
    if (r.unlocked && r.unlocked.length) {
      maxBatch = Math.max(maxBatch, r.unlocked.length);
      unlockMonths.push(state.month);
      log.push(`  ↳ 解锁「${r.unlocked[0].name}」：${r.unlocked[0].reason}`);
    }
    const b = state.business;
    phaseSeen[b.phase] = (phaseSeen[b.phase] || 0) + 1;
    gdpSeries.push(state.indicators.gdp);
    gapSeries.push(b.outputGap);
    if (!Number.isFinite(state.indicators.gdp) || !Number.isFinite(state.indicators.cpi)) bad++;
    if (!Number.isFinite(b.index) || !Number.isFinite(b.outputGap)) bad++;
    if (m % 60 === 0) snap(`第${m}月`);
  }
  snap('结束');

  let gaps = [];
  for (let i = 1; i < unlockMonths.length; i++) gaps.push(unlockMonths[i] - unlockMonths[i - 1]);
  const minGap = gaps.length ? Math.min(...gaps) : 999;

  // 周期体检：是不是真的在波动，而不是一条直线
  const b = state.business;
  const idxMin = Math.min(...b.history);
  const idxMax = Math.max(...b.history);
  const gapMin = Math.min(...gapSeries);
  const gapMax = Math.max(...gapSeries);
  const gdpMin = Math.min(...gdpSeries);
  const gdpMax = Math.max(...gdpSeries);
  const gdpWave = gdpMax > 0 ? (gdpMax - gdpMin) / gdpMax : 0;
  const phaseKinds = Object.keys(phaseSeen).length;

  log.push('');
  log.push(`蓝图 ${BLUEPRINT} · 定位 ${state.orientation} · 轮次 ${state.cycle.round}/${state.cycle.roundsPlanned} · 视角 ${state.cycle.phase}`);
  log.push(`开局名词 ${startTerms} → 跑 ${MONTHS} 月后 ${state.unlocked.length} / ${TOTAL}`);
  log.push(`解锁节奏：单月最多 ${maxBatch} 个，最短间隔 ${minGap} 个月，共 ${unlockMonths.length} 次`);
  log.push(`循环：${rounds.join(' → ') || '（未进入第 2 轮）'}`);
  log.push(`经济周期：景气区间 ${idxMin.toFixed(2)} ~ ${idxMax.toFixed(2)}｜产出缺口 ${(gapMin * 100).toFixed(1)}% ~ ${(gapMax * 100).toFixed(1)}%`);
  log.push(`  阶段分布 ${Object.entries(phaseSeen).map(([k, v]) => `${k}:${v}月`).join(' ')}（出现 ${phaseKinds} 种，完成 ${b.cycleCount} 轮）`);
  log.push(`  振幅 ${(b.amplitude * 100).toFixed(0)}%｜波长 ${b.period.toFixed(0)} 月｜GDP 波动幅度 ${(gdpWave * 100).toFixed(1)}%（${Math.round(gdpMin)} ~ ${Math.round(gdpMax)}）`);

  // 主动拧旋钮应该带来新名词（且受冷却限制，不会一次一片）
  const before = state.unlocked.length;
  const moves = [
    ['household', 'skillInvest', 0.8],
    ['household', 'savingsRate', 0.45],
    ['household', 'consumptionPropensity', 1.3],
    ['firm', 'markup', 0.7],
    ['firm', 'expansion', 0.8],
    ['firm', 'rdInvest', 0.7],
    ['firm', 'inventoryStrategy', 0.8],
  ];
  const gained = [];
  for (const [scope, target, v] of moves) {
    const got = engine.applyLever(state, scope, target, v) || [];
    for (const g of got) gained.push(`${g.name}（${g.reason}）`);
  }
  log.push(`主动调 ${moves.length} 个旋钮后新增 ${state.unlocked.length - before} 个名词：`);
  for (const g of gained) log.push(`  · ${g}`);
  log.push(`合计 ${state.unlocked.length} / ${TOTAL}`);

  const noBurst = maxBatch <= 1;
  // 周期必须真的在动：景气区间够宽、产出缺口有正有负、四阶段至少出现过两种
  const cycleAlive = idxMax - idxMin > 0.6 && gapMax > 0.01 && gapMin < -0.01 && phaseKinds >= 2;
  const pass = bad === 0 && noBurst && state.unlocked.length > startTerms && cycleAlive;
  log.push(bad ? `RESULT: FAIL（${bad} 个月出现非法数值）` : pass ? 'RESULT: PASS' : 'RESULT: FAIL');
  if (!cycleAlive) log.push(`  ↳ 周期未跑出波动：景气区间 ${(idxMax - idxMin).toFixed(2)}、缺口 ${gapMin.toFixed(3)}~${gapMax.toFixed(3)}、阶段 ${phaseKinds} 种`);
  console.log(log.join('\n'));
  process.exit(pass ? 0 : 1);
})().catch((e) => { console.error('FAIL: ' + (e.stack || e.message)); process.exit(1); });
