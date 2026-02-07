# Brain SDK 审查 Detached Worker 架构重构方案

## 核心思路

把 SDK 审查从 server 进程内执行改为 spawn 独立的 detached 子进程。Worker 进程直连 DB 写进度和结果，完成后通过 HTTP 回调通知 server 往主 session 发消息。前端改为轮询 DB 获取进度。

## 文件改动清单

### 新建文件
1. **`server/src/brain/worker/brain-review-worker.ts`** — Worker 入口脚本
2. **`cli/src/bootstrap-brain-worker.ts`** — 构建入口（被 bun build --compile 编译成二进制）

### 修改文件
3. **`server/src/brain/store.ts`** — DB schema 增加 `worker_pid` / `last_heartbeat` 字段；新增相关方法；修改 `initSchema()` 清理逻辑（检测 PID 存活而非直接标记 failed）
4. **`server/src/brain/autoBrain.ts`** — `triggerSdkReview()` 从 await SDK 改为 spawn worker + unref
5. **`server/src/brain/routes.ts`** — 新增 `/brain/worker-callback` 路由；`execute-sdk` 改为 spawn worker 返回 202；`sdk-abort` 改为 kill PID；`sdk-status` 改为查 DB
6. **`server/src/brain/brainSdkService.ts`** — 简化为 WorkerManager（只负责 spawn/abort/查状态）
7. **`web/src/components/BrainSdkProgressPanel.tsx`** — 增加 3 秒定时轮询 progress-log API
8. **`web/src/hooks/useSSE.ts`** — SSE brain-sdk-progress 处理简化（只保留 done 事件）
9. **`cli/scripts/build-executable.ts`** — ENTRYPOINTS 增加 `hapi-brain-worker`
10. **`cli/package.json`** — scripts 增加 `build:exe:brain-worker`
11. **`deploy.sh`** — 增加 brain-worker 构建步骤

## 详细设计

### 1. Worker 脚本 (`server/src/brain/worker/brain-review-worker.ts`)

**输入**：通过 `process.argv[2]` 接收 JSON 配置：
```ts
{
  executionId: string      // brain_executions.id（server 提前创建好）
  brainSessionId: string   // brain session ID
  mainSessionId: string    // 主 session ID
  prompt: string           // 审查提示词
  projectPath: string      // 项目路径（cwd）
  model: string            // 模型名
  systemPrompt: string     // 系统提示词
  serverCallbackUrl: string // "http://127.0.0.1:3006"
  serverToken: string      // CLI_API_TOKEN
}
```

**流程**：
```
1. 解析 config
2. 连接 PostgreSQL（从 process.env 读 PG_* 变量，spawn 时继承）
3. 实例化 BrainStore
4. 更新 execution: worker_pid = process.pid, last_heartbeat = now
5. 设置 SIGTERM handler → AbortController.abort()
6. 设置心跳定时器（每 30 秒更新 last_heartbeat）
7. 调用 executeBrainQuery(prompt, options, callbacks)
   - onAssistantMessage → appendProgressLog()
   - onToolUse → appendProgressLog()
   - onProgress → 更新 heartbeat
8. 完成 → completeBrainExecution(executionId, output)
   失败 → failBrainExecution(executionId, error)
9. HTTP POST serverCallbackUrl/api/brain/worker-callback
   - body: { executionId, brainSessionId, mainSessionId, status, output?, error? }
   - 最多重试 3 次（1s/3s/10s），全失败也没关系（数据已在 DB）
10. pool.end()，进程退出
```

Worker 直接 import `executeBrainQuery` 和 `BrainStore`，bun build --compile 会打包进二进制。

### 2. 构建入口 (`cli/src/bootstrap-brain-worker.ts`)

```ts
process.env.DEV = 'false'
import('../../server/src/brain/worker/brain-review-worker')
export {}
```

### 3. Store 扩展 (`server/src/brain/store.ts`)

**新字段**（ALTER TABLE in initSchema）：
```sql
ALTER TABLE brain_executions ADD COLUMN worker_pid INTEGER;
ALTER TABLE brain_executions ADD COLUMN last_heartbeat BIGINT;
```

**新方法**：
- `updateExecutionWorkerPid(executionId, pid)` — SET worker_pid = $1
- `updateExecutionHeartbeat(executionId)` — SET last_heartbeat = now
- `getExecutionWorkerPid(executionId)` → number | null

**修改 `initSchema()` 清理逻辑**（第 98-106 行）：
```
原来：把所有 running 的标记为 failed
改为：
  1. 查所有 running executions
  2. 对每个检测 worker_pid 是否存活（process.kill(pid, 0)）
  3. 存活 → 跳过（worker 仍在运行）
  4. 死亡/无 pid → 标记为 failed
```

### 4. autoBrain.ts 改动

**`triggerSdkReview()` 方法重写**（~848-1113 行）：
- 保留 prompt 构建逻辑不变
- 保留 `createBrainExecution()` 创建 execution 记录不变
- 删除 `crashGuard`（uncaughtException handler，worker 自己的崩溃不影响 server）
- 删除 `brainSdkService.executeBrainReview()` 调用
- 删除所有 SSE 广播代码（worker 完成后由回调 API 处理）
- 删除结果解析和消息发送代码（移到回调 API 或 worker）
- **新增**：spawn detached worker

```ts
const workerPath = this.resolveWorkerPath()
const config = JSON.stringify({...})
const child = spawn(workerPath, [config], {
    detached: true,
    stdio: 'ignore',
    env: process.env
})
child.unref()
```

**新增 `resolveWorkerPath()` 方法**：
- 检查 `path.dirname(process.execPath)` 下的 `hapi-brain-worker`
- fallback 到 `/home/guang/softwares/hapi/cli/dist-exe/bun-linux-x64/hapi-brain-worker`

