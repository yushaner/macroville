// 土地与承载量体检：跑 N 个月，把「空间 — 承载量 — 人口 — 用地」这条链路的量级全部打印出来。
// 重点回答四个问题：
//   ① 全城建满能装多少人？（设计目标 ≈ 110 万，让玩家有奔够着的空间）
//   ② 实际人口能不能真的长上去、卡在哪一格？
//   ③ 入住率 / 岗位承载 / 财政这些派生指标是否自洽？
//   ④ 人口规模和我们想表现的「城市阶段」对不对得上？
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

const wan = (v) => (Math.abs(v) >= 1e8 ? `${(v / 1e8).toFixed(2)} 亿` : `${(v / 1e4).toFixed(1)} 万`);
const pad = (s, n) => String(s).padEnd(n, ' ');

function snap(st, land, month) {
  let pop = 0;
  let popCap = 0;
  let planCap = 0;
  let built = 0;
  let jobs = 0;
  let jobCap = 0;
  let lv = 0;
  let lvN = 0;
  let resN = 0;
  let farSum = 0;
  let lvlSum = 0;
  for (const t of st.city.tiles) {
    pop += t.pop;
    jobs += t.jobs;
    if (t.type === 'residential') {
      planCap += land.planPopCapOf(t);
      if (t.developed) {
        popCap += land.popCapOf(t);
        resN++;
        farSum += land.farOf(t.type, t.level);
        lvlSum += t.level;
      }
    }
    if (t.developed) {
      built++;
      lv += t.landValue;
      lvN++;
      jobCap += land.jobCapOf(t);
    }
  }
  return {
    month,
    stage: st.stage,
    pop: Math.round(pop),
    samples: st.households.length,
    scale: st.households.length ? st.realHouseholds / st.households.length : 0,
    built,
    popCap,
    planCap,
    occupancy: popCap > 0 ? Math.min(1, pop / popCap) : 0,
    gdpPerCap: Math.round((st.indicators.gdp * 12) / Math.max(1, pop)),
    empRate: st.indicators.employmentRate,
    landValue: lvN ? lv / lvN : 0,
    jobs,
    jobCap,
    treasury: st.gov.treasury,
    avgFar: resN ? farSum / resN : 0,
    avgLevel: resN ? lvlSum / resN : 0,
  };
}

(async () => {
  const { SimEngine } = await load('src/sim/engine.ts');
  const land = await load('src/sim/land.ts');
  const months = Number(process.argv[2] || 240);
  const bp = process.argv[3] || 'marketTown';

  const st = new SimEngine().init(20261020, bp);
  const e = new SimEngine();

  const cnt = (type) => st.city.tiles.filter((t) => t.type === type).length;
  const cls = (c) => st.city.tiles.filter((t) => t.roadClass === c).length;
  console.log(`\n===== 蓝图 ${bp} · 规划图静态体检 =====`);
  console.log(`地图规模      ${st.city.width}×${st.city.height}（每格 250m → ${((st.city.width * 250) / 1000).toFixed(0)}km × ${((st.city.height * 250) / 1000).toFixed(0)}km ≈ ${(((st.city.width * 250) / 1000) * ((st.city.height * 250) / 1000)).toFixed(0)}km²）`);
  console.log(`路网占比      ${((cnt('road') / st.city.tiles.length) * 100).toFixed(1)}%（主干 ${cls(3)} / 次干 ${cls(2)} / 支路 ${cls(1)} 格）`);
  console.log(`用途结构      居住 ${cnt('residential')} · 商业 ${cnt('commercial')} · 工业 ${cnt('industrial')} · 公园 ${cnt('park')} · 公服 ${cnt('school') + cnt('hospital') + cnt('power') + cnt('water')}`);
  // 控规口径的承载天花板：每个居住街坊按「控规容积率上限」折算后加总
  const plan0 = snap(st, land, 0);
  const dev = plan0.planCap / land.DESIGN_POP_CAP - 1;
  console.log(
    `理论承载上限  ${wan(plan0.planCap)} 人（全部居住用地按控规容积率铺满）` +
      `　设计目标 ${wan(land.DESIGN_POP_CAP)} 人，偏差 ${dev >= 0 ? '+' : ''}${(dev * 100).toFixed(1)}%`,
  );

  console.log(`\n===== 跑 ${months} 个月 =====`);
  const cols = ['时点', '阶段', '常住人口', '样本/倍率', '建成格', '住区容量', '入住率', '人均GDP年化', '就业率', '地价均值'];
  console.log(cols.map((c) => pad(c, 14)).join(''));
  const trace = [];
  const marks = new Set([0, 11, 59, 119, 179, 239, 299, 359].filter((m) => m < months));
  for (let i = 0; i < months; i++) {
    e.tick(st);
    if (marks.has(i) || i === months - 1) trace.push(snap(st, land, i + 1));
  }
  for (const r of trace) {
    console.log([
      `${r.month} 月`,
      r.stage,
      r.pop.toLocaleString('zh-CN'),
      `${r.samples}/${r.scale.toFixed(0)}x`,
      r.built,
      wan(r.popCap),
      `${(r.occupancy * 100).toFixed(0)}%`,
      `¥${r.gdpPerCap.toLocaleString('zh-CN')}`,
      `${(r.empRate * 100).toFixed(1)}%`,
      `¥${r.landValue.toFixed(0)}`,
    ].map((s) => pad(s, 14)).join(''));
  }
  const last = trace[trace.length - 1];
  console.log('\n—— 终局体检 ——');
  console.log(`全城规划承载上限     ${wan(last.planCap)} 人`);
  console.log(`建成住区承载 / 人口  ${wan(last.popCap)} / ${last.pop.toLocaleString('zh-CN')} 人`);
  console.log(`建成区面积          ${((last.built * 62500) / 1e6).toFixed(1)} km²（${last.built} 格 × 6.25 万㎡）`);
  console.log(`人口密度            ${Math.round(last.pop / (last.built * 0.0625)).toLocaleString('zh-CN')} 人/km²`);
  console.log(`在岗 / 产业承载      ${wan(last.jobs)} / ${wan(last.jobCap)} 个岗位`);
  console.log(`住区平均容积率       ${last.avgFar.toFixed(2)}（平均 ${last.avgLevel.toFixed(1)} 级开发强度）`);
  console.log(`财政余额            ¥${wan(last.treasury)}`);
})();
