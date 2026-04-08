# Deploying OpenClaw on Amazon EKS

Deploy the OpenClaw Enterprise Admin Console and AI agent instances to Amazon EKS. Supports both **AWS Global** regions (us-west-2, us-east-1, etc.) and **AWS China** regions (cn-northwest-1, cn-north-1).

---

## Prerequisites

### All Regions

| Requirement | Version | Check |
|-------------|---------|-------|
| AWS CLI | >= 2.27 | `aws --version` |
| kubectl | >= 1.28 | `kubectl version --client` |
| Terraform | >= 1.3 | `terraform --version` |
| Docker | >= 20.0 | `docker --version` |
| Node.js | >= 22 | `node --version` |
| Helm | >= 3.12 | `helm version` |

### EKS Pod Identity Agent

Both deploy methods use [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html) (not IRSA) for AWS access. Verify or install:

```bash
# Check if installed
aws eks describe-addon --cluster-name YOUR_CLUSTER --addon-name eks-pod-identity-agent --region REGION

# Install if missing
aws eks create-addon --cluster-name YOUR_CLUSTER --addon-name eks-pod-identity-agent --region REGION
```

### China Region Additional Prerequisites

AWS China regions (`cn-northwest-1`, `cn-north-1`) have network restrictions that require extra preparation:

| Requirement | Why | How |
|-------------|-----|-----|
| **Image mirror to China ECR** | `ghcr.io` and Docker Hub are unreliable/blocked | Mirror images before deploying (see below) |
| **Third-party model provider** | Amazon Bedrock is **not available** in China regions | Use LiteLLM proxy, or configure API keys for Anthropic/OpenAI/DeepSeek directly |
| **AWS China account** | Separate partition (`aws-cn`) | Separate IAM credentials |
| **AWS CLI profile** | China account needs its own profile | `aws configure --profile china` |

#### Model provider for China

Amazon Bedrock does not operate in AWS China regions. You have two options:

1. **LiteLLM proxy** (recommended): Deploy LiteLLM on the same EKS cluster (`enable_litellm = true` in Terraform). LiteLLM provides an OpenAI-compatible endpoint that routes to any model provider. Configure the OpenClaw instance to use LiteLLM via `spec.config.raw`.

2. **Direct API keys**: Pass API keys (e.g., `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`) via a Kubernetes Secret referenced in `spec.envFrom`. Configure the model in `spec.config.raw` to point to the provider's API endpoint.

Example deploy with direct Anthropic API key (China):
```bash
# Create secret
kubectl -n openclaw create secret generic model-api-keys \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...

# Deploy with envFrom referencing the secret (via API)
curl -X POST .../deploy -d '{
  "model": "anthropic/claude-sonnet-4-5-20250929",
  "globalRegistry": "YOUR_CN_ECR",
  "skills": []
}'
# Then patch the CRD to add envFrom:
kubectl -n openclaw patch openclawinstance agent-helpdesk --type=merge \
  -p '{"spec":{"envFrom":[{"secretRef":{"name":"model-api-keys"}}]}}'
```

#### Mirror container images to China ECR

The OpenClaw Operator creates pods that pull images from `ghcr.io` and Docker Hub. These registries are inaccessible from China. Use the provided script to mirror all images before deploying:

```bash
# Run from a machine with global internet access (e.g., global-region EC2)
bash eks/scripts/build-and-mirror.sh \
  --region cn-northwest-1 \
  --name openclaw-cn \
  --profile china
```

This mirrors all 10 operator images (openclaw, uv, nginx, otel-collector, chromedp, tailscale, ollama, ttyd, rclone, operator) plus builds and pushes the admin console image. See the script for the full image list.

---

## Deploy Method 1: Terraform (Recommended)

Creates the full stack: VPC, EKS cluster, EFS, OpenClaw Operator, Admin Console, and all supporting resources.

### Step 1: Build images (before Terraform)

Terraform creates the ECR repository and K8s deployment, but the Docker image must be built and pushed first. For China, this also mirrors all operator images.

```bash
# Global region
bash eks/scripts/build-and-mirror.sh --region us-west-2 --name openclaw-prod

# China region (also mirrors ALL operator images to China ECR)
bash eks/scripts/build-and-mirror.sh --region cn-northwest-1 --name openclaw-cn --profile china
```

### Step 2: Terraform apply

#### Global Region

```bash
cd eks/terraform
terraform init

terraform apply \
  -var="name=openclaw-prod" \
  -var="region=us-west-2" \
  -var="architecture=arm64" \
  -var="enable_efs=true" \
  -var="enable_admin_console=true" \
  -var="admin_password=YOUR_SECURE_PASSWORD"
```

#### China Region

```bash
cd eks/terraform

# Use a separate workspace for China state isolation
terraform workspace new china
terraform init

AWS_PROFILE=china terraform apply \
  -var="name=openclaw-cn" \
  -var="region=cn-northwest-1" \
  -var="architecture=x86" \
  -var="enable_efs=true" \
  -var="enable_admin_console=true" \
  -var="admin_password=YOUR_SECURE_PASSWORD"
```

