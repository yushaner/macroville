// 入口：装配仿真引擎与 UI，驱动时间循环。
//
// 界面上的几个关键改动：
//   · 顶栏是「随视角切换的实时变量条」，点开有详情与累积曲线；
//   · 侧栏三块面板（政策/指标/图谱）合并成页签，不再纵向堆叠把页面撑爆；
//   · 侧栏宽度可拖、整体界面可缩放，不再需要把浏览器缩到 60% 才看得全；
//   · 开局先选「城市蓝图」与循环轮数，玩法从「挂机」变成「设参数 → 看涌现」。

import './style.css';
import { people, unitHelpHtml } from './data/units';
import { SimEngine } from './sim/engine';
import { MapView, TILE_COLORS, LAYERS, tileDetail, type LayerId } from './ui/map';
import { Dashboard } from './ui/dashboard';
import { KnowledgePanel } from './ui/knowledge';
import { Controls } from './ui/controls';
import { Hud } from './ui/hud';
import { CycleStatus } from './ui/cycleStatus';
import { QuizStatus, openTermQuiz } from './ui/quiz';
import { initModal, showModal, setModalHooks, isModalOpen } from './ui/modal';
import { openSaveDialog } from './ui/saveDialog';
import { openSetup, DEFAULT_SETUP, type SetupResult } from './ui/setup';
import type { LeverScope } from './data/levers';
import { migrateLegacy } from './state/save';
import { loadQuizProfile, mergeQuiz, saveQuizProfile } from './state/quiz';
import {
  stageProgress,
  STAGES,
  stageById,
  stageIndex,
  unlockedPerspectives,
  isPerspectiveUnlocked,
  perspectiveGate,
  orientationInfo,
} from './sim/stages';
import { cycleProgress, markPhaseVisited, PHASE_LABEL } from './sim/cycles';
import type { Perspective, SimState } from './sim/types';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

const canvas = $('city-canvas') as HTMLCanvasElement;
const hudEl = $('hud');
const controlsEl = $('controls');
const dashboardEl = $('dashboard');
const knowledgeEl = $('knowledge');
const policyEl = $('policy');
const modalEl = $('concept-modal') as HTMLElement;
const sideEl = $('side');

initModal(modalEl);
migrateLegacy(); // 旧版单槽存档迁到槽位制

// 学习成果跨局留存：开新城市不清零已经学会的名词与奖杯
const quizProfile = loadQuizProfile();

const engine = new SimEngine();
let setup: SetupResult = { ...DEFAULT_SETUP };

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// 把「本局进度」与「跨局档案」合并后再交给 UI / 存档
function syncQuiz(): void {
  state.quiz = mergeQuiz(state.quiz, quizProfile);
  saveQuizProfile(state.quiz);
  quizStatus.update(state);
}

function newGame(r: SetupResult, seed = randomSeed()): void {
  const carry = state ? state.quiz : null;
  state = engine.init(seed, r.blueprint);
  if (carry) state.quiz = mergeQuiz(carry, quizProfile);
  else if (quizProfile) state.quiz = quizProfile;
  state.cycle.roundsPlanned = r.rounds;
  perspective = 'household';
  seenPerspectives = unlockedPerspectives(state);
  controls.setScope(perspective);
  dashboard.setPerspective(perspective);
  hud.setPerspective(perspective);
  controls.syncFrom(state);
  fullRender();
}

let state: SimState = engine.init(randomSeed(), setup.blueprint);
state.cycle.roundsPlanned = setup.rounds;
if (quizProfile) state.quiz = quizProfile;

const tileInfoEl = $('tile-info');
const mapView = new MapView(canvas, {
  // 点击地块 → 展示这一格的实时属性；随每月推进自动刷新
  onSelect: () => renderTileInfo(),
});
const dashboard = new Dashboard(dashboardEl, { onTerm: showTerm });
const knowledge = new KnowledgePanel(knowledgeEl, {
  onQuizDone: (s) => {
    saveQuizProfile(s.quiz);
    quizStatus.update(s);
  },
});
const hud = new Hud(hudEl, { onTerm: showTerm });
const cycleStatus = new CycleStatus($('cycle-status'));
const quizStatus = new QuizStatus($('quiz-status'), {
  onDone: (s) => {
    if (s) syncQuiz();
    knowledge.render(state);
  },
});

