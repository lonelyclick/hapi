# Brain 状态机可视化

## 目标
在 Brain session 聊天界面（`source=brain-sdk`）的右上角按钮区，加一个状态机按钮，点击弹出 Dialog 展示完整的状态有向图，实时高亮当前节点。

## 技术方案

前端硬编码节点和边，纯 SVG 渲染。理由：
1. 节点数量少且固定（8个），手动布局最可控
2. 不需要在 web 端加 xstate 依赖
3. 不需要新增 API 端点
4. 状态结构以后变化时可以让 AI 自迭代这个组件

## 修改文件

### 1. `web/src/types/api.ts`
- `BrainSession` 类型增加 `currentState?: string` 和 `stateContext?: object`
- 服务端 API 已经返回这两个字段，前端类型补上即可

### 2. `web/src/hooks/useSSE.ts`
- `brain-sdk-progress` 的 `done` 事件中，读取 `data.currentState`
- 更新 `brain-active-session` query cache 中的 `currentState` 字段

### 3. `web/src/components/BrainStateMachineGraph.tsx`（新建）
核心 SVG 可视化组件：
- 手动布局 8 个节点：idle, developing, reviewing, linting, testing, committing, deploying, done
- 布局为左上到右下的流程图（两行排列或蛇形排列）
- 箭头连线表示转换，标注 signal 名
- 3 种节点状态视觉：
  - 当前状态：高亮色 + 脉冲动画
  - 已经过的状态：淡色标记
  - 未到达的状态：灰色
- 节点显示中文名
- 支持暗色主题（用现有 CSS 变量）
- Props: `{ currentState: string; stateContext?: object }`

### 4. `web/src/components/SessionHeader.tsx`
- 对 Brain SDK session（`isBrainSdkSession = true`）：
  - 在右上角按钮区增加一个状态机图标按钮
  - 新增一个 state `showStateMachine` + Dialog
  - 从 brain session API 获取 `currentState`（需要用 `mainSessionId` 查询 `getActiveBrainSession`）
  - Dialog 内渲染 `BrainStateMachineGraph`

## 交互

- 按钮图标：小流程图 icon
- Dialog 标题：「Brain 状态机」
- Dialog 宽度：max-w-3xl，给图足够空间
- 节点中文名：空闲、开发中、代码审查、代码检查、测试、提交、部署、完成