**保留 `buildReviewResultMessage()` 方法**：移到 routes.ts 的回调路由中使用。

### 5. routes.ts 改动

**新增 `POST /brain/worker-callback`**：
```ts
// 接收 worker 完成通知
// body: { executionId, brainSessionId, mainSessionId, status, output?, error? }
// 1. 解析 suggestions，构建友好消息
// 2. engine.sendMessage(mainSessionId, { text, sentFrom: 'brain-review' })
// 3. SSE 广播 done 事件
```
注意：这个路由需要认证（CLI_API_TOKEN）。

**修改 `POST /brain/sessions/:id/execute-sdk`**（第 1174-1367 行）：
- 保留 prompt 构建逻辑
- 保留 `createBrainExecution()`
- 删除 `brainSdkService.executeBrainReview()` 调用
- **改为** spawn worker + 返回 `202 Accepted`
```ts
return c.json({
    success: true,
    status: 'spawned',
    executionId: execution.id
}, 202)
```

**修改 `POST /brain/sessions/:id/sdk-abort`**（第 1430-1442 行）：
- 从 DB 获取最新 running execution 的 worker_pid
- `process.kill(pid, 'SIGTERM')` 发信号
- Worker 的 SIGTERM handler 会触发 abort + 写 DB

**修改 `GET /brain/sessions/:id/sdk-status`**（第 1370-1384 行）：
- 不再查内存中的 brainSdkService
- 改为查 DB: `getLatestExecutionWithProgress(id)`
- 返回 `{ isRunning: status === 'running', status, ... }`

### 6. brainSdkService.ts 简化

`BrainSdkService` 类大幅简化，移除：
- `activeQueries` Map
- `queryResults` Map
- `executeBrainReview()` 方法（移到 worker）
- `abortBrainReview()` 方法（改为 kill PID）
- `isQueryRunning()` / `getQueryResult()` / `cleanupQueryResult()`

保留 export：`buildBrainSystemPrompt()`、`buildReviewPrompt()`（worker 和 routes 都需要）

可以直接把 `BrainSdkService` 类删掉，改为 export 一个 `spawnBrainWorker()` 函数。
或者简单起见，直接在 autoBrain.ts 和 routes.ts 中 inline spawn 逻辑。

### 7. 前端 BrainSdkProgressPanel.tsx 改动

增加定时轮询（当 `isActive=true` 时，每 3 秒轮询 progress-log API）：

```tsx
useEffect(() => {
    if (!data?.isActive) return

    const interval = setInterval(async () => {
        try {
            const brainSession = await api.getActiveBrainSession(mainSessionId)
            if (!brainSession) return
            const result = await api.getBrainProgressLog(brainSession.id)
            if (!result?.entries?.length) return
            const displayEntries = result.entries.filter(e => e.type !== 'done')
            queryClient.setQueryData(queryKeys.brainSdkProgress(mainSessionId), {
                entries: displayEntries,
                isActive: result.isActive
            })
        } catch {}
    }, 3000)

    return () => clearInterval(interval)
}, [data?.isActive, mainSessionId, api, queryClient])
```

### 8. SSE 处理简化 (useSSE.ts)

SSE 的 `brain-sdk-progress` 处理只保留 `done` 和 `started` 类型（用于即时切换 isActive 状态）。
删除 `assistant-message` 和 `tool-use` 的 SSE 处理（改为轮询获取）。

### 9. 构建系统改动

**`cli/scripts/build-executable.ts`**（第 210-214 行）：
```ts
const ENTRYPOINTS: Record<string, string> = {
    'hapi': 'bootstrap.ts',
    'hapi-server': 'bootstrap-server.ts',
    'hapi-daemon': 'bootstrap-daemon.ts',
    'hapi-brain-worker': 'bootstrap-brain-worker.ts',  // 新增
};
```

**`cli/package.json`** scripts：
```json
"build:exe:brain-worker": "bun run scripts/build-executable.ts --name hapi-brain-worker"
```

**`deploy.sh`**（在 server 构建之后）：
```bash
echo "=== Building hapi-brain-worker..."
(cd cli && bun run build:exe:brain-worker)
sync
```

## 实施顺序

### Phase 1: 基础设施
1. `store.ts` — 增加 worker_pid/last_heartbeat 字段 + 方法
2. `routes.ts` — 增加 `/brain/worker-callback` 路由

### Phase 2: Worker 脚本
3. 新建 `server/src/brain/worker/brain-review-worker.ts`
4. 新建 `cli/src/bootstrap-brain-worker.ts`

### Phase 3: Server 切换
5. `autoBrain.ts` — triggerSdkReview 改为 spawn worker
6. `routes.ts` — execute-sdk 改为 spawn worker + 返回 202
7. `routes.ts` — sdk-abort 改为 kill PID
8. `routes.ts` — sdk-status 改为查 DB
9. `brainSdkService.ts` — 简化/移除
10. `store.ts` — initSchema 清理逻辑调整

### Phase 4: 前端适配
11. `BrainSdkProgressPanel.tsx` — 增加轮询
12. `useSSE.ts` — 简化 brain-sdk-progress 处理

### Phase 5: 构建部署
13. `build-executable.ts` + `package.json` + `deploy.sh`

## 风险和应对

- **Worker 僵尸进程**: initSchema 检测 PID 存活 + 心跳超时
- **HTTP 回调失败**: 重试 3 次；数据已在 DB，server 重启后可补发
- **并发 review**: autoBrain 已有 `syncingBrainIds` Set 防重；额外检查 DB 中是否有 running execution
- **环境变量**: spawn 时 `env: process.env` 继承所有变量
