// 无浏览器冒烟测试：用最小 DOM 桩执行 preview.html 的内联脚本。
// 覆盖：初始化 → 点 4× 启动 → 切六个图层 → 切三个视角 Tab → 点格子看详情 → 长跑 300 月。
// 用法：node tools/smoke-preview.cjs   （失败时 exit 1）
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'preview.html'), 'utf8');
const termsJson = (html.match(/<script id="terms-data"[^>]*>([\s\S]*?)<\/script>/) || [, '[]'])[1];
const quizJson = (html.match(/<script id="quiz-data"[^>]*>([\s\S]*?)<\/script>/) || [, '[]'])[1];

function makeEl(tag, id) {
  return {
    tagName: (tag || 'div').toUpperCase(),
    id: id || '',
    className: '',
    innerHTML: '',
    textContent: '',
    value: '',
    checked: false,
    disabled: false,
    style: {},
    dataset: {},
    children: [],
    parentNode: null,
    offsetWidth: 100, clientWidth: 100, offsetHeight: 100, clientHeight: 100,
    _listeners: {},
    appendChild(c) { this.children.push(c); if (c) c.parentNode = this; return c; },
    append(...cs) { cs.forEach((c) => this.appendChild(c)); },
    insertBefore(c) { this.children.unshift(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    replaceWith() {},
    setAttribute(k, v) { this[k] = v; },
    getAttribute(k) { return this[k]; },
    removeAttribute() {},
    hasAttribute() { return false; },
    addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatch(t, ev) {
      const e = ev || { target: this, currentTarget: this, preventDefault() {}, stopPropagation() {} };
      const inline = this['on' + t];
      if (typeof inline === 'function') inline.call(this, e);
      (this._listeners[t] || []).forEach((fn) => fn(e));
    },
    click() { this.dispatch('click'); },
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    focus() {}, blur() {},
    classList: {
      _s: new Set(),
      add(...c) { c.forEach((x) => this._s.add(x)); },
      remove(...c) { c.forEach((x) => this._s.delete(x)); },
      toggle(c) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); },
      contains(c) { return this._s.has(c); },
    },
  };
}

const byId = {};
for (const id of ['terms-data', 'quiz-data', 'city-grid', 'map-legend', 'map-tools', 'tile-info', 'tab-group',
  'dashboard', 'policy', 'knowledge', 'concept-modal', 'toast', 'controls', 'hud', 'cycle-bar',
  'stage-bar', 'splitter', 'side', 'bc-status', 'quiz-btn']) {
  byId[id] = makeEl('div', id);
}
byId['terms-data'].textContent = termsJson;
byId['quiz-data'].textContent = quizJson;
// renderPolicy 会反复 querySelector 同一批节点，桩要返回稳定对象
byId['policy'].querySelector = (s) => (byId['policy.' + s] = byId['policy.' + s] || makeEl('div'));

const document = {
  getElementById: (id) => byId[id] || (byId[id] = makeEl('div', id)),
  createElement: (t) => makeEl(t),
  querySelector: () => makeEl('div'),
  querySelectorAll: () => [],
  addEventListener() {},
  body: makeEl('body'),
  documentElement: makeEl('html'),
};