let speed = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
let perspective: Perspective = 'household'; // 开局是普通居民，随城市成长再接管企业、政府
// 弹窗自动暂停前的速度；null 表示玩家自己按的暂停，关闭弹窗后不该替他恢复
let resumeSpeed: number | null = null;

// 弹窗打开 → 暂停；关闭 → 恢复。概念卡、术语释义、规则说明都走这条路径。
setModalHooks(
  () => {
    if (speed > 0) {
      resumeSpeed = speed;
      controls.pause();
    }
  },
  () => {
    if (resumeSpeed !== null) {
      controls.resume(resumeSpeed);
      resumeSpeed = null;
    }
  },
);

// 专业名词释义弹窗：统一走知识面板，未解锁时给定义与解锁条件
function showTerm(key: string): void {
  knowledge.openTerm(key, state);
}

// 新解锁名词的提示：一次只会有一个（解锁引擎保证），所以直接说清楚"因为什么"
function announceUnlocks(list: { name: string; reason: string; tier: number }[]): void {
  if (!list || list.length === 0) return;
  for (const u of list) {
    flash(`📖 第 ${u.tier} 层概念「${u.name}」解锁：${u.reason}`);
  }
}

// 游戏内说明弹窗
function showRules(): void {
  showModal(`
    <div class="chapter">游戏说明</div>
    <h2>MacroVille · 微观城邦</h2>
    <p>一座开源的城市经济沙盒。你先设定一座城市的初始条件，再用政策杠杆干预它，看它自己生长、波动、涌现。没有输赢，只有理解与意外。</p>
    <h4>三大主体如何互动</h4>
    <p><b>家庭</b>提供劳动并消费；<b>企业</b>雇佣、生产、定价；<b>政府</b>收税、支出、建基建。三者循环往复，宏观指标自下而上涌现。</p>
    <h4>循环式玩法</h4>
    <p>一轮 = <b>个人 → 企业 → 政府</b> 各主导一段，走完回到个人视角进入下一轮，共 ${setup.rounds} 轮。因为企业和政府的参数会反过来改变家庭面对的物价、工资与税率，第二轮回到个人视角时，你看到的已经不是同一道题。</p>
    <p>概念按轮次分层解锁：<b>一轮只放一层</b>，且一次只点亮一个、隔几个月才来下一个。每次解锁都会告诉你"是因为你做了什么"。</p>
    <h4>经济周期：城市也有天气</h4>
    <p>顶栏左侧常驻<b>周期指示器</b>：繁荣 🔥 → 衰退 📉 → 萧条 🥶 → 复苏 🌱。它由内生的存货周期、随机的外部冲击，以及<b>你的政策</b>三者合成。</p>
    <p>福利、公共支出、税率是<b>自动稳定器</b>（拧高它们，衰退的谷底被削平）；产业补贴、扩产意愿、库存策略、贸易开放度是<b>放大器</b>（拧高它们，繁荣更热、衰退更深）。点开指示器能看到景气指数与产出缺口的完整曲线。</p>
    <h4>闯关问答：把"见过"变成"学会"</h4>
    <p>每解锁一个名词，就会弹出<b>简介 + 一道题</b>（题型参考中级经济师《经济基础知识》）。答对积分、累计奖杯，全部名词都答对一遍，就相当于把中级经济师的主干知识点走了一遍。点顶栏 🎓 可以随时查看学习档案、重做错题。</p>
    <h4>怎么读这张地图</h4>
    <p>中心是 CBD，向外依次是内城住宅、住商混合、工业带（只在下风向）、绿带；电厂在下风向远郊、水厂在上风向、学校与医院按服务半径铺开。视野随城市长大逐步拉远。</p>
    <h4>数值口径</h4>
    <p>所有数字都按现实单位标定：钱是<b>元</b>、时间是<b>月</b>、人口是<b>常住人口（人）</b>、物资按<b>件</b>、土地按<b>元/㎡</b>。点顶栏「单位」可以看到每个量的算法与现实参照。</p>
    <h4>基本规则</h4>
    <p>① 时间按月推进；② 顶栏的变量条随视角切换，点开有详情与累积曲线；③ 拖动政策滑杆改变约束；④ 涌现优先于脚本——繁荣或衰退都是参数自然跑出来的结果。</p>
    <button class="close" data-close>开始游戏</button>
  `);
}

