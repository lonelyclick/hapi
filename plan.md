# Brain Session MCP Tool 实现计划

## 目标
给 Brain CLI 持久进程（走 runClaude → loop 路径）添加一个 MCP tool `brain_analyze`，该 tool 内部调用 Claude Agent SDK 来：
1. 汇总当前 AI 会话的对话内容
2. 根据项目代码给出建议

Brain session 启动时，禁用所有内置 tools（Read/Write/Edit/Bash/Grep/Glob 等），只保留这个 MCP tool。

## 架构

```
Brain CLI 进程 (runClaude → loop → claudeRemote)
  ↓
Claude 收到 review prompt
  ↓
Claude 调用 MCP tool: mcp__hapi__brain_analyze
  ↓
MCP tool handler 执行：
  1. 通过 ApiClient 获取当前 session 消息历史
  2. 调用 SDK query() spawn 临时 Claude 进程
     - 给临时 Claude 传入：消息历史摘要 + system prompt
     - 允许 Read/Grep/Glob tools（让它读代码）
     - 临时 Claude 分析代码 → 返回结构化结果
  3. 返回汇总 + 建议给外层 Claude
  ↓
外层 Claude 将结果展示给用户
```

## 改动文件

### 1. `cli/src/claude/utils/startHappyServer.ts`
- 修改 `startHappyServer` 函数签名，额外接收 `api: ApiClient` 和 `sessionSource: string`
- 注册新的 MCP tool `brain_analyze`：
  - inputSchema: `{ context?: string }` （可选的额外上下文）
  - handler 逻辑：
    1. 调用 `api.getSessionMessages(client.sessionId)` 获取消息历史
    2. 提取用户消息和 AI 回复，组装成对话摘要
    3. 调用 `cli/src/claude/sdk/query.ts` 的 `query()` 启动临时 Claude 进程
       - prompt: 对话摘要 + "请分析项目代码并给出建议"
       - allowedTools: ['Read', 'Grep', 'Glob']
       - permissionMode: 'bypassPermissions'
       - maxTurns: 15
       - cwd: 当前工作目录
    4. 收集 SDK 的 result 消息
    5. 返回结构化结果 `{ summary, suggestions }`
- `toolNames` 数组加入 `'brain_analyze'`
- 只在 `sessionSource === 'brain-sdk'` 时注册这个 tool

### 2. `cli/src/claude/runClaude.ts`
- 修改 `startHappyServer(session)` 调用，传入 `api` 和 `sessionSource`：
  ```typescript
  const happyServer = await startHappyServer(session, api, sessionSource);
  ```

### 3. `server/src/web/routes/machines.ts`
- Brain session spawn 时，在消息 meta 中传 `disallowedTools` 来禁用内置 tools：
  ```typescript
  await engine.sendMessage(brainSessionId, {
      text: brainInitPrompt,
      sentFrom: 'webapp',
      meta: {
          disallowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Task', 'WebFetch', 'WebSearch', 'TodoWrite', 'NotebookEdit']
      }
  })
  ```
  这样 brain session 的 Claude 只能用 `mcp__hapi__brain_analyze` 和 `mcp__hapi__change_title`

### 4. 前端展示（可选，后续优化）
- 当前 MCP tool 默认用 GenericResultView 展示，返回 Markdown 格式的结果即可
- 后续可以在 `knownTools.tsx` 和 `_results.tsx` 中为 `mcp__hapi__brain_analyze` 注册自定义展示

## 不改动的文件
- `sdkAdapter.ts` — brain worker 独立路径，不受影响
- `brain-review-worker.ts` — 同上
- `claudeRemote.ts` — 已支持 disallowedTools 从消息 meta 传入
- `syncEngine.ts` — 已支持 meta 传递

## 关键注意点
1. SDK `query()` 是同步阻塞的（等临时 Claude 跑完），MCP tool handler 可以 async 等待
2. 临时 Claude 进程需要正确的环境变量（ANTHROPIC_API_KEY 等），从 `process.env` 继承即可
3. 消息历史可能很长，需要做截断/摘要处理
4. `pathToClaudeCodeExecutable` 要用 `'claude'` 让系统 PATH 找到
