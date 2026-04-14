# Work Log — 2026-04-14 Phase 2 Session

> Duration: ~8+ hours (extended all-day session, continuation of Phase 1)
> Environments: Production (ap-northeast-1 openclaw-jiade2), Test (us-east-2 openclaw-e2e-test)
> Branch: main
> Commits: ed785b8..89c54a0 (11 commits)

---

## Overview

Massive session completing Phase 2 of per-employee Fargate always-on agents. Designed PRD (618 lines, 31 items), implemented full stack across 4 phases (2A-2D), deployed to both environments, ran 72+ real Bedrock calls, merged 8 PRs, and deployed 12 production fixes.

**Totals:** 18 files changed, +1,747 lines new code.

---

## Phase 2A: Infrastructure + Backend Core

### PRD
- Wrote `enterprise/docs/PRD-fargate-per-employee.md` (618 lines, 31 TODO items)
- Covers: per-employee always-on agent lifecycle, EFS isolation, IM auto-connect, billing, cascade delete

### CloudFormation (0b19bfb)
- 4 per-tier IAM Task Roles (standard/restricted/engineering/executive)
- 4 per-tier Security Groups
- Proper least-privilege per tier

### Backend (d2c3b73, df65b9d)
- `admin_always_on.py`: per-employee Fargate management refactored
  - EFS Access Point creation per employee
  - Per-tier Role/SG assignment
- `server.py`: channel management APIs + USAGE agent_type field
- `entrypoint.sh`: IM credential auto-connect from DynamoDB on container start

---

## Phase 2B: Backend APIs + Admin Frontend

### Backend APIs (1a63b62)
- 7 new endpoints for always-on agent management:
  - CRUD for per-employee agents
  - Workspace S3/EFS APIs
  - IM platform whitelist management

### Admin Frontend (c996fe8)
- AgentDetail page: Always-On card with enable/disable toggle
- Security Center: Fargate overview tab
- Agent Factory: per-employee agent management UI

---

## Phase 2C: Portal Frontend

### Portal (d0b457e)
- MyAgents page: employee sees their assigned agents
- IM Connect modal: connect IM platforms to agents
- Chat switcher: toggle between serverless and always-on agents
- `portal.py`: 5 new endpoints (my-agents, channels add/remove, chat agent_type)

---

## Phase 2D: Billing + Lifecycle

### Billing & Lifecycle (53bf9ff)
- USAGE# records now include `agent_type` field (serverless vs always-on)
- Fargate cost API: per-tier cost tracking
- Cascade delete: removing employee cleans up Fargate agent + EFS + IM bindings
- Position change warning: alerts when changing position affects always-on agent tier

---

## Frontend Fixes

### TypeScript Build (f40631e)
- Fixed TypeScript build errors introduced by Phase 2 frontend code
- Clean compile with 0 errors

### Employees Page Crash (89c54a0)
- Bug: `channels.map()` on undefined crashed Employees page
- Fix: added optional chaining `channels?.map()` with fallback empty array

---

## Production Deployment

### 12 items deployed to openclaw.awspsa.com (Tokyo)

| # | Change | Effect |
|---|--------|--------|
| 1 | Docker image: 13 skills -> 4 | Faster Gateway startup |
| 2 | ThreadingMixIn | 502 errors eliminated |
| 3 | Session Storage removed | SOUL identity injection restored |
| 4 | S3 path injected in SOUL | Agent knows its workspace path |
| 5 | 4 runtimes: MiniMax M2.5 / DeepSeek V3.2 / Sonnet 4.5 / Sonnet 4.6 | Model differentiation by tier |
| 6 | SOUL identity injection verified | "I am EMP-003, Solutions Architect at ACME Corp" |
| 7 | 502/504 errors fixed | Stable responses |
| 8 | CloudFront timeout 30s -> 60s | Fewer 504s on complex tasks |
| 9 | 8 PRs merged (#73-#80) | Community contributions integrated |

### Verified on production
- "Who am I?" -> correct employee identity
- "Make me a PPT" -> generated and synced to S3
- 4 different models correctly serving 4 tiers

---

## Test Environment Deployment

- All Phase 2 code deployed (backend + frontend rebuilt)
- 14/15 E2E tests passed via SSM localhost
- CloudFront origin updated (new IP after reboot)
- 72+ real Bedrock API calls across 4 tiers, 15+ employees, 4 models

---

## 8 PRs Merged

| PR | Description |
|----|-------------|
| #73 | Update IM channel CLI docs |
| #74 | Add StopRuntimeSession permission to EC2 host role |
| #75 | Preserve runtime config during AgentCore updates |
| #76 | Remove hardcoded sample admin login from deploy output |
| #77 | Slack pairing alias fix |
| #78 | Slack bootstrap auto-configure |
| #79 | Strip IM wrappers before routing |
| #80 | Community contribution |

---

## Known Issues at Session End

### Frontend UX (user feedback)
1. **Portal Chat** — serverless/always-on switcher UX not differentiated enough
2. **Create Fargate Agent** — missing config template selector (tier/model/guardrail/resource)
3. **IM Connect page** — no agent selector (serverless shared bot vs always-on direct)
4. **Agent Factory detail** — "Enable Always-On" button loading forever / timeout
5. **Employees page crash** — `channels.map()` on undefined — FIXED in code (89c54a0)

### Test Environment Instability
- EC2 was t4g.small (2 GB RAM) — OOM during Docker build
- CloudFormation update rolled back (S3 bucket name conflict)
- SG rules reset on each reboot (CFN rollback state)
- Need upgrade to c7g.large or fix CFN template

---

## Key Files Changed

| File | Purpose |
|------|---------|
| PRD-fargate-per-employee.md | Complete PRD (618 lines, 31 items) |
| admin_always_on.py | Per-employee Fargate with EFS Access Point + per-tier Role/SG |
| server.py | Channel APIs + USAGE agent_type + Session Storage removed |
| agents.py | Always-on management + workspace S3/EFS APIs |
| security.py | Fargate overview + IM platform whitelist |
| portal.py | My-agents + channels add/remove + chat agent_type |
| entrypoint.sh | DynamoDB IM credential auto-connect |
| CloudFormation YAML | 4 Task Roles + 4 Security Groups |
| MyAgents.tsx | Portal: employee's agent list |
| AgentDetail.tsx | Admin: Always-On enable/disable card |
| SecurityCenter Fargate tab | Admin: tier overview |
| Chat switcher | Portal: serverless/always-on toggle |
| useApi.ts | 8 new hooks for Phase 2 endpoints |

---

## Test Environment State (session end)

| Resource | Status |
|----------|--------|
| EC2 i-054cb53703d2ba33c | running (t4g.small, OOM risk) |
| SG sg-0413dc66c2efd5e0a | Rules reset after each reboot |
| CloudFront E1KNUZKAIOJVUA | Origin updated |
| DynamoDB | 18 USAGE, 251 AUDIT, 83 SESSION records |
| ECS Cluster | openclaw-e2e-test-always-on (no services running) |
