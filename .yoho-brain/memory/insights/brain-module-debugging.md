# Brain 模块调试经验

## 数据库查询

### 连接方式
```bash
PGPASSWORD='Root,./000000' psql -h 127.0.0.1 -U guang -d yoho_remote
```
注意：数据库是 `yoho_remote`，不是代码默认的 `hapi`。用户是 `guang`，不是 `postgres`。

### 常用查询

查 brain_sessions 及关联 session 是否存在：
```sql
SELECT
    bs.main_session_id,
    bs.review_session_id as brain_session_id,
    bs.status,
    CASE WHEN s_main.id IS NOT NULL THEN '✅' ELSE '❌' END as main_ok,
    CASE WHEN s_review.id IS NOT NULL THEN '✅' ELSE '❌' END as review_ok
FROM brain_sessions bs
LEFT JOIN sessions s_main ON s_main.id = bs.main_session_id
LEFT JOIN sessions s_review ON s_review.id = bs.review_session_id
ORDER BY bs.created_at DESC;
```

查 session 消息结构（注意 role/type 都在 content jsonb 里）：
```sql
SELECT seq,
       content->>'role' as role,
       content->'content'->>'type' as content_type,
       content->'content'->'data'->>'type' as data_type,
       length(content::text) as size
FROM messages WHERE session_id = '<id>' ORDER BY seq ASC;
```

查 session 元数据（source 在 metadata jsonb 里，不是独立字段）：
```sql
SELECT id, active, metadata->>'source' as source,
       metadata->>'mainSessionId' as main_sid
FROM sessions WHERE id = '<id>';
```

## API 测试

### 获取 Token
```bash
TOKEN=$(curl -s -X POST 'https://auth.yohomobile.dev/realms/yoho/protocol/openid-connect/token' \
  -d 'grant_type=client_credentials' \
  -d 'client_id=yoho-remote' \
  -d 'client_secret=9mUnapjvGFmcLsf6yfHde2NY4LRLbLnp' | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```
- Client ID 是 `yoho-remote`，不是 `hapi`
- client_credentials token 权限有限，无法读取单个 session（返回 403），但可以调用 brain API 和 sessions 列表

### Brain API 端点（端口 3006，路径前缀 /api）
- `GET /api/brain/sessions/active/:mainSessionId` — 活跃 brain session
- `GET /api/brain/sessions?mainSessionId=...` — brain sessions 列表
- `GET /api/brain/sessions/:id` — 单条 brain session

### 陷阱
- 路由前缀是 `/api/`，直接访问 `/brain/...` 会返回前端 SPA 的 HTML
- hapi-server 端口是 **3006**（通过 `ss -tlnp | grep <pid>` 确认）

## 已修复的 Bug

### 1. brain-sdk display session 进入 archive
- **根因**：brain-sdk display session 没有心跳机制。创建后 2 分钟（ACTIVE_THRESHOLD_MS）没有 heartbeat 就被 `isSessionTrulyActive()` 判为 inactive
- **数据库 active=true 但 API 返回 active=false**：后端 `sessions.ts` 用 `trulyActive` 覆盖数据库值，基于内存中的 activeAt 是否在 2 分钟内
- **修复**：在 `autoBrain.ts` 中加 `keepBrainDisplaySessionAlive()` 方法，在 syncRounds 循环和 triggerSdkReview 的 onProgress 回调中调用 `engine.handleSessionAlive()`
- **文件**：`server/src/brain/autoBrain.ts`

### 2. Brain 按钮不显示
- **根因**：`SessionChat.tsx` 传 `SessionHeader` 时没有传 `onOpenBrain` prop，导致条件 `props.onOpenBrain && brainSession` 永远为 false
- **修复**：加上 `onOpenBrain={(brainSessionId) => navigate({ to: '/sessions/$sessionId', params: { sessionId: brainSessionId } })}`
- **文件**：`web/src/components/SessionChat.tsx`

### 3. brain-sdk session 在列表过滤器中丢失
- **根因**：SessionList 的 `brain` 过滤器只匹配 `source === 'brain'`，不匹配 `source === 'brain-sdk'`
- **修复**：加 `const isBrainSession = source === 'brain' || source === 'brain-sdk'`
- **文件**：`web/src/components/SessionList.tsx`

### 4. mainSessionIdForBrain 逻辑错误
- **根因**：旧逻辑只匹配 brain/brain-sdk session，普通主 session 永远拿不到 mainSessionIdForBrain
- **修复**：普通 session 用自身 ID，brain-sdk 用 metadata.mainSessionId，brain CLI 跳过
- **文件**：`web/src/components/SessionHeader.tsx`

## Brain 模块架构要点

### 两种模式
- **CLI 模式**：spawn 独立的 `hapi claude` 进程，有自己的 socket 心跳，source=`brain`
- **SDK 模式**：服务端直接用 Claude Agent SDK，创建 display session，source=`brain-sdk`

### 数据映射
- DB `review_session_id` → API `brainSessionId`
- DB `review_model` → API `brainModel`
- DB `review_result` → API `brainResult`

### 消息处理链路（前端）
```
DecryptedMessage → normalizeDecryptedMessage() → NormalizedMessage → reduceChatBlocks() → ChatBlock[] → toThreadMessageLike() → React 组件
```
- `content.type === 'output'` + `data.type === 'assistant'`：提取 `data.message.content` 显示文本
- `content.type === 'output'` + `data.type === 'summary'`：显示为事件消息
- `content.type === 'output'` + `data.type === 'user'`：`normalizeUserOutput()` 处理 tool_result
- `content.type === 'event'` + `data.type === 'ready'`：被过滤不显示（正常设计）
