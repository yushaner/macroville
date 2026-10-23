# MacroVille · 微观城邦

> 一个开源的**城市经济沙盒**：你定政策，底层多主体经济模型模拟家庭·企业·政府的真实互动，观察 GDP、失业、物价、民生自然涌现；并随进程从**微观 → 产业 → 宏观**解锁经济学概念——玩着玩着，经济学就不抽象了。

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

---

## 🎁 立即试玩（不用装任何东西）

**方式一 · 在线玩**：<https://yushaner.github.io/macroville/>（GitHub Pages，打开即玩）

**方式二 · 下载单机版**：[`MacroVille-v0.2.0-offline.zip`](https://github.com/yushaner/macroville/releases/download/v0.2.0/MacroVille-v0.2.0-offline.zip)
（157 KB，Releases 页 Assets）→ 解压 → 双击 `MacroVille-v0.2.0-offline.html`，**不联网也能玩**。

单个 HTML 文件（445 KB），JS/CSS 全部内联，**不联网也能玩、不依赖 Node、不上传任何数据**。
Releases 页面另有打好包的 zip；`npm run pack` 也能自己生成一个（含 `release/*.zip`）。

想看源码或改着玩，就往下走「快速开始」。

## 🙋 我们想听你的意见

这是个人项目，正在公开征求改进意见，尤其是这几条：

| 想问你 | 具体是 |
|---|---|
| 数值真实感 | 工资 / 物价 / 地价 / GDP 对得上现实吗？哪个数字一看就假？ |
| 城市长势 | 40 年长到百万人口，节奏是快是慢？建成区 121 km² 合理吗？ |
| 可玩性 | 政策滑杆的反馈够明显吗？有没有「调了半天没感觉」的旋钮？ |
| 教学有效性 | 概念卡和闯关题真的帮你理解概念了吗？题库难度如何？ |

👉 **直接开 [Issue](https://github.com/yushaner/macroville/issues/new/choose) 就行**（有模板）。
报数值问题请附上：蓝图名 + 种子 + 第几个月 + 截图。
完整的进展记录、已知问题与路线图见 [`PROGRESS.md`](PROGRESS.md)。

---

## ✨ 特性

- **多主体经济仿真**：家庭（求职/消费/储蓄）、企业（三产业·生产/定价/雇佣）、政府（税收/支出）按月演化。
- **政策沙盒**：拖动税率、最低工资、公共支出滑杆，看系统连锁反应。
- **仪表盘 + 地图**：实时指标图表 + Canvas 城市地图（只读观察）。
- **经济周期**：繁荣 / 衰退 / 萧条 / 复苏四阶段内生波动（存货周期 + AR(1) 外生冲击 + 政策调制），顶栏常驻景气指数与产出缺口，点开可看整段周期曲线。
- **政策能改写周期**：福利、公共支出、税率是**自动稳定器**（削平谷底）；产业补贴、扩产意愿、库存策略、贸易开放是**放大器**（波幅更大、周期更短）。
- **玩中学经济学**：每解锁一个概念就弹「简介 + 一道闯关题」（题型参考中级经济师《经济基础知识》），答对积分、连对有加成、达标发奖杯；学习档案跨局留存，可重做错题。
- **纯前端 / 零后端**：浏览器即开即玩，可静态部署到 GitHub Pages。
- **MIT 开源**：欢迎贡献产业、政策、概念卡与译文。

## 🚀 快速开始

```bash
npm install
npm run dev      # 本地开发，打开提示的 localhost 地址
npm run build    # 类型检查 + 生产构建，产物在 dist/
npm run preview  # 预览构建产物
```

## 🎮 玩法

1. 开局是一座程序生成的虚构城市（种子可复现）。
2. 顶部控制速度（⏸ / 1× / 2× / 4×），侧栏拖动政策滑杆。
3. 观察仪表盘指标与经济周期（顶栏左侧的阶段条）随时间演化。
4. 概念解锁时弹出「简介 + 闯关题」；答完在图谱上打勾，积分与奖杯记进顶栏「🎓」。
5. 支持多槽位存档 / 命名读档 / 重置（localStorage），答题档案跨局留存。

## 📐 数值口径（所有数字都有单位）

游戏里的每个数字都按**现实世界的量级**标定，不是抽象单位。看到「可支配收入 ¥6,024/月」你能立刻判断它相当于一个普通工薪家庭；看到「地价 ¥3,171/㎡」你能对上三四线城市的住宅楼面价。

| 量 | 单位 | 说明 | 现实锚点 |
|---|---|---|---|
| 钱 | 元（¥） | 工资、营收、财政结余；超过 1 万显示「万」、超过 1 亿显示「亿」 | 2024 年城镇非私营单位平均月薪 ¥10,342 |
| 时间 | 月 | 1 拍 = 1 个月，12 个月 = 1 年 | 开局 2026 年 1 月 |
| 人口 | 人 | 城镇常住人口；由地块承载量加总得出，仿真只跑几千户「代表性家庭样本」 | 设计规模上限 100 万人（村庄 ~2 千 → 全球城市 ~100 万） |
| 物资 | 件 | 标准品数量，价格按 ¥/件 计 | 基准价 ¥100/件 |
| 土地 | 元/㎡ | 楼面地价，由区位、配套、密度、污染共同决定 | 郊区 ¥600/㎡ → 核心 CBD ¥3,000+/㎡ |
| 指数 | 点 | CPI 以「默认政策」为基期 100，只反映相对变化 | CPI 105 点 = 物价比默认高 5% |
| 比率 | % | 就业率、税率、基尼系数一律百分比 | 基尼 0.40 为常见警戒线 |

口径定义集中在 [`src/data/units.ts`](src/data/units.ts)（格式化器 + 对照表），参数标定在 [`src/sim/config.ts`](src/sim/config.ts)，游戏内点顶栏「单位」可随时查这张表。

几个用来校验"没跑偏"的自洽关系：GDP 用**增加值**口径（营收 × 0.7，扣除中间投入，避免重复计算）；利润率落在 4%~10%；库存约 1.8 个月的产出；人均 GDP 年化 ¥3.5~4.9 万；财政赤字控制在 GDP 的 3%~5%。

## 🏙️ 空间尺度与土地规划

地图的每一格是一个**真实的规划单元**，不是一个抽象方块：

| 项目 | 口径 | 说明 |
|---|---|---|
| 街区尺度 | 250 m × 250 m | 毛用地 62,500 ㎡，扣掉街坊内支路与绿地后净用地率 70% → 可建 43,750 ㎡ |
| 容积率（FAR） | 0.7 ~ 6.0 | 按用途与开发强度分 5 级，取自各地《城市规划管理技术规定》常见区间 |
| 控规环带 | CBD / 内城 / 中环 / 外围 / 远郊 / 生态绿地 | 每个街坊的容积率**上限**由「离市中心多远」写进控规，市场只能在上限之内加建 |
| 常住人口 | 建筑面积 × 住宅占比 85% ÷ 40 ㎡/人 | 住区里不只有住宅：沿街底商、社区中心、幼儿园要占掉一成半 |
| 就业岗位 | 建筑面积 ÷ 25 ㎡/岗（商务）· ÷ 60 ㎡/岗（工业） | 一个街区能装下多家企业，岗位容量在企业间分配 |
| 道路 | 主干 45 m / 次干 30 m / 支路 15 m | 横平竖直的方格网 + 环路，带种子化随机扰动（支路按概率缺失），同一 seed 可复现 |
| 设计规模 | 100 万常住人口 | 全城控规指标加总的结果，不是拍出来的数；`tools/scale-check.cjs` 会复核 |

于是「这座城市最多装 100 万人」是一条**物理约束**：人口上限 = 住区铺满并按控规上限建成时的承载量之和。城市长大的两条路径也因此分开——**往外铺**（征地开发新区）与**往高长**（在控规上限内加建），后者还要受城市规模等级约束：村落只能盖低层，到了都会区才起超高层。

仿真不可能真的跑 38 万户家庭，所以只模拟几千户**代表性家庭样本**，每户代表 `真实户数 / 样本数` 户真实家庭——强度型指标（工资、利润率、就业率）不受影响，只有总量型指标（人口、GDP、财政）按倍率放大。

口径与算法集中在 [`src/sim/land.ts`](src/sim/land.ts)（规划指标与承载量）、[`src/sim/roadGrid.ts`](src/sim/roadGrid.ts)（路网）、[`src/sim/scale.ts`](src/sim/scale.ts)（样本倍率）。

## 🧪 自检

```bash
npm run check:all   # DOM id 校验 + 全量体检 + 预览页冒烟 + 240 月长跑
npm run audit       # 只跑体检：名词 / 条件 / 题库 / 旋钮 / 指标门禁 / 经济周期
npm run scale:check # 六张蓝图 × 480 月：承载量天花板、终局人口、密度、容积率是否对得上 100 万设计目标
npm run gen:preview # 改了 glossary.ts 或 quiz.ts 后，重新生成 preview.html 的内联数据
node tools/sim-check.cjs 240 20261020 rural   # 单蓝图长跑（rural/marketTown/factory/port/campus/greenfield）
node tools/landcheck.cjs 480 marketTown       # 单蓝图「空间—承载量—人口—用地」链路量级体检
node tools/probe.cjs 120 marketTown           # 量级体检：把工资/利润率/库存/地价/财政摊开核对是否贴近现实
DUMP_INIT=1 node tools/smoke-preview.cjs      # 打印「开局 + 12 个月」三视角的数值快照，肉眼核对单位
```

## 🧩 知识系统（欢迎贡献文案）

概念卡定义集中在 [`src/data/lessons.ts`](src/data/lessons.ts)：

- `check(state)` 与 `chapter` 已由项目搭好（触发逻辑）。
- `definition / example / experiment / advanced` 为文案占位 **TODO**，期待你（或社区）按标准经济学大纲填写，并用「本局实例」把抽象概念落到玩家自己的城市上。

新增一个概念：在 `LESSONS` 数组追加一条 `LessonDef` 即可，UI 与触发会自动接入。

## 🏗️ 架构

```
src/
  sim/       经济引擎（types / rng / config / households / firms / government / macro / engine）
             land（规划指标与承载量） / roadGrid（横平竖直路网） / scale（代表性家庭样本倍率） / population（人口分布）
             tiles（地块演化） / stages（阶段与征地扩张） / businessCycle（经济周期） / cycles（循环轮次）
             requirements（解锁条件） / perspectives（三视角）
  data/      units（单位口径与格式化） + cityGen（城市生成） + glossary（96 个名词 + 解锁条件） + quiz（96 道题） + levers / blueprints
  ui/        map（Canvas） / dashboard（Chart.js） / hud / knowledge / quiz / cycleStatus / saveDialog
  state/     save（localStorage 多槽位存读档） / quiz（积分与奖杯档案）
tools/       audit（全量体检） / smoke-preview（无浏览器冒烟） / sim-check（长跑） / landcheck（空间链路体检）
             scale-check（六蓝图规模体检） / probe（量级体检） / gen-preview-terms
```

仿真为 **tick 驱动 + 纯函数式步进**，便于单测与扩展。

## 🗺️ 路线图（v0.3+）

- 修 factory / rural 的劳动力供给瓶颈，让六张蓝图都能走到对应规模。
- 财政平衡：赤字上限与自动调整。
- 补概念卡文案（社区可认领，见 good first issue）。
- 地图交互：分区拖拽、基建放置。
- 更多政策与产业、情景预设。
- 概念卡多语言。
- Three.js 3D 视角实验。

## 📦 打包分发

```bash
npm run build        # 类型检查 + 生产构建 → dist/
npm run pack         # 把 dist 内联成单个 HTML → release/MacroVille-vX.Y.Z-offline.html
```

单文件产物（`tools/build-standalone.cjs` 生成）双击即可游玩，适合发给不懂命令行的朋友；
`dist/` 适合部署到 GitHub Pages 等静态托管。

## 📈 进展记录

[`PROGRESS.md`](PROGRESS.md) 记录了每个版本的完成度、体检数据、已知取舍与下一步计划。

## 📄 许可证

[MIT](LICENSE) © MacroVille contributors
