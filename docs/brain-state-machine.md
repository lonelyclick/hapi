# Brain Session 决策状态机设计

## 状态全景图

```
                          ┌──────────────────────────────────────────────────────────────────┐
                          │                    Brain Decision State Machine                   │
                          └──────────────────────────────────────────────────────────────────┘

    ┌─────────┐     init prompt      ┌──────────────┐
    │  IDLE   │ ──────────────────→  │  DEVELOPING  │◄─────────────────────────────────┐
    └─────────┘     收到初始任务      └──────┬───────┘                                  │
                                            │                                          │
                                   AI 回复结束                                          │
                                   (wasThinking)                                       │
                                            │                                          │
                                            ▼                                          │
                                  ┌─────────────────┐                                  │
                                  │  REVIEWING      │                                  │
                                  │  (代码审查)      │                                  │
                                  └────────┬────────┘                                  │
                                           │                                           │
                              ┌────────────┼────────────┐                              │
                              ▼            ▼            ▼                              │
                        ┌──────────┐ ┌──────────┐ ┌──────────┐                         │
                        │ 有问题   │ │ 无问题   │ │ AI在问   │                         │
                        │ has_issue│ │ no_issue │ │ question │                         │
                        └────┬─────┘ └────┬─────┘ └────┬─────┘                         │
                             │            │            │                               │
                  push修改建议│            │     替用户决策│                               │
                             │            │            │                               │
                             ▼            ▼            ▼                               │
                        ┌─────────────────────────────────┐      修改不通过              │
                        │         LINTING                  │ ──────────────────────────→│
                        │    (代码风格/格式检查)             │                             │
                        └──────────────┬──────────────────┘                              │
                                       │                                                │
                              ┌────────┴────────┐                                       │
                              ▼                 ▼                                       │
                        ┌──────────┐      ┌──────────┐                                  │
                        │ lint通过 │      │ lint失败 │──→ push修复 ──→ 回到DEVELOPING ──→┘
                        └────┬─────┘      └──────────┘
                             │
                             ▼
                        ┌─────────────────────────────────┐      测试失败
                        │         TESTING                  │ ──────────────────────────→ 回到DEVELOPING
                        │      (运行测试套件)               │
                        └──────────────┬──────────────────┘
                                       │
                              ┌────────┴────────┐
                              ▼                 ▼
                        ┌──────────┐      ┌──────────┐
                        │ 测试通过 │      │ 测试失败 │──→ 分析失败原因 ──→ push修复建议
                        └────┬─────┘      └──────────┘
                             │
                             ▼
                        ┌─────────────────────────────────┐
                        │        COMMITTING                │
                        │      (提交代码)                   │
                        └──────────────┬──────────────────┘
                                       │
                              ┌────────┴────────┐
                              ▼                 ▼
                        ┌──────────┐      ┌──────────┐
                        │ 提交成功 │      │ 提交失败 │──→ 修复 hook/冲突
                        └────┬─────┘      └──────────┘
                             │
                             ▼
                        ┌─────────────────────────────────┐
                        │        DEPLOYING (可选)          │
                        │      (部署上线)                   │
                        └──────────────┬──────────────────┘
                                       │
                              ┌────────┴────────┐
                              ▼                 ▼
                        ┌──────────┐      ┌──────────┐
                        │ 部署成功 │      │ 部署失败 │──→ 分析 ──→ 回滚/重试
                        └────┬─────┘      └──────────┘
                             │
                             ▼
                        ┌─────────┐
                        │ DONE    │
                        │ 任务完成 │
                        └─────────┘
```

## 详细状态定义

### 1. IDLE - 空闲
```
进入条件: Brain Session 刚创建，等待主 session 开始工作
退出条件: 主 session 收到 init prompt 并开始工作
Brain 行为: 无
```