// 顶栏「规则」按钮
const rulesBtn = document.createElement('button');
rulesBtn.textContent = '规则';
rulesBtn.className = 'rules-btn';
rulesBtn.addEventListener('click', showRules);
controlsEl.parentNode!.insertBefore(rulesBtn, controlsEl);

// 顶栏「单位」按钮：讲清楚每个数是什么口径、对应现实里的多大
const unitsBtn = document.createElement('button');
unitsBtn.textContent = '单位';
unitsBtn.className = 'rules-btn';
unitsBtn.title = '每个数字的单位与量级参照';
unitsBtn.addEventListener('click', () => showModal(unitHelpHtml()));
controlsEl.parentNode!.insertBefore(unitsBtn, controlsEl);

// ── 界面缩放滑轨：不用再缩放浏览器 ──
const zoomBox = document.createElement('div');
zoomBox.className = 'zoom-box';
zoomBox.innerHTML =
  `<label title="整体缩放界面，内容多时可以调小">界面</label>` +
  `<input type="range" min="70" max="140" step="5" value="100" />` +
  `<span class="zv">100%</span>`;
const zoomInput = zoomBox.querySelector('input') as HTMLInputElement;
const zoomVal = zoomBox.querySelector('.zv') as HTMLElement;
zoomInput.addEventListener('input', () => {
  const v = Number(zoomInput.value);
  document.documentElement.style.setProperty('--ui-zoom', String(v / 100));
  zoomVal.textContent = `${v}%`;
  // zoom 会改变可用像素，必须让地图重新按面板大小排一次
  setTimeout(() => mapView.render(state), 0);
});
controlsEl.parentNode!.appendChild(zoomBox);

// ── 侧栏宽度可拖 ──
const splitter = $('splitter');
let dragging = false;
splitter.addEventListener('mousedown', (e) => {
  dragging = true;
  splitter.classList.add('dragging');
  e.preventDefault();
});
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const w = Math.max(280, Math.min(window.innerWidth - 420, window.innerWidth - e.clientX));
  sideEl.style.width = `${w}px`;
  mapView.render(state);
});
window.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  splitter.classList.remove('dragging');
});

// ── 侧栏页签：政策 / 指标 / 图谱 ──
const sideTabs = $('side-tabs');
sideTabs.querySelectorAll<HTMLElement>('.st').forEach((b) => {
  b.addEventListener('click', () => {
    const pane = b.dataset.pane;
    sideTabs.querySelectorAll('.st').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll<HTMLElement>('.pane').forEach((p) => {
      p.classList.toggle('active', p.id === `pane-${pane}`);
    });
    if (pane === 'dash') dashboard.update(state);
    if (pane === 'know') knowledge.render(state);
  });
});

function activatePane(pane: 'policy' | 'dash' | 'know'): void {
  const b = sideTabs.querySelector<HTMLElement>(`.st[data-pane="${pane}"]`);
  b?.click();
}

// —— 三视角渐进解锁：个人（开局）→ 企业（集镇）→ 政府（中等城市）——
const PERSPECTIVE_ORDER: Perspective[] = ['household', 'firm', 'gov'];
const PERSPECTIVE_META: Record<
  Perspective,
  { label: string; icon: string; who: string; duty: string; watch: string }
> = {
  household: {
    label: '个人视角',
    icon: '🧑',
    who: '你是一名普通居民',
    duty: '决定怎么花钱、要不要找工作、要不要练技能',
    watch: '可支配收入、生活水平、家庭财富、抗风险缓冲',
  },
  firm: {
    label: '企业视角',
    icon: '🏭',
    who: '你是一家企业的经营者',
    duty: '决定卖什么价、开多少工资、要不要扩产、投多少研发',
    watch: '平均利润、产能利用率、平均售价、总营收',
  },
  gov: {
    label: '政府视角',
    icon: '🏛',
    who: '你是这座城市的治理者',
    duty: '决定税率、公共支出、补贴与贸易政策',
    watch: 'GDP、失业率、CPI、财政余额、基尼系数、幸福度',
  },
};

