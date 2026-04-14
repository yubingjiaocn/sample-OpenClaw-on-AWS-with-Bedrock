# Work Log — 2026-04-14 Session 3 (Frontend Fargate Overhaul)

> Duration: ~6 hours
> Environment: Test (us-east-2 dev-openclaw.awspsa.com)
> Branch: main (uncommitted)

---

## Infrastructure Changes

### EC2 Upgrade
- t4g.small (2GB) → c7g.large (4GB) — 解决 OOM 问题
- Instance: i-054cb53703d2ba33c, new IP: 3.145.94.125

### CloudFront VPC Origins
- **Test env (DONE):** VPC Origin `vo_7fIxx0UYU1TFqzROnc4HQq` → CloudFront `E1KNUZKAIOJVUA` 走私网访问 EC2
  - SG: 允许 VPC CIDR 10.0.0.0/16 + CloudFront ENI SG 访问 8099
  - 子网 auto-assign public IP 已关闭（下次重启后无公网 IP）
  - 验证: 200 OK, 0.8s 响应
- **Production (PENDING):** VPC Origin `vo_JGVJb3n1UNEBsWbDg1u3Zo` 已创建并 Deployed
  - 跨账号: jiade2 (651770013524) → default (263168716248) CloudFront
  - 等用户确认后更新 CloudFront `E21RJOMTNCOF1N`

---

## Frontend Changes — 已完成

### P0 — Bug 修复 (5 项)
| # | 页面 | 变更 |
|---|------|------|
| 1 | Dashboard | NaN% 除零保护, qualityScore 过滤修复, 频道图动态化, channels?.map 防 undefined |
| 2 | MyUsage | totalRequests/totalCost/totalTokens 全加 `\|\| 0` 防 NaN |
| 3 | App.tsx | 删除重复 `/portal/chat` 路由 |
| 4 | AgentList Create | tier 选择器修复: `rt.runtimeId` → `rt.id`, 单选 radio 样式 |
| 5 | AgentDetail | "Enable Always-On" 按钮移除, 改为指引去 Security Center |

### P0 — 核心功能 (5 项)
| # | 页面 | 变更 |
|---|------|------|
| 1 | BindIM | **AlwaysOnChannelConnect 组件** — per-channel 凭证输入表单 (飞书 app-id/secret, Telegram token, Slack bot/app token) |
| 2 | BindIM | **Webhook URL 显示** — 从 alwaysOn.endpoint 拼接, 只读 + Copy 按钮 |
| 3 | AgentDetail | Always-On 卡片增加 Model/IAM/Guardrail/Cost + Restart 按钮 |
| 4 | AgentDetail | **Position 变更告警** — 检测 positionId 不匹配, 显示 warning + Restart Now |
| 5 | Employees | **Cascade 删除清理提示** — Always-On 员工删除弹窗列出 ECS/EFS/IM/SSM/S3/DDB 清理 |

### Portal 架构
| # | 变更 |
|---|------|
| 1 | **PortalAgentContext** — 新建 React Context, 全局管理 agentType/hasAlwaysOn/alwaysOnInfo |
| 2 | **PortalLayout sidebar** — Agent 切换器: Serverless 按钮 + Always-On 按钮 (未配置时灰色) |
| 3 | **Chat.tsx** — 移除本地 agentType state, 改读 context; header 内 mode 改为只读 badge |
| 4 | **BindIM.tsx** — 移除本地 agentMode selector, 改读 context; 显示 "Configuring IM for: X Agent" |

### P1 — 管理监控 (5 项)
| # | 页面 | 变更 |
|---|------|------|
| A | AgentDetail | **双 Agent Tab** — [📡 Serverless] [⚡ Always-On] tab, 各自独立显示 SOUL/Skills/Sessions/Config |
| A | AgentDetail | **IM 白名单展示** — position 的 allowedIMPlatforms, 绿色/灰色标签 |
| B | AgentDetail | **IM 审计日志** — 内联显示最近 5 条 IM 事件 |
| C | SecurityCenter | **Fargate 成本汇总 + 批量操作** — Running/Stopped 数量 + 月费 + Stop All / Restart All |
| C | SecurityCenter | **Fargate 卡片加 Configure 按钮** — 复用 RuntimeEditModal + New Fargate Template |
| D | Usage | **Fargate Cost StatCard** — 显示 ~$X/mo + 容器数量 |
| E | AuditLog | **4 个新事件类型** — always_on_enabled/disabled, im_channel_connected/disconnected |

### P2 — UX 完善 (6 项)
| # | 页面 | 变更 |
|---|------|------|
| 1 | MyAgents | Always-On 卡片加 Model 名称 + Uptime (Xd Xh) |
| 2 | Chat | WarmupIndicator 动态秒数 — Serverless: 25s, Always-On: 3s |
| 3 | AgentList | Always-On tab 每行加 Model 名称 + 月费估算 |
| 4 | Workspace | useWorkspaceTree 新增 agentType 参数, 根据 deployMode 自动传 |
| 5 | useApi | useAlwaysOnStatus 动态轮询 — starting: 5s, stable: 30s |
| 6 | AgentDetail | IM Disconnect 加确认步骤 (Confirm? [Yes] [No]) |