### 2. DEVELOPING - 开发中
```
进入条件:
  - 从 IDLE: 主 session 开始执行任务
  - 从 REVIEWING: 审查发现问题，push 了修改建议
  - 从 LINTING: lint 失败，push 了修复指令
  - 从 TESTING: 测试失败，push 了修复建议

退出条件:
  - 主 session 回复结束 (wasThinking=true)
  - AI 输出中不再有 Edit/Write 工具调用（开发动作停止）

Brain 行为:
  - 监控主 session 的工具调用模式
  - 判断是否还在"写代码"阶段
```

### 3. REVIEWING - 审查中
```
进入条件: DEVELOPING 阶段的 AI 回复结束

退出条件 (三选一):
  a) has_issue   → 发现问题，push 修改建议 → 回到 DEVELOPING
  b) no_issue    → 没有问题 → 进入 LINTING
  c) ai_question → AI 在等待用户输入 → Brain 替用户决策 → 回到 DEVELOPING

Brain 行为:
  - 调用 brain_summarize 获取最新对话
  - 多角度审查（功能正确性、边界情况、安全性、性能）
  - 判断审查结果类型
  - 根据结果决定下一步
```

### 4. LINTING - 代码检查
```
进入条件: REVIEWING 完成且无问题

退出条件:
  a) lint_pass → 进入 TESTING
  b) lint_fail → push "请修复 lint 错误" → 回到 DEVELOPING

Brain 行为:
  - push 主 session 执行 lint 命令
  - 监控 lint 输出结果
  - 解析 lint 错误并给出修复建议
```

### 5. TESTING - 测试中
```
进入条件: LINTING 通过

退出条件:
  a) test_pass → 进入 COMMITTING
  b) test_fail → 分析失败原因 → push 修复建议 → 回到 DEVELOPING

Brain 行为:
  - push 主 session 运行测试
  - 监控测试输出
  - 如果失败: 分析原因，判断是代码 bug 还是测试本身的问题
  - 给出具体修复方向
```

### 6. COMMITTING - 提交中
```
进入条件: TESTING 通过（或无测试时 LINTING 通过）

退出条件:
  a) commit_success → 进入 DEPLOYING 或 DONE
  b) commit_fail    → 修复 pre-commit hook 或冲突 → 重试

Brain 行为:
  - push 主 session 执行 git add + git commit
  - 审查 commit message 质量
  - 处理 pre-commit hook 失败
```

### 7. DEPLOYING - 部署中 (可选)
```
进入条件: COMMITTING 成功 + 任务要求部署

退出条件:
  a) deploy_success → DONE
  b) deploy_fail    → 分析原因 → 回滚/重试

Brain 行为:
  - push 主 session 执行部署命令
  - 监控部署输出
  - 部署失败时决定回滚还是修复重试
```

### 8. DONE - 完成
```
进入条件: 任务完成（提交成功 或 部署成功）
Brain 行为: 发送完成总结，标记 brain_session 为 completed
```

## 特殊状态：用户消息拦截

```
任何状态下用户发消息:

  当前状态 ──→ REFINING (用户消息处理)
                  │
                  ├─ 获取用户原始消息 (brain_user_intent)
                  ├─ 分析意图合理性
                  ├─ 重写为精确指令
                  ├─ 注入主 session
                  │
                  └──→ 根据消息内容决定新状态:
                       - "继续开发 xxx" → DEVELOPING
                       - "部署一下" → DEPLOYING
                       - 其他 → 保持当前状态
```

## 状态判断信号

Brain 需要从主 session 的输出中提取以下信号来判断状态：

| 信号 | 检测方式 | 含义 |
|------|----------|------|
| 使用了 Edit/Write 工具 | 工具调用类型 | 正在写代码 → DEVELOPING |
| 使用了 Bash(lint) | 工具调用 + 命令内容 | 正在 lint → LINTING |
| 使用了 Bash(test) | 工具调用 + 命令内容 | 正在测试 → TESTING |
| 使用了 Bash(git) | 工具调用 + 命令内容 | 正在提交 → COMMITTING |
| 输出包含 "?" 或选项 | 文本分析 | AI 在等用户决策 |
| 输出 "完成"/"done" | 文本分析 | 阶段结束 |
| lint/test 退出码 0 | 命令输出 | 通过 |
| lint/test 退出码非0 | 命令输出 | 失败 |