const tabsEl = $('tab-group');
const tabButtons = new Map<Perspective, HTMLButtonElement>();
let seenPerspectives: Perspective[] = [];

(function buildTabs() {
  tabsEl.innerHTML = '';
  for (const p of PERSPECTIVE_ORDER) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.p = p;
    btn.addEventListener('click', () => {
      if (!isPerspectiveUnlocked(state, p)) {
        showLockedPerspective(p);
        return;
      }
      if (p === perspective) return;
      switchPerspective(p);
    });
    tabsEl.appendChild(btn);
    tabButtons.set(p, btn);
  }
})();

function switchPerspective(p: Perspective): void {
  perspective = p;
  markPhaseVisited(state, p);
  syncTabs();
  controls.setScope(p);
  dashboard.setPerspective(p);
  hud.setPerspective(p);
  fullRender();
}

function syncTabs(): void {
  for (const p of PERSPECTIVE_ORDER) {
    const btn = tabButtons.get(p)!;
    const ok = isPerspectiveUnlocked(state, p);
    const m = PERSPECTIVE_META[p];
    btn.classList.toggle('locked', !ok);
    btn.classList.toggle('active', ok && p === perspective);
    if (ok) {
      btn.innerHTML = `<span class="tab-icon">${m.icon}</span>${m.label}`;
      btn.title = `${m.who}：${m.duty}`;
    } else {
      const gate = perspectiveGate(p);
      btn.innerHTML = `<span class="tab-icon">🔒</span>${m.label}<span class="tab-sub">${
        gate ? gate.name : '未知'
      }解锁</span>`;
      btn.title = '尚未解锁，点击查看解锁条件';
    }
  }
}

function showLockedPerspective(p: Perspective): void {
  const m = PERSPECTIVE_META[p];
  const gate = perspectiveGate(p);
  const need = gate
    ? `城市发展到「${gate.name}」（常住人口 ≥ ${people(gate.minPop)}，且已存续 ≥ ${gate.minMonths} 个月）`
    : '继续推进游戏进程';
  showModal(`
    <div class="chapter">视角未解锁</div>
    <h2>${m.icon} ${m.label}</h2>
    <p>游戏从<b>个人视角</b>开始——你先是这座城市里的一名普通居民。随着城市长大，你才有机会站到企业经营者、再到城市治理者的位置上。</p>
    <h4>解锁条件</h4>
    <p>${need}。</p>
    <p class="muted">当前常住人口 ${people(state.indicators.population)}（${state.households.length.toLocaleString('zh-CN')} 户）· 已存续 ${state.month} 个月 · 阶段「${
      STAGES[stageIndex(state.stage)].name
    }」</p>
    <h4>解锁后你能做什么</h4>
    <p><b>${m.who}</b>：${m.duty}。</p>
    <p>重点关注：${m.watch}。</p>
    <button class="close" data-close>知道了</button>
  `);
}

function showPerspectiveUnlock(p: Perspective): void {
  const m = PERSPECTIVE_META[p];
  showModal(`
    <div class="chapter">新视角解锁</div>
    <h2>${m.icon} ${m.label}</h2>
    <p>城市长大了，你现在可以换一个身份看它——<b>${m.who}</b>。</p>
    <h4>你要做的决策</h4>
    <p>${m.duty}。</p>
    <h4>重点关注</h4>
    <p>${m.watch}。</p>
    <p class="muted">提示：三种视角操作的是<b>同一座城市</b>。你在企业视角提高工资，会以成本的形式反映到政府视角的物价与就业上。</p>
    <button class="close" data-close>开始体验</button>
  `);
}

// 每月检查是否有新视角解锁：刚解锁时自动切过去并弹窗说明
function checkPerspectiveUnlock(): void {
  const list = unlockedPerspectives(state);
  const fresh = list.filter((p) => !seenPerspectives.includes(p));
  seenPerspectives = list;
  // 开局那次（个人视角）不弹窗，避免一进场就被打断
  if (fresh.length === 1 && fresh[0] === 'household') return;
  if (fresh.length > 0) {
    const p = fresh[fresh.length - 1];
    switchPerspective(p);
    showPerspectiveUnlock(p);
  }
}