### 全页面 Fargate 适配
| 页面 | 适配内容 |
|------|----------|
| Monitor | Sessions 表 + Agent Health 表加 Mode 列 (Serverless/Fargate badge), System Health 加 Fargate Agents 卡片, Agent Activity 加 Fargate badge |
| Usage | By Agent 表加 Mode 列 |
| Workspace | S3/EFS 存储类型 badge, SOUL 保存警告区分 always-on |
| Settings | Platform Logs 加 Fargate Containers 选项, Service Status 加 ECS Fargate 卡片 |

---

## Frontend Changes — 未完成 (P3)

| # | 问题 | 页面 | 说明 |
|---|------|------|------|
| P3-1 | Type 定义缺失 | types/index.ts | 无 AlwaysOnStatus/ContainerStatus/Tier 类型, 代码用 `any` |
| P3-2 | Deploy Mode 枚举不完整 | 多处 | 'personal'/'always-on' 旧值未兼容 |
| P3-3 | IM Disconnect 缺 reason 字段 | AgentDetail | 有确认但没有 reason 输入 (审计需要) |
| P3-4 | Settings 缺 Fargate 全局配置 | Settings | 无 ECS 集群名/默认 tier/自动伸缩策略的配置 UI |
| P3-5 | Portal 子页面未接入 context | MySkills/MyUsage/MyRequests/Profile | 未传 agent_type 给 API |
| P3-6 | Workspace 文件操作缺 agent_type | Workspace | 读/写文件 API 没传 agent_type, 只有 tree 传了 |

---

## 其他未完成事项

### 生产环境
- [ ] CloudFront VPC Origin 切换 (已创建, 等确认执行)
- [ ] 生产 EC2 的子网 auto-assign public IP 关闭
- [ ] 生产 EC2 SG 收紧 (SSH 0.0.0.0/0 → 关闭, 只用 SSM)
- [ ] 前端新版本部署到生产

### 下个 Session 重点: E2E 测试
- [ ] 编写测试用例覆盖全部前端页面
- [ ] 真实数据 + 真实流程: Admin 创建 Fargate → 分配员工 → 员工连 IM → 对话 → 断开
- [ ] 测试环境保留数据痕迹 (DynamoDB AUDIT/USAGE/SESSION/CONV)
- [ ] 验证: Portal 双 Agent 切换, Chat 消息路由, Workspace S3/EFS, Monitor/Usage/Audit 数据正确
- [ ] 后端 API 可用性: /portal/my-agents, /portal/agent/channels/add, /admin/channels/*, always-on CRUD
- [ ] 稳定性: 容器重启后 IM 自动重连, EFS 数据持久, 级联删除完整

### 代码状态
- 所有改动未 commit (等用户说"提交")
- TypeScript 0 错误
- 已部署到测试环境 dev-openclaw.awspsa.com

---

## 文件改动列表 (22 files)

| File | Lines Changed |
|------|--------------|
| enterprise/admin-console/src/contexts/PortalAgentContext.tsx | **NEW** (+55) |
| enterprise/admin-console/src/components/PortalLayout.tsx | +45 |
| enterprise/admin-console/src/pages/portal/Chat.tsx | +30 -25 |
| enterprise/admin-console/src/pages/portal/BindIM.tsx | +150 -40 |
| enterprise/admin-console/src/pages/portal/MyAgents.tsx | +8 -2 |
| enterprise/admin-console/src/pages/portal/MyUsage.tsx | +4 -4 |
| enterprise/admin-console/src/pages/AgentFactory/AgentDetail.tsx | +180 -80 |
| enterprise/admin-console/src/pages/AgentFactory/AgentList.tsx | +35 -10 |
| enterprise/admin-console/src/pages/SecurityCenter.tsx | +200 -70 |
| enterprise/admin-console/src/pages/Dashboard.tsx | +15 -10 |
| enterprise/admin-console/src/pages/Monitor/index.tsx | +20 -5 |
| enterprise/admin-console/src/pages/Usage.tsx | +10 -5 |
| enterprise/admin-console/src/pages/Workspace/index.tsx | +5 -2 |
| enterprise/admin-console/src/pages/Settings.tsx | +5 -2 |
| enterprise/admin-console/src/pages/AuditLog.tsx | +10 -2 |
| enterprise/admin-console/src/pages/Organization/Employees.tsx | +15 -1 |
| enterprise/admin-console/src/hooks/useApi.ts | +10 -4 |
| enterprise/admin-console/src/App.tsx | -1 |
| enterprise/docs/worklog-2026-04-14-phase2.md | **NEW** (补写) |
| enterprise/docs/worklog-2026-04-14-session3.md | **NEW** (本文) |
