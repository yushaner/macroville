# 贡献指南（CONTRIBUTING）

感谢你考虑为 **MacroVille · 微观城邦** 做贡献！本项目偏好「先提 Issue，再开 PR」的轻量流程。

## 开发环境

```bash
npm install
npm run dev
```

## 提交流程

1. 先开一个 Issue 描述你想做的改动（新产业 / 新政策 / 新概念卡 / Bug 修复 / 翻译）。
2. Fork 并新建分支：`git checkout -b feature/your-idea`。
3. 保持改动聚焦、可测试；新增概念卡请在 `src/data/lessons.ts` 追加 `LessonDef`。
4. 提交 PR，并在描述中关联对应 Issue。

## 代码约定

- 语言：TypeScript，严格模式（`strict: true`）。
- 仿真逻辑放在 `src/sim/`，UI 放在 `src/ui/`，数据/内容放在 `src/data/`。
- 仿真步进保持「纯函数式、可复现」（使用 `src/sim/rng.ts` 的 seeded RNG）。
- 概念卡文案请引用本局真实指标，避免空泛定义。

## 好的首批任务（good first issue）

- 为某个概念卡填写 `definition / example / experiment`。
- 新增一个产业或一项政策杠杆。
- 丰富地图渲染（基建图标、agent 点）。
- 增加指标图表的 tooltip / 单位说明。

## 行为准则

请友好、尊重地交流；不接受任何形式的骚扰或攻击性言论。
