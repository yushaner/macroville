// 成长节奏调参：扫若干组 CONFIG 参数 × 多个种子，输出「各阶段首次到达月份 / 终局人口 / 挂机解锁数」。
// 用法：node tools/tune-growth.cjs [months=300]
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const MONTHS = Number(process.argv[2] || 300);
const SEEDS = [20261020, 777, 1, 424242, 88888];

const GRID = [];
for (const sat of [58.5, 59, 59.5, 60]) {
  for (const pull of [0.006, 0.008, 0.010]) GRID.push({ sat, pull });
}

(async () => {
  // 引擎本身不导出 CONFIG，用一个内联入口把它一起带出来才能改参数
  const res = await esbuild.build({
    stdin: {
      contents: `export { SimEngine } from './src/sim/engine';\nexport { CONFIG } from './src/sim/config';`,
      resolveDir: ROOT, loader: 'ts', sourcefile: 'tune-entry.ts',
    },
    bundle: true, format: 'cjs', platform: 'node', write: false,
  });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', res.outputFiles[0].text)(mod, mod.exports, require);
  const { SimEngine, CONFIG } = mod.exports;
  if (!CONFIG) throw new Error('引擎未导出 CONFIG，无法调参');

  const rows = [];
  for (const g of GRID) {
    const line = [];
    let worstStage = '', minPop = Infinity, idleMin = 99, idleMax = 0;
    for (const seed of SEEDS) {
      CONFIG.SAT_TARGET = g.sat;
      CONFIG.JOB_PULL_CAP = g.pull;
      const engine = new SimEngine();
      const state = engine.init(seed);
      const first = {}, traj = {};
      for (let m = 1; m <= MONTHS; m++) {
        const r = engine.tick(state);
        if (r.stageChange && r.stageChange.up && first[r.stageChange.name] === undefined) {
          first[r.stageChange.name] = m;
        }
        if (m === 60 || m === 120 || m === 240) traj[m] = Math.round(state.indicators.population);
      }
      const pop = Math.round(state.indicators.population);
      const idle = state.unlocked.length;
      idleMin = Math.min(idleMin, idle); idleMax = Math.max(idleMax, idle);
      minPop = Math.min(minPop, pop);
      const reach = ['城镇', '城市', '大都市'].map((n) => (first[n] === undefined ? '—' : first[n])).join('/');
      if (first['大都市'] === undefined) worstStage = 'STUCK';
      line.push(`${reach} p60/120/240=${traj[60]}/${traj[120]}/${traj[240]} end=${pop}`);
    }
    rows.push(`SAT=${g.sat} PULL=${g.pull}  ${worstStage ? '⚠' + worstStage + ' ' : ''}[${line.join(' | ')}]  idle ${idleMin}~${idleMax} minPop=${minPop}`);
  }
  console.log('阶段首次到达月份：城镇/城市/大都市   （' + MONTHS + ' 月，' + SEEDS.length + ' 个种子）');
  console.log(rows.join('\n'));
})().catch((e) => { console.error('FAIL: ' + (e.stack || e.message)); process.exit(1); });
