// 全量体检：政策（杠杆）、指标、图谱（名词 + 题库）三者的一致性，外加一次极值压力跑。
//
// 为什么需要它：名词、杠杆、指标、题目是四份互相引用的数据，任何一处手滑写错 key，
// 表现都是"某个滑杆永远灰着"或"某个指标永远不亮"——运行时不报错，但功能悄悄死了。
// 这里把这类引用关系全部静态校验一遍，再把每根旋钮推到两端各跑一次，确认不炸。
//
// 用法：node tools/audit.cjs
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '..');
const out = [];
const errors = [];
const warns = [];

function err(msg) { errors.push(msg); out.push('  ✗ ' + msg); }
function warn(msg) { warns.push(msg); out.push('  ! ' + msg); }
function ok(msg) { out.push('  ✓ ' + msg); }

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
  const G = await load('src/data/glossary.ts');
  const L = await load('src/data/levers.ts');
  const Q = await load('src/data/quiz.ts');
  const R = await load('src/sim/requirements.ts');
  const B = await load('src/sim/businessCycle.ts');
  const P = await load('src/sim/perspectives.ts');
  const E = await load('src/sim/engine.ts');

  const TERMS = G.TERMS;
  const LEVERS = L.LEVERS;
  const QUIZZES = Q.QUIZZES;
  const leverIds = new Set(LEVERS.map((l) => l.id));
  const termKeys = new Set(TERMS.map((t) => t.key));
  const phaseIds = new Set(Object.keys(B.PHASE_META));

  // ── 1. 名词表 ──
  out.push('【1】名词表（图谱）');
  const seen = new Set();
  for (const t of TERMS) {
    if (seen.has(t.key)) err(`名词 key 重复：${t.key}`);
    seen.add(t.key);
    if (!['micro', 'industrial', 'macro'].includes(t.chapter)) err(`${t.key} 的 chapter 非法：${t.chapter}`);
    if (!t.name || !t.def || !t.effect) err(`${t.key} 缺少 name/def/effect`);
    for (const r of t.related ?? []) {
      if (!termKeys.has(r)) err(`${t.key} 的 related 指向不存在的名词：${r}`);
    }
    for (const lv of t.unlocks?.levers ?? []) {
      if (!leverIds.has(lv)) err(`${t.key} 的 unlocks.levers 指向不存在的滑杆：${lv}`);
    }
  }
  ok(`名词 ${TERMS.length} 条，key 无重复、related 引用全部有效`);

  // ── 2. 解锁条件 ──
  out.push('【2】解锁条件（req 表达式）');
  let reqCount = 0;
  const walk = (r, where) => {
    if (!r || typeof r !== 'object') { err(`${where} 的 req 为空`); return; }
    reqCount++;
    switch (r.k) {
      case 'gt': case 'lt': case 'peak': case 'trough':
        if (!R.NUM_FIELDS.includes(r.f)) err(`${where} 引用了不存在的指标字段：${r.f}`);
        if (typeof r.v !== 'number' || Number.isNaN(r.v)) err(`${where} 的阈值非法：${r.v}`);
        break;
      case 'lever': case 'leverEver':
        if (!leverIds.has(r.id)) err(`${where} 引用了不存在的滑杆：${r.id}`);
        break;
      case 'phase':
        if (!phaseIds.has(r.v)) err(`${where} 引用了不存在的周期阶段：${r.v}`);
        break;
      case 'stage':
        if (!(r.n >= 0 && r.n <= 3)) err(`${where} 的 tier 超出 0-3：${r.n}`);
        break;
      case 'month': case 'round':
        if (typeof r.n !== 'number') err(`${where} 的 n 非法`);
        break;
      case 'streak':
        walk(r.cond, where + '/streak');
        break;
      case 'all': case 'any':
        if (!Array.isArray(r.of) || r.of.length === 0) err(`${where} 的 ${r.k} 子条件为空`);
        else r.of.forEach((x) => walk(x, where));
        break;
      default:
        err(`${where} 的 req 类型未知：${r.k}`);
    }
  };
  for (const t of TERMS) walk(t.req, t.key);
  ok(`已遍历 ${reqCount} 个条件节点，字段 / 滑杆 / 阶段引用全部有效`);

  // 文案函数不能抛异常（UI 每帧都会调）
  const st = E.SimEngine ? new E.SimEngine().init(20261020, 'marketTown') : null;
  if (st) {
    const ctx = R.buildCtx(st);
    let textFail = 0;
    for (const t of TERMS) {
      try {
        R.reqText(t.req); R.reqHint(t.req, ctx); R.reqProgress(t.req, ctx); R.reqMet(t.req, ctx);
      } catch (e) { textFail++; err(`${t.key} 的条件文案/求值抛异常：${e.message}`); }
    }
    if (!textFail) ok('全部名词的「解锁条件文案 / 完成度 / 判定」均可正常求值');
  }

  // ── 3. 题库 ──
  out.push('【3】闯关题库');
  const qSeen = new Set();
  for (const q of QUIZZES) {
    if (qSeen.has(q.key)) err(`题目重复：${q.key}`);
    qSeen.add(q.key);
    if (!termKeys.has(q.key)) { err(`题目 ${q.key} 没有对应的名词`); continue; }
    if (!['single', 'multi', 'judge'].includes(q.type)) err(`${q.key} 题型非法：${q.type}`);
    if (!q.stem || !q.explain || !q.source) err(`${q.key} 缺少题干/解析/出处`);
    if (!Array.isArray(q.options) || q.options.length < 2) err(`${q.key} 选项过少`);
    if (!Array.isArray(q.answer) || q.answer.length === 0) err(`${q.key} 没有答案`);
    for (const a of q.answer ?? []) {
      if (!(Number.isInteger(a) && a >= 0 && a < (q.options?.length ?? 0))) err(`${q.key} 的答案下标越界：${a}`);
    }
    if (new Set(q.options).size !== q.options.length) err(`${q.key} 有重复选项`);
    if (q.type === 'judge' && q.options.length !== 2) err(`${q.key} 判断题应有 2 个选项`);
    if (q.type === 'multi' && (q.answer?.length ?? 0) < 2) err(`${q.key} 多选题应有 ≥2 个正确答案`);
    if ((q.type === 'single' || q.type === 'judge') && (q.answer?.length ?? 0) !== 1) err(`${q.key} 单选/判断应只有 1 个正确答案`);
  }
  const missingQuiz = TERMS.filter((t) => !qSeen.has(t.key)).map((t) => t.key);
  if (missingQuiz.length) err(`以下名词还没有配题：${missingQuiz.join('、')}`);
  else ok(`${QUIZZES.length} 道题，名词与题目一一对应，答案下标全部合法`);

  // ── 4. 政策滑杆 ──
  out.push('【4】政策滑杆');
  if (!st) err('无法初始化引擎，跳过运行时检查');
  else {
    const paramKeys = {
      gov: Object.keys(st.gov),
      household: Object.keys(st.householdParams),
      firm: Object.keys(st.firmParams),
    };
    for (const l of LEVERS) {
      if (!(l.min < l.max)) err(`滑杆 ${l.id} 的 min≥max`);
      if (!(l.step > 0)) err(`滑杆 ${l.id} 的 step 非法`);
      if (l.value < l.min || l.value > l.max) err(`滑杆 ${l.id} 的初始值 ${l.value} 超出 [${l.min},${l.max}]`);
      if (!paramKeys[l.scope]?.includes(l.target)) err(`滑杆 ${l.id} 的 target「${l.target}」不在 ${l.scope} 参数对象里`);
      if (!l.desc || !l.effect) err(`滑杆 ${l.id} 缺少说明文案`);
      const gate = G.leverGate(l.id);
      if (!gate) warn(`滑杆 ${l.id} 没有绑定名词门禁（开局即可调，不受图谱约束）`);
      else if (!(gate.unlocks?.levers ?? []).includes(l.id)) err(`滑杆 ${l.id} 与门禁名词 ${gate.key} 的绑定不一致`);
    }
    ok(`${LEVERS.length} 根滑杆，量纲 / 初始值 / target 字段全部合法`);

    // 每根滑杆推到两端各跑一次——玩家真的会把它们拧到头
    const MONTHS = 60;
    let crashes = 0;
    let nan = 0;
    for (const l of LEVERS) {
      for (const v of [l.min, l.max]) {
        try {
          const s2 = new E.SimEngine().init(20261020, 'marketTown');
          // 直接落到参数对象上，绕开「名词门禁」——门禁是玩法限制，不该掩盖参数本身的问题
          if (l.scope === 'gov') s2.gov[l.target] = v;
          else if (l.scope === 'household') s2.householdParams[l.target] = v;
          else s2.firmParams[l.target] = v;
          if (l.target === 'industrySubsidy') s2.gov.subsidy = { basic: v, manufacturing: v, service: v };
          for (let m = 0; m < MONTHS; m++) new E.SimEngine().tick(s2);
          const i = s2.indicators;
          const vals = [i.gdp, i.cpi, i.employmentRate, i.treasury, i.happiness, i.gini, i.avgWage,
            s2.business.index, s2.business.outputGap];
          if (vals.some((x) => !Number.isFinite(x))) { nan++; err(`滑杆 ${l.id}=${v} 跑 ${MONTHS} 月后出现非数值`); }
        } catch (e) {
          crashes++; err(`滑杆 ${l.id}=${v} 崩溃：${e.message}`);
        }
      }
    }
    if (!crashes && !nan) ok(`${LEVERS.length * 2} 组极值各跑 ${MONTHS} 个月：无崩溃、无非数值`);
  }

  // ── 5. 指标与门禁 ──
  out.push('【5】仪表盘指标');
  if (st) {
    // 政府视角的宏观指标（与 dashboard.ts 的 defs 保持一致）
    const dashSrc = fs.readFileSync(path.join(ROOT, 'src/ui/dashboard.ts'), 'utf8');
    const macroMetrics = ['population', 'employmentRate', 'avgWage', 'cpi', 'gdp', 'treasury', 'happiness', 'gini'];
    for (const m of macroMetrics) {
      if (!dashSrc.includes(`'${m}'`)) err(`dashboard.ts 里找不到指标 ${m}（体检脚本与源码已脱节）`);
      const gate = G.metricGate(m);
      if (!gate) warn(`指标 ${m} 没有名词门禁，会一直显示`);
      else if (!(gate.unlocks?.metrics ?? []).includes(m)) err(`指标 ${m} 与门禁名词 ${gate.key} 的绑定不一致`);
    }
    const perspKeys = [
      ...P.householdIndicators(st).items.map((x) => x.key),
      ...P.firmIndicators(st).items.map((x) => x.key),
    ];
    for (const m of perspKeys) {
      const gate = G.metricGate(m);
      if (!gate) warn(`视角指标 ${m} 没有名词门禁，会一直显示`);
      else if (!(gate.unlocks?.metrics ?? []).includes(m)) err(`视角指标 ${m} 与门禁名词 ${gate.key} 的绑定不一致`);
    }
    ok(`${macroMetrics.length} 个宏观指标 + ${perspKeys.length} 个视角指标，门禁绑定全部一致`);
  }

  // ── 6. 经济周期 ──
  out.push('【6】经济周期');
  if (st) {
    const s3 = new E.SimEngine().init(20261020, 'marketTown');
    const phases = {};
    let idxMin = 9, idxMax = -9, gapMin = 9, gapMax = -9;
    for (let m = 0; m < 240; m++) {
      new E.SimEngine().tick(s3);
      const b = s3.business;
      phases[b.phase] = (phases[b.phase] || 0) + 1;
      idxMin = Math.min(idxMin, b.index); idxMax = Math.max(idxMax, b.index);
      gapMin = Math.min(gapMin, b.outputGap); gapMax = Math.max(gapMax, b.outputGap);
    }
    const kinds = Object.keys(phases).length;
    if (kinds < 3) err(`240 个月只出现了 ${kinds} 种周期阶段（应 ≥3）：${JSON.stringify(phases)}`);
    else ok(`240 个月内出现 ${kinds} 种阶段：${Object.entries(phases).map(([k, v]) => `${k} ${v}月`).join(' · ')}`);
    if (idxMax - idxMin < 0.6) err(`景气指数波动过小（${idxMin.toFixed(2)}~${idxMax.toFixed(2)}），周期不明显`);
    else ok(`景气指数区间 ${idxMin.toFixed(2)} ~ ${idxMax.toFixed(2)}`);
    if (!(gapMax > 0.01 && gapMin < -0.01)) err(`产出缺口没有跨越 0（${gapMin.toFixed(3)}~${gapMax.toFixed(3)}）`);
    else ok(`产出缺口 ${(gapMin * 100).toFixed(1)}% ~ ${(gapMax * 100).toFixed(1)}%（跨过热与过冷两侧）`);
  }

  out.push('');
  out.push(`──────── 体检结果 ────────`);
  out.push(`错误 ${errors.length} 项 · 提醒 ${warns.length} 项`);
  out.push(errors.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
  console.log(out.join('\n'));
  process.exit(errors.length === 0 ? 0 : 1);
})().catch((e) => { console.error('FAIL: ' + (e.stack || e.message)); process.exit(1); });