// 循环轮次提示：换视角 / 进入下一轮都告诉玩家接下来该看什么
function announceCycle(ev: { kind: 'phase' | 'round'; phase: Perspective; round: number }): void {
  const m = PERSPECTIVE_META[ev.phase];
  if (ev.kind === 'round') {
    switchPerspective(ev.phase);
    showModal(`
      <div class="chapter">第 ${ev.round} 轮循环开始</div>
      <h2>🔁 回到${m.label}</h2>
      <p>上一轮你在企业视角拧过的工资与加价、在政府视角定下的税率与支出，
        已经悄悄改写了这座城市。现在回到<b>${m.who}</b>的位置，你会发现同一批数字已经不是上一轮的模样。</p>
      <h4>这一轮你会看到什么</h4>
      <p>第 ${ev.round} 轮会放出<b>更深一层</b>的概念。它们仍然是同一个主体之间的博弈，只是换了个切面：
        比如同样是"工资"，这一轮你会看到它背后的<b>成本推动</b>与<b>预期</b>。</p>
      <h4>这一轮你要做的</h4>
      <p>${m.duty}。重点关注：${m.watch}。</p>
      <button class="close" data-close>继续</button>
    `);
    flash(`🔁 进入第 ${ev.round} 轮循环 · ${PHASE_LABEL[ev.phase]}`);
  } else {
    switchPerspective(ev.phase);
    flash(`🔄 本轮轮到${PHASE_LABEL[ev.phase]}：${m.who}`);
  }
}

// 地图图层切换 + 图例 + 地块详情
let mapLayer: LayerId = 'usage';

(function buildMapTools() {
  const tools = $('map-tools');
  for (const l of LAYERS) {
    const b = document.createElement('button');
    b.className = 'layer-btn' + (l.id === mapLayer ? ' active' : '');
    b.textContent = l.label;
    b.title = l.hint;
    b.addEventListener('click', () => {
      mapLayer = l.id;
      mapView.setLayer(mapLayer);
      tools.querySelectorAll('.layer-btn').forEach((x) => x.classList.toggle('active', x === b));
      buildLegend();
      fullRender();
    });
    tools.appendChild(b);
  }
})();

function buildLegend(): void {
  const lg = $('map-legend');
  if (mapLayer === 'usage') {
    const items: [string, string][] = [
      ['居民区', TILE_COLORS.residential],
      ['商业区', TILE_COLORS.commercial],
      ['工业区', TILE_COLORS.industrial],
      ['道路', TILE_COLORS.road],
      ['电力', TILE_COLORS.power],
      ['供水', TILE_COLORS.water],
      ['学校', TILE_COLORS.school],
      ['医院', TILE_COLORS.hospital],
      ['空地', TILE_COLORS.empty],
      ['企业·有雇员', '#9be29b'],
      ['企业·无雇员', '#e29b9b'],
    ];
    lg.innerHTML =
      `<div class="lg-title">色块含义 <span class="lg-sub">亮度=等级 · 棕色=污染</span></div>` +
      items
        .map(([label, color]) => `<div class="lg-item"><span class="lg-sw" style="background:${color}"></span>${label}</div>`)
        .join('');
  } else {
    const l = LAYERS.find((x) => x.id === mapLayer)!;
    lg.innerHTML = `
      <div class="lg-title">${l.label}图层</div>
      <div class="lg-bar"></div>
      <div class="lg-scale"><span>低</span><span>高</span></div>
      <div class="lg-note">${l.hint}</div>`;
  }
}

function renderTileInfo(): void {
  const i = mapView.getSelected();
  if (i === null) {
    tileInfoEl.classList.add('hidden');
    return;
  }
  tileInfoEl.classList.remove('hidden');
  tileInfoEl.innerHTML =
    `<div class="ti-head"><b>地块详情</b><button class="ti-close" data-close-tile>×</button></div>` +
    tileDetail(state, i);
}

tileInfoEl.addEventListener('click', (e) => {
  if ((e.target as HTMLElement).closest('[data-close-tile]')) {
    mapView.clearSelection();
    renderTileInfo();
  }
});

