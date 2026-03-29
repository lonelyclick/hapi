# Remote 组织权限改造实现计划

## 目标
为 Yoho Remote 引入组织（Organization）概念，用户登录后无 org 可创建，可邀请成员、分配权限。当前阶段不做数据隔离，所有 org 共享 session/credential 等资源。

## 设计决策
- **Org 数据**: Keycloak Organization 功能 + 应用侧 PostgreSQL 轻量补充
- **权限模型**: Owner / Admin / Member 三级
- **数据隔离**: 暂不隔离，session/credential 等仍全局共享
- **现有逻辑**: 最小化改动

---

## 实现步骤

### Step 1: 数据层 — 新增类型定义
**文件**: `server/src/store/types.ts`

新增类型：
```typescript
export type OrgRole = 'owner' | 'admin' | 'member'

export type StoredOrganization = {
    id: string              // UUID
    name: string
    slug: string            // URL-friendly 标识
    createdBy: string       // 创建者 email
    createdAt: number
    updatedAt: number
    settings: Record<string, unknown>  // 组织级配置（预留）
}

export type StoredOrgMember = {
    orgId: string
    userEmail: string
    userId: string          // Keycloak sub
    role: OrgRole
    joinedAt: number
    invitedBy: string | null  // 邀请者 email
}

export type StoredOrgInvitation = {
    id: string              // UUID
    orgId: string
    email: string           // 被邀请者 email
    role: OrgRole
    invitedBy: string       // 邀请者 email
    createdAt: number
    expiresAt: number       // 过期时间
    acceptedAt: number | null
}
```

### Step 2: 数据层 — 扩展 IStore 接口
**文件**: `server/src/store/interface.ts`

新增方法组：
```typescript
// === Organization 操作 ===
createOrganization(data: { name: string; slug: string; createdBy: string }): Promise<StoredOrganization | null>
getOrganization(id: string): Promise<StoredOrganization | null>
getOrganizationBySlug(slug: string): Promise<StoredOrganization | null>
getOrganizationsForUser(email: string): Promise<StoredOrganization[]>
updateOrganization(id: string, data: { name?: string; settings?: Record<string, unknown> }): Promise<StoredOrganization | null>
deleteOrganization(id: string): Promise<boolean>

// === Org Member 操作 ===
addOrgMember(data: { orgId: string; userEmail: string; userId: string; role: OrgRole; invitedBy?: string }): Promise<StoredOrgMember | null>
getOrgMembers(orgId: string): Promise<StoredOrgMember[]>
getOrgMember(orgId: string, email: string): Promise<StoredOrgMember | null>
updateOrgMemberRole(orgId: string, email: string, role: OrgRole): Promise<boolean>
removeOrgMember(orgId: string, email: string): Promise<boolean>
getUserOrgRole(orgId: string, email: string): Promise<OrgRole | null>

// === Org Invitation 操作 ===
createOrgInvitation(data: { orgId: string; email: string; role: OrgRole; invitedBy: string; expiresAt: number }): Promise<StoredOrgInvitation | null>
getOrgInvitations(orgId: string): Promise<StoredOrgInvitation[]>
getPendingInvitationsForUser(email: string): Promise<StoredOrgInvitation[]>
acceptOrgInvitation(id: string): Promise<boolean>
deleteOrgInvitation(id: string): Promise<boolean>
```

### Step 3: 数据层 — PostgreSQL 实现
**文件**: `server/src/store/postgres.ts`

#### 3a. initSchema 新增建表语句
```sql
-- Organizations 表
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_by TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    settings JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug);

-- Org Members 表
CREATE TABLE IF NOT EXISTS org_members (
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_email TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at BIGINT NOT NULL,
    invited_by TEXT,
    PRIMARY KEY (org_id, user_email)
);
CREATE INDEX IF NOT EXISTS idx_org_members_email ON org_members(user_email);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON org_members(org_id);

-- Org Invitations 表
CREATE TABLE IF NOT EXISTS org_invitations (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    invited_by TEXT NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    accepted_at BIGINT,
    UNIQUE(org_id, email)
);
CREATE INDEX IF NOT EXISTS idx_org_invitations_email ON org_invitations(email);
```

#### 3b. 实现所有 IStore 新增方法（CRUD 操作）

### Step 4: 路由层 — 新增组织 API
**文件**: 新建 `server/src/web/routes/orgs.ts`

```
POST   /api/orgs                        — 创建组织
GET    /api/orgs                        — 我的组织列表
GET    /api/orgs/:orgId                 — 组织详情
PATCH  /api/orgs/:orgId                 — 更新组织（owner/admin）
DELETE /api/orgs/:orgId                 — 删除组织（owner only）

GET    /api/orgs/:orgId/members          — 成员列表
POST   /api/orgs/:orgId/members          — 邀请/添加成员（owner/admin）
PATCH  /api/orgs/:orgId/members/:email   — 修改成员角色（owner/admin）
DELETE /api/orgs/:orgId/members/:email   — 移除成员（owner/admin, 不能移除自己）

GET    /api/orgs/:orgId/invitations      — 邀请列表
POST   /api/orgs/:orgId/invitations      — 发送邀请
DELETE /api/orgs/:orgId/invitations/:id  — 撤销邀请

POST   /api/invitations/:id/accept       — 接受邀请（被邀请人）
GET    /api/invitations/pending           — 我的待处理邀请
```

