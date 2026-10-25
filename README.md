# Magicpath React Flow 原型 R0

R0 范围（DESIGN.md 第 0.4 节）：React + Vite + React Flow 新原型，与 v1 单文件原型分开，不覆盖它。

## 已做

- Board ↔ React Flow 适配层：`src/boardAdapter.js`，Board 仍是事实来源，React Flow 状态只是视图投影。
- 缩放范围 0.02 ~ 4（DESIGN.md v2），缩放菜单 25% / 50% / 100% / 200%、放大、缩小。
- 显示全部元素：按节点外接矩形算视口，再按 0.02~4 clamp，见 `fitViewTarget`。
- 节点注册：brief / image / text / video / shape 五种自定义节点（R0 只是占位渲染，未接生成、编辑器、分组、存储）。
- 顶部条：画布名 + 全屏查看。
- 移动端适配：高度用 100dvh、顶部和底部留安全区（viewport-fit=cover），小屏下顶部条换行并隐藏副标题、缩放条贴底居中换行、按钮最小触摸高度 44px。引擎的触摸平移和双指缩放仍走 React Flow 默认行为，本次只改样式层，没有改适配层和节点逻辑。

## 未做（R1 及以后）

工具条完整版（底部主工具条、画板工具条、图片节点工具条、涂抹选区）、分组、图片内文字编辑器、存储与 Agent ops、长图与视频序列。这些按 DESIGN.md 第 0.4 节的 R1~R4 再做，不要在 R0 里顺手铺开。

## 运行

```bash
cd canvas-prototype/reactflow
npm install
npm run dev     # 开发预览
npm run build   # 生产构建冒烟
npm test        # 适配层单测
```

## 冒烟标准

- `npm test` 全过（缩放 clamp、Board 往返、显示全部元素大小板子、空节点）。
- `npm run build` 成功。
- 手动打开后：拖节点、滚轮缩放、点“显示全部元素”能回到全景，缩放显示在 2%~400% 之间。