// 发展阶段条：当前阶段 + 通往下一阶段的进度 + 城市定位
function renderStage(): void {
  const { cur, next, ratio, pop, months } = stageProgress(state);
  const view = stageById(state.stage).viewRadius ?? 20;
  const oi = orientationInfo(state.orientation);
  const el = $('stage-bar');
  const steps = STAGES.map(
    (s, i) =>
      `<span class="stage-step ${i <= stageIndex(state.stage) ? 'on' : ''}" title="${s.name}">${s.icon}</span>`,
  ).join('<span class="stage-arrow">›</span>');
  el.innerHTML = `
    <div class="stage-head">
      <span class="stage-icon">${cur.icon}</span><b>${cur.name}</b>
      <span class="stage-orient" title="${oi.desc}">${oi.icon} ${oi.name}</span>
      <span class="stage-steps">${steps}</span>
    </div>
    <div class="stage-track"><div class="stage-fill" style="width:${(ratio * 100).toFixed(1)}%"></div></div>
    <div class="stage-meta">${
      next
        ? `距「${next.name}」还差：人口 ${people(Math.max(0, next.minPop - pop))}${months < next.minMonths ? ` · 存续 ${next.minMonths - months} 个月` : ''}`
        : '已达最高阶段 · 全境开发'
    }</div>
    <div class="stage-meta" style="margin-top:2px">${cur.desc}</div>
    <div class="stage-meta" style="margin-top:2px">地图视野 <b>${view * 2 + 1}×${view * 2 + 1}</b> 格 · 随城市成长逐步拉远</div>`;
}

// 循环进度条：第几轮 + 当前主导视角 + 还要多久换视角
function renderCycle(): void {
  const c = cycleProgress(state);
  const el = $('cycle-bar');
  const dots = Array.from({ length: c.roundsPlanned }, (_, i) => {
    const cls = i + 1 < c.round ? 'on' : i + 1 === c.round ? 'now' : '';
    return `<span class="cb-dot ${cls}"></span>`;
  }).join('');
  const phase = PHASE_LABEL[c.phase];
  el.innerHTML = `
    <span class="cb-round">轮次 ${dots} <b>第 ${c.round} / ${c.roundsPlanned} 轮</b></span>
    <span class="cb-sep">|</span>
    <span>本轮主导 <b>${phase}</b>（已 ${c.phaseMonths} 个月）</span>
    ${c.finished ? '<span class="cb-note">· 全部轮次已完成，深层概念全部开放</span>' : `<span class="cb-sep">|</span><span>约 <b>${c.needMonths}</b> 个月后切换到下一站</span>`}`;
}

function fullRender(): void {
  mapView.render(state);
  dashboard.update(state);
  knowledge.render(state);
  hud.update(state);
  cycleStatus.update(state);
  quizStatus.update(state);
  controls.refreshLevers(state);
  renderStage();
  renderCycle();
  syncTabs();
  renderTileInfo();
}

// 待答的闯关题：解锁名词时入队，等没有别的弹窗占着屏幕再弹。
// 同一月里既升级阶段又解锁名词时，不会互相把对方的弹窗顶掉。
let pendingQuiz: string[] = [];

function drainQuiz(): boolean {
  if (pendingQuiz.length === 0) return false;
  if (isModalOpen()) return false;
  const key = pendingQuiz.shift()!;
  openTermQuiz(state, key, {
    onDone: () => {
      saveQuizProfile(state.quiz);
      quizStatus.update(state);
      knowledge.render(state);
      // 队列里还有题就接着弹，一次只弹一道
      if (pendingQuiz.length) setTimeout(drainQuiz, 260);
    },
  });
  return true;
}

