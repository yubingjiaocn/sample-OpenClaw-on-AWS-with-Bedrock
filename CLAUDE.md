# CLAUDE.md

## Project Overview

**sample-OpenClaw-on-AWS-with-Bedrock** deploys [OpenClaw](https://www.npmjs.com/package/openclaw), an open-source personal AI assistant, on AWS with Amazon Bedrock. It supports three deployment runtimes:

1. **EC2 (Serverless/AgentCore)** — CloudFormation single-instance deploy, scales to zero
2. **ECS (Fargate)** — Always-on containers with EFS workspace, direct IM bot support
3. **EKS (Kubernetes)** — Operator-managed pods via OpenClawInstance CRD, Helm chart, China region support

The **Enterprise Platform** adds multi-tenant agent management: an Admin Console (React + FastAPI), SOUL layering (Global/Position/Personal), role-based model config, IM channel binding, usage analytics, and audit logging.

## Repository Structure

```
.
├── clawdbot-bedrock.yaml              # CloudFormation (Linux/Graviton)
├── clawdbot-bedrock-mac.yaml          # CloudFormation (macOS)
├── eks/                               # EKS deployment
│   ├── terraform/                     # Terraform modules
│   │   ├── main.tf                    # Root: VPC, EKS, storage, admin-console
│   │   ├── modules/
│   │   │   ├── admin-console/         # Helm release, DynamoDB, S3, Pod Identity, seed data
│   │   │   └── storage/               # EFS/EBS CSI drivers, StorageClass
│   │   └── variables.tf / outputs.tf
│   ├── manifests/examples/            # OpenClawInstance CRD examples
│   └── scripts/                       # install, cleanup, validate, integration-test, build-and-mirror
├── enterprise/
│   ├── admin-console/                 # Admin Console application
│   │   ├── server/                    # FastAPI backend
│   │   │   ├── main.py               # App entrypoint, router registration
│   │   │   ├── db.py                  # DynamoDB single-table (PK=ORG#acme, SK=TYPE#id)
│   │   │   ├── s3ops.py              # S3 workspace & SOUL layer operations
│   │   │   ├── shared.py             # SSM client, auth helpers, config
│   │   │   ├── routers/              # 18 FastAPI routers (see below)
│   │   │   ├── services/k8s_client.py # kubernetes-asyncio client for CRD CRUD
│   │   │   ├── test_admin_eks.py      # Backend tests (70 tests, unittest)
│   │   │   └── test_k8s_client.py
│   │   ├── src/                       # React frontend (Vite + TailwindCSS v4)
│   │   │   ├── hooks/useApi.ts        # React Query hooks for all API endpoints
│   │   │   ├── pages/                 # ~25 page components
│   │   │   ├── components/ui.tsx      # Shared UI components (Card, Badge, Button, Modal, etc.)
│   │   │   ├── types/index.ts         # TypeScript types (Agent, Employee, Position, etc.)
│   │   │   └── test/                  # Vitest setup + helpers (39 frontend tests)
│   │   ├── chart/                     # Helm chart (SA, RBAC, Deployment, Service, Ingress)
│   │   ├── Dockerfile                 # Multi-stage: Node (frontend) + Python (backend)
│   │   └── deploy-eks.sh             # Standalone EKS deploy script
│   ├── agent-container/               # OpenClaw agent Docker image
│   └── gateway/                       # Tenant Router, Bedrock H2 Proxy
├── docs/
│   ├── DEPLOYMENT_EKS.md             # EKS deployment guide (English)
│   └── DEPLOYMENT_EKS_CN.md          # EKS deployment guide (Chinese)
├── skills/                            # OpenClaw skills (kiro-cli, s3-files)
└── traffic/                           # Traffic routing utilities
```

## Backend Routers (FastAPI)

| Router | Prefix | Purpose |
|--------|--------|---------|
| `agents.py` | `/agents` | Agent CRUD, auto-deploy EKS on create |
| `admin_eks.py` | `/admin/eks` | EKS cluster, operator, deploy/stop/reload, gateway proxy |
| `admin_always_on.py` | `/admin/always-on` | ECS Fargate agent lifecycle |
| `admin_ai.py` | `/admin/ai` | Bedrock model configuration |
| `admin_im.py` | `/admin/im` | IM channel bot management |
| `settings.py` | `/settings` | Model config, EKS defaults, agent config, security |
| `org.py` | `/org` | Departments, positions, employees |
| `bindings.py` | `/bindings` | Employee-agent-channel bindings |
| `gateway_proxy.py` | `/portal/gateway` | Reverse proxy to agent Gateway UI (ECS) |
| `portal.py` | `/portal` | Employee self-service portal |
| `security.py` | `/security` | Runtimes, guardrails, IAM, VPC |
| `monitor.py` | `/monitor` | Sessions, alerts, health, runtime events |
| `audit.py` | `/audit` | Audit log, insights, guardrail events |
| `knowledge.py` | `/knowledge` | Knowledge base management |
| `playground.py` | `/playground` | API testing playground |
| `usage.py` | `/usage` | Usage analytics (by agent, dept, model) |
| `twin.py` | `/twin` | Twin chat |

## Key Concepts

### OpenClawInstance CRD
```yaml
apiVersion: openclaw.rocks/v1alpha1
kind: OpenClawInstance
spec:
  image: {repository, tag}        # Container image
  registry: "ecr-uri"             # Global registry override (China)
  config.raw: {openclaw.json}     # Full config (models, gateway, tools)
  env: [{name, value}]            # Environment variables
  workspace.initialFiles: {}      # SOUL layers seeded to workspace
  skills: []                      # ClawHub skill identifiers
  resources: {requests, limits}   # CPU/memory
  gateway: {enabled, port}        # Gateway UI on port 18789
  chromium: {enabled}             # Headless browser sidecar
  storage: {class, size}          # PVC configuration
  security.rbac: {}               # ServiceAccount annotations (IRSA)
```

### DynamoDB Single-Table Design
- Table: `{stack}-enterprise` (e.g. `openclaw-test-enterprise`)
- PK: `ORG#acme` (single org per stack)
- SK patterns: `EMP#emp-id`, `AGENT#agent-id`, `DEPT#dept-id`, `POS#pos-id`, `CONFIG#key`
- GSI1: `GSI1PK=TYPE#employee` / `GSI1SK=EMP#id` for type-based queries
- Config stored as `CONFIG#eks-defaults`, `CONFIG#agent-config`, etc.

### Gateway Proxy (EKS)
Admin console proxies to agent Gateway UI via in-cluster Service DNS:
- HTTP: `/api/v1/admin/eks/{agent_id}/gateway/{path}` → `http://{name}.openclaw.svc:18789/{path}`
- WS: same path, two routes (root + path) for WebSocket
- Auth: admin JWT via header/query/cookie; gateway token read from pod config (cached 5min)
- HTML injection: `__OPENCLAW_CONTROL_UI_BASE_PATH__` for correct WS URL construction
- Origin header overridden to match upstream host for allowedOrigins check

### K8s Name Sanitization
Agent IDs may contain trailing hyphens (e.g. `agent-devops-`) which are invalid K8s names. `_sanitize_k8s_name()` in `k8s_client.py` strips these. Applied in all CRD methods: create, get, delete, patch, pod status, logs.

## Development Workflow

### Frontend
```bash
cd enterprise/admin-console
npm install
npm run dev          # Vite dev server on :3000, proxies /api to :8099
npm run test         # Vitest (39 tests)
npm run test:watch   # Vitest watch mode
npm run build        # tsc + vite build
```

- Tests exclude from `tsconfig.json` build (`src/**/*.test.*`, `src/test/` excluded)
- Test setup: `src/test/setup.ts` (jest-dom, localStorage mock)
- Test helpers: `src/test/helpers.tsx` (QueryClient wrapper, data factories)

### Backend
```bash
cd enterprise/admin-console/server
python -m pytest test_admin_eks.py test_k8s_client.py -v  # 70 tests
```

### Docker Build
```bash
cd enterprise/admin-console

# amd64 (global region)
docker build -t admin-console:v22 .

# arm64 (China region — Graviton m6g nodes)
docker buildx build --platform linux/arm64 \
  -t admin-console:v22-arm64 \
  --output type=docker,dest=/tmp/admin-console-v22-arm64.tar .
```

### Deployment Pipeline

**Global (us-west-2, openclaw-test cluster):**
```bash
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 600413481647.dkr.ecr.us-west-2.amazonaws.com
docker push 600413481647.dkr.ecr.us-west-2.amazonaws.com/openclaw-test/admin-console:v22
kubectl --context arn:aws:eks:us-west-2:600413481647:cluster/openclaw-test \
  set image deployment/admin-console admin-console=...v22 -n openclaw
```

**China (cn-northwest-1, openclaw-cn cluster) — relay via S3 + EC2:**
```bash
# 1. Upload arm64 tar to China S3
AWS_PROFILE=zhy aws s3 cp /tmp/admin-console-v22-arm64.tar \
  s3://bingjiao-share-content/admin-console-v22-arm64.tar --region cn-northwest-1

# 2. SSH to Dev EC2 (69.231.161.57) to load + push to China ECR
ssh 69.231.161.57 bash <<'REMOTE'
  aws s3 cp s3://bingjiao-share-content/admin-console-v22-arm64.tar /tmp/img.tar
  docker load < /tmp/img.tar
  docker tag openclaw-admin:v22-arm64 834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn/openclaw-cn/admin-console:v22
  aws ecr get-login-password --region cn-northwest-1 | docker login --username AWS --password-stdin 834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn
  docker push 834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn/openclaw-cn/admin-console:v22
REMOTE

# 3. Deploy
kubectl --context arn:aws-cn:eks:cn-northwest-1:834204282212:cluster/openclaw-cn \
  set image deployment/admin-console admin-console=...v22 -n openclaw
```

### Terraform
```bash
cd eks/terraform
terraform workspace select default   # Global (us-west-2)
terraform workspace select china     # China (cn-northwest-1)
terraform apply
```

## Active Deployments

| Region | Cluster | Account | ECR | Nodes |
|--------|---------|---------|-----|-------|
| us-west-2 | openclaw-test | 600413481647 | `600413481647.dkr.ecr.us-west-2.amazonaws.com/openclaw-test/admin-console` | amd64 |
| cn-northwest-1 | openclaw-cn | 834204282212 | `834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn/openclaw-cn/admin-console` | arm64 (Graviton m6g) |

## China Region Specifics

- **ghcr.io inaccessible** — all images must be mirrored to China ECR via `eks/scripts/build-and-mirror.sh`
- **Global Registry override** (`spec.registry` in CRD) rewrites ALL container image registries
- **No Bedrock** — use third-party model providers instead
- **ECR Public auth** — conditional in Terraform (us-east-1 doesn't exist in aws-cn)
- **AWS CLI profile**: `zhy` for China credentials (`AWS_PROFILE=zhy`)
- **Image relay**: S3 (bingjiao-share-content) → Dev EC2 (69.231.161.57) → China ECR

## Supported Models

| Model | ID |
|-------|----|
| Nova 2 Lite (default) | `global.amazon.nova-2-lite-v1:0` |
| Claude Sonnet 4.5 | `global.anthropic.claude-sonnet-4-5-20250929-v1:0` |
| Claude Opus 4.6 | `global.anthropic.claude-opus-4-6-v1` |
| Claude Haiku 4.5 | `global.anthropic.claude-haiku-4-5-20251001-v1:0` |
| Nova Pro | `us.amazon.nova-pro-v1:0` |
| DeepSeek R1 | `us.deepseek.r1-v1:0` |
| Llama 3.3 70B | `us.meta.llama3-3-70b-instruct-v1:0` |
| Kimi K2.5 | `moonshotai.kimi-k2.5` |

## Commit Conventions

Use clear, descriptive messages. Examples from history:
- `Fix null safety crashes, add K8s name sanitization, UI test infrastructure`
- `Add gateway proxy for EKS instances — access OpenClaw UI from admin console`
- `Auto-deploy to EKS when creating agent with eks deploy mode`

Always include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` when Claude generates the commit.

## Security Notes

- IAM: least-privilege (Bedrock invoke, SSM parameters, S3 workspace, DynamoDB table)
- EKS Pod Identity (not IRSA) via `aws_eks_pod_identity_association`
- Gateway tokens generated per-instance, read from pod config, never exposed to browser
- Auth: JWT (HS256) with role-based access (admin, manager, employee)
- Docker sandbox enabled by default for session isolation

## License

MIT No Attribution (MIT-0)