## 状态转换规则矩阵

| 当前状态 → | DEVELOPING | REVIEWING | LINTING | TESTING | COMMITTING | DEPLOYING | DONE |
|-----------|------------|-----------|---------|---------|------------|-----------|------|
| IDLE | ✅ init | - | - | - | - | - | - |
| DEVELOPING | - | ✅ AI回复结束 | - | - | - | - | - |
| REVIEWING | ✅ 有问题/AI在问 | - | ✅ 无问题 | - | - | - | - |
| LINTING | ✅ lint失败 | - | - | ✅ lint通过 | - | - | - |
| TESTING | ✅ 测试失败 | - | - | - | ✅ 测试通过 | - | - |
| COMMITTING | - | - | - | - | - | ✅ 需部署 | ✅ 不需部署 |
| DEPLOYING | - | - | - | - | - | - | ✅ 部署成功 |

## 失败重试限制

为了防止无限循环，每个状态有最大重试次数：

```
REVIEWING → DEVELOPING (修改): 最多 5 次，超过后强制进入 LINTING
LINTING → DEVELOPING (修复):   最多 3 次，超过后跳过 lint 进入 TESTING
TESTING → DEVELOPING (修复):   最多 3 次，超过后标记为 DONE + 测试失败警告
COMMITTING 重试:               最多 2 次
DEPLOYING 重试:                最多 2 次
```

## 与现有架构的集成点

```
autoBrain.ts
  └── handleMainSessionComplete()
       └── syncRounds()
            └── triggerSdkReview()
                 │
                 │ 当前: 发送固定的 review prompt
                 │ 改进: 根据状态机的当前状态，发送不同的 prompt
                 │
                 ├── DEVELOPING → "代码还在写，等下一轮"
                 ├── REVIEWING  → "审查代码，判断质量"
                 ├── LINTING    → "让主 session 跑 lint"
                 ├── TESTING    → "让主 session 跑测试"
                 ├── COMMITTING → "让主 session 提交代码"
                 └── DEPLOYING  → "让主 session 部署"

存储: brain_sessions 表新增 current_state 字段
追踪: brain_executions 表记录每次状态转换
```

## 实现方式建议

**推荐方案: 轻量状态机 + LLM 判断**

```
┌──────────────────────────────────────────────┐
│           确定性状态机（代码逻辑）              │
│                                              │
│  定义: 状态、转换规则、重试限制                 │
│  驱动: 事件触发状态转换                        │
│  存储: 当前状态持久化到 DB                      │
│                                              │
│  ┌────────────────────────────────────────┐   │
│  │         LLM 判断层（每个状态内部）       │   │
│  │                                        │   │
│  │  输入: 主 session 最新对话内容           │   │
│  │  输出: 结构化判断结果                    │   │
│  │    {                                   │   │
│  │      signal: "has_issue" | "no_issue"  │   │
│  │              | "ai_question" | ...     │   │
│  │      reason: "..."                     │   │
│  │      suggestion: "..."                 │   │
│  │    }                                   │   │
│  │                                        │   │
│  │  状态机根据 signal 驱动状态转换          │   │
│  └────────────────────────────────────────┘   │
└──────────────────────────────────────────────┘
```

**为什么不用纯 LLM:**
- 状态容易丢失（LLM 忘了自己在哪个阶段）
- 流程不可控（可能跳过 lint 直接部署）
- 重试逻辑难以保证

**为什么不用纯状态机:**
- 无法理解 AI 输出的语义（"这段代码有 bug" vs "代码没问题"）
- 无法处理模糊情况
- 硬编码规则太脆弱