function step(): void {
  if (drainQuiz()) return;
  const res = engine.tick(state);
  mapView.render(state);
  dashboard.update(state);
  knowledge.render(state);
  hud.update(state);
  cycleStatus.update(state);
  quizStatus.update(state);
  controls.refreshLevers(state);
  renderStage();
  renderCycle();
  syncTabs();
  renderTileInfo();
  // 阶段变化提示：升级/衰退都告诉玩家城市发生了什么
  if (res.stageChange) {
    const c = res.stageChange;
    flash(c.up ? `${c.icon} 城市升级为「${c.name}」：${c.unlockNote}` : `⚠ 城市衰退为「${c.name}」：人口外流`);
  }
  // 概念卡由 showModal 统一暂停；关闭后自动恢复运行
  if (res.triggered.length > 0) {
    knowledge.showConcept(res.triggered[0].id);
  }
  // 新名词解锁先提示（比阶段提示更贴近玩家刚才的操作），随后立刻弹出
  // 「简介 + 闯关问答」——解锁只是"见过"，答对才算"学会"。
  announceUnlocks(res.unlocked ?? []);
  if (res.unlocked) for (const u of res.unlocked) pendingQuiz.push(u.key);
  // 循环轮转放在最后：它会切换 tab 并可能弹窗
  if (res.cycleEvent) announceCycle(res.cycleEvent);
  // 新视角解锁：切换 tab 并弹窗（弹窗自动暂停）
  checkPerspectiveUnlock();
  // 最后再弹闯关题：若上面刚弹了视角/轮次说明，这一道会排队等下一次
  drainQuiz();
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  if (speed > 0) {
    timer = setTimeout(() => {
      step();
      schedule();
    }, 1000 / speed);
  }
}

const controls = new Controls({
  controlsEl,
  policyEl,
  onSpeed: (s) => {
    speed = s;
    schedule();
  },
  // 统一入口：三视角旋钮都经 engine.applyLever 落到对应主体。
  // 拧完立刻结算一次解锁并刷新面板，让「我调了这个 → 学到了那个」当场可见。
  onLever: (scope: LeverScope, target: string, value: number) => {
    const fresh = engine.applyLever(state, scope, target, value) ?? [];
    dashboard.update(state);
    knowledge.render(state);
    hud.update(state);
    cycleStatus.update(state);
    controls.refreshLevers(state);
    renderStage();
    announceUnlocks(fresh);
    // 拧旋钮当场点亮名词时，也当场把题弹出来——"我调了这个 → 学到了这个"
    for (const u of fresh) pendingQuiz.push(u.key);
    if (fresh.length) setTimeout(drainQuiz, 60);
  },
  onSave: () => openSaveDialog({ getState: () => state, onLoad: applyLoaded, toast: flash }, 'save'),
  onLoad: () => openSaveDialog({ getState: () => state, onLoad: applyLoaded, toast: flash }, 'load'),
  onReset: () => {
    openSetup(setup, (r) => {
      setup = r;
      newGame(r);
      flash(`已开新局：${r.blueprint} · ${r.rounds} 轮`);
    });
  },
  onTerm: showTerm,
});

function applyLoaded(s: SimState): void {
  state = engine.normalize(s);
  // 读档后把跨局学习档案并进来，避免旧存档把已学会的名词打回"未答"
  state.quiz = mergeQuiz(state.quiz, quizProfile);
  saveQuizProfile(state.quiz);
  // 读档后按存档进度重新播种视角集合；若当前视角还没解锁就退回最高已解锁视角
  seenPerspectives = unlockedPerspectives(state);
  if (!isPerspectiveUnlocked(state, perspective)) {
    perspective = seenPerspectives[seenPerspectives.length - 1] ?? 'household';
  }
  controls.setScope(perspective);
  dashboard.setPerspective(perspective);
  hud.setPerspective(perspective);
  controls.syncFrom(state); // 强制重建滑杆，否则读档后仍显示旧值
  fullRender();
}

// 提示独立成 toast：之前挂在顶栏里会被每帧 updateStats 的 innerHTML 冲掉，看着像没反应
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function flash(msg: string): void {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t?.classList.remove('show'), 2000);
}

controls.setScope(perspective);
dashboard.setPerspective(perspective);
hud.setPerspective(perspective);
buildLegend();
seenPerspectives = unlockedPerspectives(state); // 播种，避免开局把「个人视角」当成新解锁弹窗
fullRender();

// 地图格子大小是按面板可用空间算的，窗口或侧栏变化时必须重排一次
window.addEventListener('resize', () => {
  mapView.render(state);
});

// 首次进入：先选蓝图与轮数，再真正开局
openSetup(setup, (r) => {
  setup = r;
  newGame(r);
});
