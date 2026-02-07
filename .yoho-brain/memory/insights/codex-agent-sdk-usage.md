## Codex Agent SDK（OpenAI）怎么用：核心路径与最小示例

在 OpenAI 生态里，“Codex Agent SDK”容易指向两条路线：

1) **Codex TypeScript SDK：`@openai/codex-sdk`**
   - 目标：在 Node/Bun 应用里“嵌入 Codex 代理”。
   - 原理：SDK **spawn 本地 `codex` 二进制**，通过 stdin/stdout 交换 JSONL 事件。
   - 适合：需要线程（thread）复用、流式事件、结构化输出、图片输入、可控沙箱。

2) **OpenAI Agents SDK：`@openai/agents` + `codexTool()`（实验性）**
   - 目标：在“多智能体/工具编排”框架里，把 Codex 当作一个可调用工具。
   - 适合：你已经在用 Agents SDK（handoff/guardrails/tracing），并希望某个 agent 在必要时调用 Codex 来操作工作区。

---

## A. `@openai/codex-sdk` 最小用法

### 安装

```bash
npm install @openai/codex-sdk
```

（在 Bun 项目也可以用 `bun add @openai/codex-sdk`）

### 认证

- 推荐：设置 `CODEX_API_KEY`（该 env 仅在 `codex exec`/SDK 路径支持）。
- 或者：先运行 `codex`，走“Sign in with ChatGPT”，使用本地已保存的 CLI 凭据。

### Hello world（线程 + turn）

```ts
import { Codex } from '@openai/codex-sdk';

const codex = new Codex({
  apiKey: process.env.CODEX_API_KEY,
  // baseUrl: 'https://api.openai.com/v1', // 如需走代理/网关可设置
});

const thread = codex.startThread({
  workingDirectory: '/path/to/repo',
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  model: 'gpt-5.2-codex',
  networkAccessEnabled: true,
  // 非 Git 仓库才需要：skipGitRepoCheck: true,
});

const turn = await thread.run('Diagnose the test failure and propose a fix');
console.log('threadId=', thread.id);
console.log(turn.finalResponse);
console.log(turn.usage);
```

### 流式事件（工具调用/文件变更/进度）

```ts
const { events } = await thread.runStreamed('Implement the fix');

for await (const event of events) {
  if (event.type === 'item.completed') {
    console.log('item=', event.item.type);
  }
  if (event.type === 'turn.completed') {
    console.log('usage=', event.usage);
  }
}
```

### 结构化输出（JSON Schema）

```ts
const schema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    status: { type: 'string', enum: ['ok', 'action_required'] },
  },
  required: ['summary', 'status'],
  additionalProperties: false,
} as const;

const turn = await thread.run('Summarize repository status', { outputSchema: schema });
console.log(turn.finalResponse); // 期望是符合 schema 的 JSON
```

### 恢复线程（resume）

```ts
const thread = codex.resumeThread(process.env.CODEX_THREAD_ID!);
await thread.run('Continue from where we left off');
```

---

## B. `@openai/agents` + `codexTool()`（实验性）

```ts
import { Agent, run } from '@openai/agents';
import { codexTool } from '@openai/agents-extensions/experimental/codex';

const agent = new Agent({
  name: 'Codex Agent',
  instructions: 'Use the codex tool to inspect the workspace and answer the question.',
  tools: [
    codexTool({
      sandboxMode: 'workspace-write',
      workingDirectory: '/path/to/repo',
      defaultThreadOptions: {
        model: 'gpt-5.2-codex',
        networkAccessEnabled: true,
      },
      persistSession: true,
    }),
  ],
});

const result = await run(agent, 'Explain the architecture and suggest improvements.');
console.log(result.finalOutput);
```

要点：

- 这个路径把 Codex 当工具，适合复杂编排；同时需要配置 `sandboxMode/workingDirectory`。
- `persistSession: true` 会复用同一个 Codex thread，并返回/维护 `threadId`。

---

## 常见坑

- **必须在 Git 仓库内运行**：Codex 默认会检查工作目录是 Git repo；否则用 `skipGitRepoCheck: true`。
- **沙箱与权限**：`sandboxMode` 与 `approvalPolicy` 要配套（尤其是 CI/自动化）。
- **网络访问**：`networkAccessEnabled` 会映射到 CLI 配置 `sandbox_workspace_write.network_access`。

---

## 与本仓库（hapi）的关系

- hapi 当前对 Codex 的主路径是“直接运行 Codex CLI”，见：`cli/src/codex/runCodex.ts`、`cli/src/codex/codexLocal.ts`。
- server 里还有一个把本机 `codex` 包装成 OpenAI 兼容 API 的路由：`server/src/web/routes/codex-openai.ts`（`/v1/chat/completions`）。