Terraform automatically seeds DynamoDB with sample organization data and uploads SOUL templates to S3 on every apply (idempotent).

### Terraform variables reference

| Variable | Default | Description |
|----------|---------|-------------|
| `name` | `openclaw-eks` | Cluster and resource name prefix |
| `region` | `us-west-2` | AWS region (China auto-detected from `cn-` prefix) |
| `architecture` | `arm64` | `arm64` (Graviton) or `x86` |
| `enable_efs` | `true` | EFS for workspace persistence (set as default StorageClass) |
| `enable_admin_console` | `false` | Deploy admin console (DynamoDB, S3, ECR, IAM, K8s) |
| `admin_password` | `""` | Admin login password (required when admin console enabled) |
| `enable_kata` | `false` | Kata Containers for Firecracker VM isolation |
| `enable_monitoring` | `false` | Prometheus + Grafana monitoring stack |
| `enable_litellm` | `false` | LiteLLM OpenAI-compatible proxy |

### After Terraform apply

If you need to update the admin console image after the initial deploy:

```bash
ECR_URI=$(cd eks/terraform && terraform output -raw admin_console_ecr)
cd enterprise/admin-console && docker build -t $ECR_URI:latest . && docker push $ECR_URI:latest
kubectl -n openclaw rollout restart deployment/admin-console
```

---

## Deploy Method 2: Standalone Script (No Terraform)

Deploys to an **existing** EKS cluster. Creates only the admin console resources (no VPC/EKS).

### Global Region

```bash
cd enterprise/admin-console

bash deploy-eks.sh \
  --cluster dev-cluster \
  --region us-west-2 \
  --password YOUR_ADMIN_PASSWORD
```

### China Region

```bash
cd enterprise/admin-console

AWS_PROFILE=china bash deploy-eks.sh \
  --cluster openclaw-cn \
  --region cn-northwest-1 \
  --password YOUR_ADMIN_PASSWORD
```

### Script flags

| Flag | Default | Description |
|------|---------|-------------|
| `--cluster` | (required) | EKS cluster name |
| `--region` | `us-west-2` | AWS region |
| `--namespace` | `openclaw` | Kubernetes namespace |
| `--stack` | `openclaw-eks` | Resource name prefix |
| `--password` | `admin123` | Admin console login password |
| `--skip-build` | false | Skip Docker image build |
| `--skip-seed` | false | Skip DynamoDB seed data |

### Resources created

| Resource | Name Pattern | Purpose |
|----------|-------------|---------|
| ECR repository | `{stack}/admin-console` | Docker image storage |
| DynamoDB table | `{stack}-enterprise` | All enterprise data (single-table) |
| S3 bucket | `{stack}-workspaces-{account}` | SOUL templates, workspaces, knowledge |
| IAM role | `{stack}-admin-console` | Pod Identity (DynamoDB, S3, SSM, EKS, ECR, CloudWatch) |
| SSM parameters | `/openclaw/{stack}/*` | Secrets (password, JWT) |
| K8s resources | ServiceAccount, Deployment, Service, ClusterRole | Admin console pod |

---

## Deploying OpenClaw Agent Instances

Once the admin console is running, deploy AI agent instances via the UI or API.

### Via UI

1. Open the admin console: `kubectl -n openclaw port-forward svc/admin-console 8099:8099`
2. Navigate to **Agent Factory** → **EKS** tab
3. Click **Deploy Agent** → select agent, model, and infrastructure options
4. For China: set **Global Registry** to your China ECR endpoint (e.g., `834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn`)

### Via API

```bash
# Global
curl -X POST http://localhost:8099/api/v1/admin/eks/agent-helpdesk/deploy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "bedrock/us.amazon.nova-2-lite-v1:0"}'

# China (with global registry override)
curl -X POST http://localhost:8099/api/v1/admin/eks/agent-helpdesk/deploy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bedrock/us.amazon.nova-2-lite-v1:0",
    "globalRegistry": "834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn"
  }'
```

### Deploy API parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | Nova 2 Lite | Bedrock model ID |
| `image` | ghcr.io/openclaw/openclaw | Main container image (ECR URI for custom builds) |
| `globalRegistry` | (none) | **Required for China**: rewrites registry for ALL images |
| `storageClass` | cluster default | K8s StorageClass (`efs-sc` recommended) |
| `storageSize` | `10Gi` | PVC size |
| `cpuRequest` / `cpuLimit` | `500m` / `2` | CPU resources |
| `memoryRequest` / `memoryLimit` | `2Gi` / `4Gi` | Memory resources |
| `runtimeClass` | (none) | `kata-qemu` for Firecracker isolation |
| `chromium` | `false` | Enable headless browser sidecar |
| `backupSchedule` | (none) | Cron for S3 backups (e.g., `0 2 * * *`) |
| `serviceType` | `ClusterIP` | K8s Service type |
| `nodeSelector` | (none) | Node labels JSON (e.g., `{"gpu": "true"}`) |
| `tolerations` | (none) | Tolerations JSON |