**关键逻辑**:
- 创建组织时，创建者自动成为 owner
- 权限守卫：只有 owner/admin 能邀请成员和修改角色
- 只有 owner 能删除组织和提升/降级 admin
- slug 需唯一，用于 URL

### Step 5: 注册路由到 server.ts
**文件**: `server/src/web/server.ts`

在 auth middleware 之后注册：
```typescript
import { createOrgsRoutes } from './routes/orgs'
// ...
app.route('/api', createOrgsRoutes(options.store))
```

### Step 6: 中间件扩展 — 注入组织信息
**文件**: `server/src/web/middleware/auth.ts`

扩展 `WebAppEnv`：
```typescript
export type WebAppEnv = {
    Variables: {
        userId: string
        namespace: string
        email?: string
        name?: string
        role: UserRole
        clientId?: string
        deviceType?: string
        // 新增 ↓
        orgs?: Array<{ id: string; name: string; role: OrgRole }>
    }
}
```

在认证中间件中，token 验证成功后查询用户所属组织列表并注入：
```typescript
// 查询用户所属组织
const orgs = await store.getOrganizationsForUser(user.email)
// 查询每个 org 的 role
const orgWithRoles = await Promise.all(
    orgs.map(async (org) => ({
        id: org.id,
        name: org.name,
        role: await store.getUserOrgRole(org.id, user.email) ?? 'member'
    }))
)
c.set('orgs', orgWithRoles)
```

**注意**: auth middleware 需要接收 store 参数。修改 `createAuthMiddleware(store: IStore)` 签名。

### Step 7: 前端 — 服务层和类型
**文件**: `web/src/services/keycloak.ts` 和 `web/src/api/client.ts`

扩展 `KeycloakUser`：
```typescript
export interface KeycloakUser {
    email: string
    name: string | null
    sub: string
    orgs?: Array<{ id: string; name: string; role: string }>  // 新增
}
```

在 `ApiClient` 中新增组织相关 API 方法：
```typescript
// Organizations
getMyOrgs(): Promise<Organization[]>
createOrg(data: { name: string; slug: string }): Promise<Organization>
getOrg(orgId: string): Promise<Organization>
updateOrg(orgId: string, data: { name?: string }): Promise<Organization>
deleteOrg(orgId: string): Promise<void>

// Members
getOrgMembers(orgId: string): Promise<OrgMember[]>
inviteOrgMember(orgId: string, data: { email: string; role: string }): Promise<void>
updateOrgMemberRole(orgId: string, email: string, role: string): Promise<void>
removeOrgMember(orgId: string, email: string): Promise<void>

// Invitations
getMyPendingInvitations(): Promise<OrgInvitation[]>
acceptInvitation(id: string): Promise<void>
```

### Step 8: 前端 — 组织管理页面
**新建文件**:
- `web/src/routes/orgs/index.tsx` — 组织列表/创建入口
- `web/src/routes/orgs/$orgId.tsx` — 组织详情/成员管理
- `web/src/components/OrgSetup.tsx` — 首次进入无 org 时的引导页
- `web/src/components/InvitationBanner.tsx` — 待处理邀请提示

**App.tsx 改造**:
登录后检查用户是否有 org：
- 无 org + 无待处理邀请 → 跳转到组织创建页 `/orgs/setup`
- 无 org + 有待处理邀请 → 显示邀请接受界面
- 有 org → 正常进入主界面

### Step 9: 前端 — React Query hooks
**新建文件**: `web/src/hooks/queries/useOrgs.ts`

```typescript
useMyOrgs()              — 获取我的组织列表
useOrgMembers(orgId)     — 获取组织成员
usePendingInvitations()  — 获取待处理邀请
```

**新建文件**: `web/src/hooks/mutations/useOrgMutations.ts`

```typescript
useCreateOrg()
useInviteMember()
useUpdateMemberRole()
useRemoveMember()
useAcceptInvitation()
```

---

## 不改动的部分（确认）
- `sessions.ts` 路由 — 不改（暂不按 org 隔离 session）
- `guards.ts` — 不改（session 访问控制保持现有逻辑）
- `credentials` 相关 — 不改（暂不按 org 隔离）
- `machines` 相关 — 不改
- `allowed_emails` — 保留（可能逐步迁移到 org 成员体系，但本轮不动）

## 实施顺序
1. Step 1-3: 数据层（types → interface → postgres）
2. Step 4-5: 后端 API（routes → server 注册）
3. Step 6: 中间件扩展
4. Step 7-9: 前端（types → API → 页面 → hooks）

每步完成后可独立测试验证。