const timers = [];
const store = {};
const sandbox = {
  document, console,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  setInterval: (fn) => timers.push(fn),
  clearInterval: () => {},
  setTimeout: (fn) => timers.push(fn),
  clearTimeout: () => {},
  requestAnimationFrame: (fn) => { timers.push(fn); return 1; },
  matchMedia: () => ({ matches: false, addEventListener() {} }),
  alert: () => {},
  navigator: { userAgent: 'node' },
  JSON, Math, Date, Object, Array, String, Number, Boolean, Float32Array,
  parseInt, parseFloat, isNaN, isFinite,
  addEventListener() {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const log = [];
const fails = [];
const ok = (cond, msg) => { log.push((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails.push(msg); };

const ctx = vm.createContext(sandbox);
const probe = (expr) => {
  try { return vm.runInContext(expr, ctx, { timeout: 5000 }); }
  catch (e) { return 'PROBE_ERROR ' + e.message; }
};

// 1) 初始化
try {
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1], { filename: 'preview-inline.js' })
    .runInContext(ctx, { timeout: 10000 });
  const s0 = probe('({t:state.t,stage:state.stage,persp:perspective,open:unlockedPersp(),view:viewSize,' +
    'round:state.cycle.round,planned:state.cycle.roundsPlanned,orient:state.orientation,' +
    'seeded:state.unlocked.length,tiers:TERMS.filter(t=>t.tier===1).length})');
  ok(s0 && s0.stage === 'hamlet', 'INIT stage=hamlet ' + JSON.stringify(s0));
  ok(s0 && s0.persp === 'household', 'INIT 默认视角=个人');
  ok(s0 && s0.open.length === 1, 'INIT 仅解锁个人视角（open=' + (s0 && s0.open) + '）');
  ok(probe("TERMS.length") >= 90, 'INIT 名词数=' + probe('TERMS.length'));
  ok(s0 && s0.view === 9, 'INIT 村落视野 9×9 = ' + (s0 && s0.view));
  ok(s0 && s0.seeded > 0 && s0.seeded <= 8, 'INIT 开局只点亮 ' + (s0 && s0.seeded) + ' 个基础词（不是一批全亮）');
  ok(s0 && s0.tiers > 0, 'INIT 第 1 层概念数=' + (s0 && s0.tiers));
} catch (e) {
  fails.push('INIT ' + e.message);
  log.push('FAIL INIT ' + e.message);
}

// 2) 启动演示
try {
  const fast = (byId['controls'].children || []).find((b) => b.dataset && b.dataset.speed === '4');
  ok(!!fast, 'CONTROLS 找到 4× 按钮');
  if (fast) fast.click();
  ok(probe('timer !== null'), 'CONTROLS 计时器已启动');
  // 直接拿 tick 引用推进：timers 末尾会被 toast 的 setTimeout 顶掉
  const tickRef = probe('tick');
  for (let i = 0; i < 14; i++) tickRef();
  ok(probe('state.t') >= 14, 'TICK 推进 ' + probe('state.t') + ' 个月');
} catch (e) {
  fails.push('TICK ' + e.message);
  log.push('FAIL TICK ' + e.message);
}

// 2b) 可选：DUMP_INIT=1 打印「开局 + 12 个月」的三视角快照。
// 这是玩家真正第一眼看到的画面，量级对不对全看这里（长跑之后的极端值不能拿来验收）。
if (process.env.DUMP_INIT) {
  const flat = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  try {
    probe('for (let i = 0; i < 12; i++) tick(); 1');
    for (const p of ['household', 'firm', 'gov']) {
      const hud = flat(probe(`(function(){ perspective='${p}'; renderHud(); return document.getElementById('hud').innerHTML })()`));
      const dash = flat(probe(`(function(){ perspective='${p}'; renderDash(); return document.getElementById('dashboard').innerHTML })()`));
      console.log(`
── ${p} ──
顶栏：${hud}
仪表盘：${dash}`);
    }
    const tile = flat(probe('(function(){ const i=tiles.findIndex(t=>t.dev&&t.type==="c"); selected=i<0?0:i; renderTileInfo(); return document.getElementById("tile-info").innerHTML })()'));
    console.log('── 地块详情 ──\n' + tile);
  } catch (e) {
    console.log('DUMP_INIT 失败：' + e.message);
  }
}

// 3) 六个图层
try {
  const btns = byId['map-tools'].children || [];
  ok(btns.length === 6, 'LAYERS 按钮数=' + btns.length);
  const seen = new Set();
  btns.forEach((b) => { b.click(); seen.add(probe('layer')); });
  ok(seen.size === 6, 'LAYERS 六种图层均可切换 [' + [...seen].join(',') + ']');
} catch (e) {
  fails.push('LAYERS ' + e.message);
  log.push('FAIL LAYERS ' + e.message);
}

// 4) 点击格子 → 详情面板
try {
  // DOM 桩里 innerHTML='' 不会清空 children，所以先手动清一次再重建，才能数准
  const vs = probe('viewSize');
  const n = probe('(function(){ const g=document.getElementById("city-grid"); g.children.length=0; buildGrid(true); return g.children.length })()');
  const cells = byId['city-grid'].children || [];
  ok(n === vs * vs, 'TILES 取景格数=' + n + '（视野 ' + vs + '×' + vs + '）');
  cells[100].click();
  const info = String(byId['tile-info'].innerHTML || '');
  ok(info.length > 100, 'TILES 详情面板已填充 len=' + info.length);
  ok(/地价/.test(info) && /污染/.test(info), 'TILES 详情含地价/污染字段');
} catch (e) {
  fails.push('TILES ' + e.message);
  log.push('FAIL TILES ' + e.message);
}

// 5) 长跑 300 月：阶段推进 / 视角解锁 / 指标不失控
try {
  const tickFn = probe('tick');
  ok(typeof tickFn === 'function', 'LONGRUN 取得 tick 引用');
  for (let i = 0; i < 300; i++) tickFn();
  const s = probe('({t:state.t,stage:state.stage,peak:state.peak,pop:Math.round(state.pop),' +
    'cpi:+state.cpi.toFixed(1),persp:perspective,open:unlockedPersp(),dev:tiles.filter(x=>x.dev).length,' +
    'val:Math.round(tiles.reduce((a,x)=>a+x.value,0)/tiles.length),' +
    'unlocked:state.unlocked.length,view:viewSize,round:state.cycle.round,orient:state.orientation,' +
    'series:state.series.avgProfit.length,bank:state.bankruptcies})');
  log.push('  …长跑结果 ' + JSON.stringify(s));
  ok(s && s.t >= 300, 'LONGRUN tick 计数=' + (s && s.t));
  ok(s && s.stage === 'globalCity', 'LONGRUN 阶段=' + (s && s.stage));
  ok(s && s.open.length === 3, 'LONGRUN 三视角全解锁=' + (s && s.open));
  ok(s && s.cpi > 60 && s.cpi < 220, 'LONGRUN CPI 在合理区间=' + (s && s.cpi));
  ok(s && s.dev > 300, 'LONGRUN 已建成地块=' + (s && s.dev));
  ok(!/PROBE_ERROR/.test(String(probe('typeof paintCity'))), 'LONGRUN 渲染函数仍可用');
  // 关键：纯挂机 300 月不该把 90 条名词刷满，否则「解锁靠挂机」的老问题就回来了
  ok(s && s.unlocked < 90, 'LONGRUN 挂机未刷满名词 ' + (s && s.unlocked) + '/90');
  ok(s && s.view === 41, 'LONGRUN 视野随阶段拉到 ' + (s && s.view) + '×' + (s && s.view));
  ok(s && s.round >= 2, 'CYCLE 300 月内至少进入第 ' + (s && s.round) + ' 轮');
  ok(s && s.series > 100, 'SERIES 累积曲线已记录 ' + (s && s.series) + ' 个月');
} catch (e) {
  fails.push('LONGRUN ' + e.message);
  // 带上调用栈前两帧：长跑报错时，只看 message 往往定位不到是哪个渲染函数炸的
  const at = String(e.stack || '').split('\n').slice(1, 3).map((x) => x.trim()).join(' ← ');
  log.push('FAIL LONGRUN ' + e.message + (at ? '  @ ' + at : ''));
}

// 5b) 决策联动：主动拧旋钮 → 当场点亮更多名词
try {
  const before = probe('state.unlocked.length');
  // 解锁带冷却（两次之间至少隔 UNLOCK_GAP 个月），长跑结束时可能正好落在冷却里。
  // 这里要测的是「拧旋钮 → 条件满足 → 当场点亮」，所以先把冷却清掉。
  probe('state.cycle.lastUnlockMonth = -99; 1');
  const moved = probe(`(function(){
    const hits = [];
    for (const l of LEVERS) {
      const scope = PARAMS[SCOPE_KEY[l.scope === 'gov' ? 'gov' : l.scope]];
      const v = l.max;
      scope[l.id] = v;
      const fresh = runUnlocks(false);
      if (fresh.length) hits.push(l.id + '→' + fresh.length);
      scope[l.id] = l.min;
      runUnlocks(false);
    }
    recomputeFromLevers();
    return hits.join(',');
  })()`);
  const after = probe('state.unlocked.length');
  log.push('  …拧旋钮命中 ' + moved);
  ok(after > before, 'LEVER 决策解锁 ' + before + ' → ' + after + '/90');
  ok(/→/.test(String(moved)), 'LEVER 至少有一个旋钮当场解锁了名词');
} catch (e) {
  fails.push('LEVER ' + e.message);
  log.push('FAIL LEVER ' + e.message);
}

// 5c) 顶栏变量条：随视角切换显示不同的量，且带 sparkline
try {
  const hh = probe("(function(){ perspective='household'; renderHud(); return document.getElementById('hud').innerHTML })()");
  ok(/可支配收入/.test(String(hh)) && /hc-spark/.test(String(hh)),
    'HUD 个人视角显示家庭账本 + 迷你曲线');
  const gv = probe("(function(){ perspective='gov'; renderHud(); return document.getElementById('hud').innerHTML })()");
  ok(/GDP/.test(String(gv)) && /基尼系数/.test(String(gv)), 'HUD 政府视角显示宏观盘面');
  ok(!/可支配收入/.test(String(gv)), 'HUD 切视角后变量确实换了');
  const cyc = probe("(function(){ renderCycle(); return document.getElementById('cycle-bar').innerHTML })()");
  ok(/轮次/.test(String(cyc)), 'CYCLE 循环条已渲染');
} catch (e) {
  fails.push('HUD ' + e.message);
  log.push('FAIL HUD ' + e.message);
}

// 6) 存档：自定义命名 + 列表选择读取（多槽位）
try {
  const ctrl = byId['controls'].children || [];
  const btn = (t) => ctrl.find((b) => b.textContent === t);
  ok(!!btn('存档') && !!btn('读档') && !!btn('新局'), 'SAVE 三个按钮齐全（存档/读档/新局）');

  const before = probe('({t:state.t,stage:state.stage,pop:Math.round(state.pop)})');
  // 自定义命名保存两个槽位
  const id1 = probe("saveAsSlot('我的第一座城')");
  const id2 = probe("saveAsSlot('工业试验田')");
  ok(!!id1 && !!id2 && id1 !== id2, 'SAVE 两个槽位各自独立');
  const names = probe("readIndex().map(m=>m.name).sort().join('|')");
  ok(/我的第一座城/.test(String(names)) && /工业试验田/.test(String(names)),
    'SAVE 自定义命名已保存：' + names);
  ok(probe("readIndex().length") === 2, 'SAVE 槽位数=' + probe('readIndex().length'));

  // 改名
  probe(`renameSlot('${id1}', '改名后的城市')`);
  ok(/改名后的城市/.test(String(probe("readIndex().map(m=>m.name).join('|')"))), 'SAVE 重命名生效');

  // 选择读取：读第二个槽位
  probe(`loadSlot('${id2}')`);
  const back = probe('({t:state.t,stage:state.stage,pop:Math.round(state.pop)})');
  ok(back && back.t === before.t && back.stage === before.stage,
    'LOAD 按槽位读回 ' + JSON.stringify(back));

  // 删除
  probe(`deleteSlot('${id2}')`);
  ok(probe('readIndex().length') === 1, 'SAVE 删除后剩 ' + probe('readIndex().length') + ' 个槽位');
} catch (e) {
  fails.push('SAVE ' + e.message);
  log.push('FAIL SAVE ' + e.message);
}

// 7) 经济周期 + 闯关问答（这两个系统都要在预览页里真的跑起来，不能只是代码存在）
try {
  const bc = probe(`(function(){
    const seen = {};
    for (let i = 0; i < 240; i++) { tick(); seen[state.business.phase] = 1; }
    const h = state.business.history, g = state.business.gapHistory;
    return { phases: Object.keys(seen), n: h.length,
      lo: Math.min.apply(null, h), hi: Math.max.apply(null, h),
      gapLo: Math.min.apply(null, g), gapHi: Math.max.apply(null, g),
      cycles: state.business.cycleCount };
  })()`);
  ok(bc && bc.phases.length === 4, 'BC 240 月内出现 4 种周期阶段=[' + (bc && bc.phases) + ']');
  ok(bc && bc.hi > 0.2 && bc.lo < -0.2, 'BC 景气指数有真实波动 ' + (bc && bc.lo.toFixed(2)) + ' ~ ' + (bc && bc.hi.toFixed(2)));
  ok(bc && bc.gapHi > 0.02 && bc.gapLo < -0.02, 'BC 产出缺口跨过冷/过热两侧 ' +
    (bc && (bc.gapLo * 100).toFixed(1)) + '% ~ ' + (bc && (bc.gapHi * 100).toFixed(1)) + '%');
  ok(bc && bc.cycles >= 1, 'BC 已跑完完整周期 ' + (bc && bc.cycles) + ' 轮');
  const bar = String(probe("(function(){ renderBC(); return document.getElementById('bc-status').innerHTML })()"));
  ok(/bc-phase/.test(bar) && /缺口/.test(bar), 'BC 顶栏周期条已渲染');
  const shapeMoved = probe(`(function(){
    const a = bcShape().amplitude;
    gov.industrySubsidy = 1; fp.expansion = 1; const hi = bcShape().amplitude;
    gov.industrySubsidy = 0; fp.expansion = 0; gov.welfare = 1; gov.taxRate = .5; const lo = bcShape().amplitude;
    recomputeFromLevers(); return { a, hi, lo };
  })()`);
  ok(shapeMoved && shapeMoved.hi > shapeMoved.lo, 'BC 政策能改写周期幅度（放大器 ' +
    (shapeMoved && shapeMoved.hi.toFixed(2)) + ' > 稳定器 ' + (shapeMoved && shapeMoved.lo.toFixed(2)) + '）');

  ok(probe('QUIZZES.length') === probe('TERMS.length'), 'QUIZ 每个名词一道题 ' + probe('QUIZZES.length') + ' 题');
  const g = probe(`(function(){
    const d = quizByKey('opportunityCost');
    const r = gradeAnswer('opportunityCost', d.answer);
    return { ok: r.ok, gained: r.gained, pts: state.quiz.points, correct: state.quiz.correct,
      tro: state.quiz.trophies.length, first: r.firstTry };
  })()`);
  ok(g && g.ok && g.gained > 0 && g.correct >= 1, 'QUIZ 答对得分 +' + (g && g.gained) + '（累计 ' + (g && g.pts) + ' 分）');
  ok(g && g.tro >= 1, 'QUIZ 奖杯已发放 ' + (g && g.tro) + ' 枚');
  const wrong = probe(`(function(){
    const d = quizByKey('opportunityCost');
    const bad = d.answer.map(i => i); bad[0] = (bad[0] + 1) % d.options.length;
    const r = gradeAnswer('opportunityCost', bad);
    return { ok: r.ok, tries: state.quiz.answered['opportunityCost'].tries };
  })()`);
  ok(wrong && wrong.ok === false && wrong.tries >= 2, 'QUIZ 答错不会把已答对的记录冲掉');
  const modalHtml = String(probe("(function(){ openTermQuiz('supplyDemand'); return document.getElementById('concept-modal').innerHTML })()"));
  ok(/quiz-opt/.test(modalHtml) && /基本定义/.test(modalHtml), 'QUIZ 解锁弹窗含简介 + 选项');
  const arc = String(probe("(function(){ openArchive(); return document.getElementById('concept-modal').innerHTML })()"));
  ok(/tro-grid/.test(arc) && /学习档案/.test(arc), 'QUIZ 学习档案含奖杯墙');
  ok(probe("Object.keys(state.quiz.answered).length") >= 1, 'QUIZ 答题记录已持久化');
} catch (e) {
  fails.push('BC/QUIZ ' + e.message);
  log.push('FAIL BC/QUIZ ' + e.message);
}

// 单位体检：DUMP=1 时把三视角的顶栏变量条与仪表盘摊平成文本，方便核对每个数字带没带单位。
// 这不是断言，只是给人看的一页「可读快照」。
if (process.env.DUMP) {
  const flat = (h) => String(h).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  try {
    for (const p of ['household', 'firm', 'gov']) {
      const hud = flat(probe(`(function(){ perspective='${p}'; renderHud(); return document.getElementById('hud').innerHTML })()`));
      const dash = flat(probe(`(function(){ perspective='${p}'; renderDash(); return document.getElementById('dashboard').innerHTML })()`));
      console.log(`\n── ${p} ──\n顶栏：${hud}\n仪表盘：${dash}`);
    }
  } catch (e) {
    console.log('\nDUMP 失败：' + e.message);
  }
}

log.push(fails.length ? `RESULT: FAIL(${fails.length})` : 'RESULT: PASS');
console.log(log.join('\n'));
process.exit(fails.length ? 1 : 0);