---

## Integration Test

Run the integration test script to validate a deployment:

```bash
# Global
bash eks/scripts/integration-test.sh \
  --cluster openclaw-prod \
  --region us-west-2 \
  --password YOUR_PASSWORD

# China (with registry)
bash eks/scripts/integration-test.sh \
  --cluster openclaw-cn \
  --region cn-northwest-1 \
  --password YOUR_PASSWORD \
  --registry 834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn
```

The test validates: login, operator status, instance deploy, pod startup, PVC storage class, registry override, reload, duplicate rejection, stop, and UI presence.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│  EKS Cluster                                         │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  openclaw namespace                              │ │
│  │                                                   │ │
│  │  ┌───────────────────┐  ┌──────────────────────┐│ │
│  │  │  admin-console    │  │  OpenClawInstance     ││ │
│  │  │  (FastAPI+React)  │  │  (operator-managed)   ││ │
│  │  │  port 8099        │──│  StatefulSet+Service  ││ │
│  │  │  Pod Identity     │  │  +PVC (EFS)           ││ │
│  │  └────────┬──────────┘  └──────────────────────┘│ │
│  └───────────┼──────────────────────────────────────┘ │
│              │                                         │
│  ┌───────────┼──────────────────────────────────────┐ │
│  │  openclaw-operator-system                         │ │
│  │  OpenClaw Operator (reconciles CRDs → K8s)        │ │
│  └───────────────────────────────────────────────────┘ │
└──────────────┼─────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │   AWS Services      │
    │  Bedrock  DynamoDB  │
    │  S3  SSM  ECR  EFS  │
    └─────────────────────┘
```

### Runtime comparison

| Runtime | Isolation | Default Storage | Image Source |
|---------|-----------|----------------|--------------|
| **EKS Pods** | cgroups/namespaces | EFS | ghcr.io (global) / ECR mirror (China) |
| **EKS + Kata** | Firecracker microVM | EFS | Same, with `runtimeClass: kata-qemu` |
| **ECS Fargate** | Fargate microVM | EFS or S3 sync | Private ECR |
| **AgentCore** | Firecracker microVM | Session Storage | Built-in |

---

## Security Considerations

### Compute Isolation

| Runtime | Kernel | Prompt injection risk |
|---------|--------|----------------------|
| AgentCore / ECS | Dedicated microVM | Container escape impossible |
| **EKS Pods** | **Shared host kernel** | Kernel exploit theoretically possible |
| EKS + Kata | Dedicated Firecracker VM | Container escape impossible |

For production with untrusted code execution, enable Kata Containers (`enable_kata = true`).

### Pod Identity vs IRSA

This deployment uses EKS Pod Identity (simpler than IRSA — no OIDC provider needed). IAM scope:

- **DynamoDB**: CRUD on enterprise table only
- **S3**: Read/write on workspace bucket only
- **SSM**: Parameters under `/openclaw/{stack}/*` only
- **EKS**: `ListClusters`, `DescribeCluster` (read-only)
- **ECR**: Image pull (read-only)
- **No Bedrock access** — agents use their own IRSA role for model invocation

---

## Troubleshooting

### Pod `ImagePullBackOff` (China)

Images can't be pulled from ghcr.io/Docker Hub. Set `globalRegistry` when deploying instances:

```bash
# API
curl -X POST .../deploy -d '{"globalRegistry": "YOUR_CN_ECR_REGISTRY"}'

# Or set env var on admin console deployment
kubectl -n openclaw set env deployment/admin-console OPENCLAW_REGISTRY=YOUR_CN_ECR_REGISTRY
```

### Pod `Pending` (unbound PVC)

No default StorageClass set. Terraform sets EFS as default. For manual clusters:

```bash
kubectl annotate storageclass efs-sc storageclass.kubernetes.io/is-default-class=true
```

### Operator not detected

The admin console checks for deployments named `openclaw-operator` or `openclaw-operator-controller-manager`:

```bash
kubectl get deployment -n openclaw-operator-system
```

### Pod Identity 403

```bash
# Verify addon
kubectl get pods -n kube-system -l app.kubernetes.io/name=eks-pod-identity-agent

# Verify association
aws eks list-pod-identity-associations --cluster-name CLUSTER --namespace openclaw --region REGION
```

### Admin console K8s API 403

The admin console ServiceAccount needs a ClusterRole. Terraform creates this automatically. For manual deploys, apply the RBAC:

```bash
kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: admin-console
rules:
  - apiGroups: ["openclaw.rocks"]
    resources: ["openclawinstances", "openclawselfconfigs"]
    verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
  - apiGroups: [""]
    resources: ["pods", "pods/log", "services", "serviceaccounts", "namespaces"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apiextensions.k8s.io"]
    resources: ["customresourcedefinitions"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: admin-console
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: admin-console
subjects:
  - kind: ServiceAccount
    name: admin-console
    namespace: openclaw
EOF
```
