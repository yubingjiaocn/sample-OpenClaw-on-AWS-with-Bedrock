# Deploying OpenClaw on Amazon EKS

Deploy the OpenClaw Enterprise Admin Console and AI agent instances to Amazon EKS. Supports both **AWS Global** regions (us-west-2, us-east-1, etc.) and **AWS China** regions (cn-northwest-1, cn-north-1).

---

## Prerequisites

### All Regions

| Requirement | Version | Check |
|-------------|---------|-------|
| AWS CLI     | >= 2.27 | `aws --version` |
| kubectl     | >= 1.28 | `kubectl version --client` |
| Terraform   | >= 1.3  | `terraform --version` |
| Docker      | >= 20.0 | `docker --version` |
| Node.js     | >= 22   | `node --version` |
| Helm        | >= 3.12 | `helm version` |

### EKS Pod Identity Agent

Both deploy methods use [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html) (not IRSA) for AWS access. Verify or install:

```bash
# Check if installed
aws eks describe-addon --cluster-name YOUR_CLUSTER \
  --addon-name eks-pod-identity-agent --region REGION

# Install if missing
aws eks create-addon --cluster-name YOUR_CLUSTER \
  --addon-name eks-pod-identity-agent --region REGION
```

### AWS Load Balancer Controller (for internet access)

To expose the admin console to the internet via ALB Ingress, the [AWS Load Balancer Controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/) must be installed. Terraform deploys it when `enable_alb_controller = true`.

### China Region Additional Prerequisites

AWS China regions (`cn-northwest-1`, `cn-north-1`) have network restrictions:

| Requirement | Why | How |
|-------------|-----|-----|
| **Image mirror to China ECR** | `ghcr.io` and Docker Hub are inaccessible | Run `build-and-mirror.sh` (see below) |
| **Third-party model provider** | Amazon Bedrock is **not available** in China | Use LiteLLM proxy or direct API keys |
| **AWS China account** | Separate partition (`aws-cn`) | Separate IAM credentials |
| **AWS CLI profile** | China account needs its own profile | `aws configure --profile china` |

#### Model provider for China

Amazon Bedrock does not operate in AWS China regions. Two options:

1. **LiteLLM proxy** (recommended): Deploy on the same cluster (`enable_litellm = true`). Provides an OpenAI-compatible endpoint that routes to any model provider.

2. **Direct API keys**: Create a Kubernetes Secret with provider keys and reference it in the OpenClawInstance CRD:

```bash
kubectl -n openclaw create secret generic model-api-keys \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...

kubectl -n openclaw patch openclawinstance AGENT_NAME --type=merge \
  -p '{"spec":{"envFrom":[{"secretRef":{"name":"model-api-keys"}}]}}'
```

#### Mirror container images to China ECR

Run the build-and-mirror script from a machine with global internet access:

```bash
bash eks/scripts/build-and-mirror.sh \
  --region cn-northwest-1 \
  --name openclaw-cn \
  --profile china
```

This builds the admin console image and mirrors all 10 operator images to China ECR:

| Image | Purpose |
|-------|---------|
| `ghcr.io/openclaw/openclaw:latest` | OpenClaw main container |
| `ghcr.io/astral-sh/uv:0.6-bookworm-slim` | Python deps init container |
| `nginx:1.27-alpine` | Gateway proxy sidecar |
| `otel/opentelemetry-collector:0.120.0` | Observability sidecar |
| `chromedp/headless-shell:stable` | Browser automation sidecar |
| `ghcr.io/tailscale/tailscale:latest` | Tailscale VPN sidecar |
| `ollama/ollama:latest` | Local LLM inference sidecar |
| `tsl0922/ttyd:latest` | Web terminal sidecar |
| `rclone/rclone:latest` | S3 backup job |
| `ghcr.io/openclaw-rocks/openclaw-operator:v0.25.2` | Operator itself |

---

## Deploy Method 1: Terraform (Recommended)

Creates the full stack: VPC, EKS cluster, EFS, ALB Controller, OpenClaw Operator, Admin Console (with Ingress), and all supporting AWS resources.

### Step 1: Build and push images

Terraform creates the ECR repository but does not build the Docker image. Run this first:

```bash
# Global
bash eks/scripts/build-and-mirror.sh --region us-west-2 --name openclaw-prod

# China (also mirrors all operator images)
bash eks/scripts/build-and-mirror.sh --region cn-northwest-1 --name openclaw-cn --profile china
```

### Step 2: Terraform apply

**Global region:**

```bash
cd eks/terraform
terraform init

terraform apply \
  -var="name=openclaw-prod" \
  -var="region=us-west-2" \
  -var="architecture=arm64" \
  -var="enable_efs=true" \
  -var="enable_alb_controller=true" \
  -var="enable_admin_console=true" \
  -var="admin_password=YOUR_SECURE_PASSWORD"
```

**China region:**

```bash
cd eks/terraform
terraform workspace new china
terraform init

AWS_PROFILE=china terraform apply \
  -var="name=openclaw-cn" \
  -var="region=cn-northwest-1" \
  -var="architecture=x86" \
  -var="enable_efs=true" \
  -var="enable_alb_controller=true" \
  -var="enable_admin_console=true" \
  -var="admin_password=YOUR_SECURE_PASSWORD"
```

Terraform automatically:
- Seeds DynamoDB with sample organization data (idempotent, won't overwrite existing records)
- Uploads SOUL templates to S3
- Creates an ALB Ingress for internet access
- Sets up RBAC (ClusterRole + ClusterRoleBinding) for K8s API access
- Configures Pod Identity for AWS API access

### Step 3: Access the admin console

After apply completes, get the ALB URL:

```bash
kubectl -n openclaw get ingress admin-console \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

Open the URL in your browser. Login with `emp-jiade` and the password you set.

For custom domain with HTTPS:

```bash
terraform apply \
  -var="admin_console_ingress_host=admin.openclaw.example.com" \
  -var="admin_console_certificate_arn=arn:aws:acm:REGION:ACCOUNT:certificate/CERT_ID" \
  ...
```

### Terraform variables reference

**Core:**

| Variable | Default | Description |
|----------|---------|-------------|
| `name` | `openclaw-eks` | Cluster and resource name prefix |
| `region` | `us-west-2` | AWS region (China auto-detected from `cn-` prefix) |
| `architecture` | `arm64` | `arm64` (Graviton) or `x86` |
| `enable_efs` | `true` | EFS for workspace persistence (set as default StorageClass) |
| `enable_alb_controller` | `false` | AWS Load Balancer Controller for ALB Ingress |
| `enable_kata` | `false` | Kata Containers for Firecracker VM isolation |
| `enable_monitoring` | `false` | Prometheus + Grafana monitoring stack |
| `enable_litellm` | `false` | LiteLLM OpenAI-compatible proxy (required for China) |

**Admin Console:**

| Variable | Default | Description |
|----------|---------|-------------|
| `enable_admin_console` | `false` | Deploy admin console |
| `admin_password` | `""` | Login password (required when enabled) |
| `admin_console_image_tag` | `latest` | Docker image tag |
| `admin_console_ingress_class` | `alb` | Ingress class name |
| `admin_console_ingress_host` | `""` | Custom hostname (empty = ALB DNS) |
| `admin_console_certificate_arn` | `""` | ACM certificate ARN for HTTPS |

### Updating the admin console

After updating the source code, rebuild and push:

```bash
ECR_URI=$(cd eks/terraform && terraform output -raw admin_console_ecr)
cd enterprise/admin-console
docker build -t $ECR_URI:latest .
docker push $ECR_URI:latest
kubectl -n openclaw rollout restart deployment/admin-console
```

---

## Deploy Method 2: Standalone Script (Existing Cluster)

Deploys to an **existing** EKS cluster using a Helm chart. Creates only admin console resources (no VPC/EKS).

**Global:**

```bash
cd enterprise/admin-console

bash deploy-eks.sh \
  --cluster dev-cluster \
  --region us-west-2 \
  --password YOUR_ADMIN_PASSWORD
```

**China:**

```bash
cd enterprise/admin-console

AWS_PROFILE=china bash deploy-eks.sh \
  --cluster openclaw-cn \
  --region cn-northwest-1 \
  --password YOUR_ADMIN_PASSWORD
```

The script uses `helm upgrade --install` internally, which deploys:
- ServiceAccount with optional IRSA annotations
- ClusterRole + ClusterRoleBinding (K8s API access for managing CRDs, reading pods/logs)
- Deployment (FastAPI + React, port 8099)
- Service (ClusterIP)

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

### AWS resources created

| Resource | Name Pattern | Purpose |
|----------|-------------|---------|
| ECR repository | `{stack}/admin-console` | Docker image storage |
| DynamoDB table | `{stack}-enterprise` | All enterprise data (single-table design) |
| S3 bucket | `{stack}-workspaces-{account}` | SOUL templates, workspaces, knowledge docs |
| IAM role | `{stack}-admin-console` | Pod Identity (DynamoDB, S3, SSM, EKS, ECR, CloudWatch) |
| SSM parameters | `/openclaw/{stack}/*` | Secrets (admin password, JWT) |

### Enabling internet access (standalone)

The standalone script deploys with ClusterIP only. To expose via ALB Ingress:

```bash
helm upgrade admin-console enterprise/admin-console/chart \
  --namespace openclaw \
  --reuse-values \
  --set ingress.enabled=true \
  --set ingress.className=alb \
  --set ingress.host=admin.openclaw.example.com \
  --set 'ingress.annotations.alb\.ingress\.kubernetes\.io/certificate-arn=ACM_ARN'
```

Or use `kubectl port-forward` for local access:

```bash
kubectl -n openclaw port-forward svc/admin-console 8099:8099
open http://localhost:8099
```

---

## Deploying OpenClaw Agent Instances

Once the admin console is running, deploy AI agent instances via the UI or API.

### Via UI

1. Open the admin console (ALB URL or `http://localhost:8099` via port-forward)
2. Navigate to **Agent Factory** > **EKS** tab
3. Click **Deploy Agent**
4. Configure:
   - **Agent**: Select from the list
   - **Model**: Choose a Bedrock model (global) or configure a third-party model (China)
   - **Container Image** / **Global Registry**: Set for custom or China ECR images
   - **Compute Resources**: CPU/memory requests and limits
   - **Storage**: StorageClass and size
   - **Chromium**: Enable headless browser sidecar
   - **Advanced**: Runtime class (Kata), service type, backup schedule, node selector, tolerations, config override (JSON)
5. Click **Deploy**

To edit a running instance's config, click the **gear icon** (⚙) in the EKS instances table. This opens a JSON editor showing the current `spec.config.raw`. Edit and click **Save & Restart** to deep-merge your changes and restart the pod.

### Via API

```bash
# Global
curl -X POST https://ADMIN_ALB_URL/api/v1/admin/eks/agent-helpdesk/deploy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "bedrock/us.amazon.nova-2-lite-v1:0"}'

# China (with global registry override for image mirroring)
curl -X POST https://ADMIN_ALB_URL/api/v1/admin/eks/agent-helpdesk/deploy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4-5-20250929",
    "globalRegistry": "ACCOUNT.dkr.ecr.cn-northwest-1.amazonaws.com.cn"
  }'
```

### Deploy API parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `model` | Nova 2 Lite | Bedrock model ID (or third-party model for China) |
| `image` | ghcr.io/openclaw/openclaw | Main container image URI |
| `globalRegistry` | (none) | **Required for China**: rewrites registry for ALL images |
| `storageClass` | cluster default (efs-sc) | K8s StorageClass |
| `storageSize` | `10Gi` | PVC size |
| `cpuRequest` / `cpuLimit` | `500m` / `2` | CPU resources |
| `memoryRequest` / `memoryLimit` | `2Gi` / `4Gi` | Memory resources |
| `runtimeClass` | (none) | `kata-qemu` for Firecracker VM isolation |
| `chromium` | `false` | Enable headless Chromium browser sidecar |
| `backupSchedule` | (none) | Cron for S3 backups (e.g., `0 2 * * *`) |
| `serviceType` | `ClusterIP` | K8s Service type (`ClusterIP`, `LoadBalancer`, `NodePort`) |
| `nodeSelector` | (none) | Node labels JSON (e.g., `{"gpu": "true"}`) |
| `tolerations` | (none) | Tolerations JSON (e.g., `[{"key":"kata","value":"true","effect":"NoSchedule"}]`) |
| `configOverride` | (none) | JSON object deep-merged into `spec.config.raw` (see below) |

### Custom Config Injection

The `configOverride` parameter (available on both deploy and reload) lets you override any part of the OpenClaw `openclaw.json` configuration without building custom container images. The JSON is **deep-merged** into the default Bedrock config — existing keys are preserved unless explicitly overridden.

#### Use cases

- **Custom model providers** — Use OpenAI-compatible APIs, self-hosted models, or LiteLLM proxy
- **Tool settings** — Override tool permissions, execution policies, or sandbox settings
- **Agent defaults** — Custom compaction settings, workspace paths, or bootstrap behavior
- **Gateway config** — Change auth mode, allowed origins, or control UI settings

#### API examples

```bash
# Deploy with an OpenAI-compatible model provider
curl -X POST https://ADMIN_ALB_URL/api/v1/admin/eks/agent-helpdesk/deploy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bedrock/us.amazon.nova-2-lite-v1:0",
    "configOverride": {
      "models": {
        "providers": {
          "custom-openai": {
            "baseUrl": "https://your-endpoint.com/v1",
            "apiKey": "sk-...",
            "models": [{ "id": "gpt-4o", "contextWindow": 128000, "maxTokens": 4096 }]
          }
        }
      },
      "agents": {
        "defaults": {
          "model": { "primary": "custom-openai/gpt-4o" }
        }
      }
    }
  }'

# Update a running instance's config (reload with override)
curl -X POST https://ADMIN_ALB_URL/api/v1/admin/eks/agent-helpdesk/reload \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "configOverride": {
      "agents": {
        "defaults": {
          "model": { "primary": "amazon-bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0" }
        }
      }
    }
  }'

# Read current config
curl https://ADMIN_ALB_URL/api/v1/admin/eks/agent-helpdesk/config \
  -H "Authorization: Bearer TOKEN"
```

#### LiteLLM proxy example

If you deployed the optional LiteLLM module (`enable_litellm = true` in Terraform), point agents to the in-cluster LiteLLM endpoint:

```json
{
  "configOverride": {
    "models": {
      "providers": {
        "litellm": {
          "baseUrl": "http://litellm.litellm.svc:4000/v1",
          "apiKey": "not-needed",
          "models": [
            { "id": "bedrock/claude-sonnet", "contextWindow": 200000, "maxTokens": 8192 },
            { "id": "bedrock/nova-pro", "contextWindow": 300000, "maxTokens": 5120 }
          ]
        }
      }
    },
    "agents": {
      "defaults": { "model": { "primary": "litellm/bedrock/claude-sonnet" } }
    }
  }
}
```

#### How deep-merge works

- **Dict values** merge recursively (both base and override keys are preserved)
- **List values** in the override replace the base entirely (no append)
- **Scalar values** in the override replace the base
- The original Bedrock provider config is preserved unless you explicitly override it

---

## Integration Test

Validate a deployment end-to-end:

```bash
# Global
bash eks/scripts/integration-test.sh \
  --cluster openclaw-prod \
  --region us-west-2 \
  --password YOUR_PASSWORD

# China
bash eks/scripts/integration-test.sh \
  --cluster openclaw-cn \
  --region cn-northwest-1 \
  --password YOUR_PASSWORD \
  --registry ACCOUNT.dkr.ecr.cn-northwest-1.amazonaws.com.cn
```

Tests: login, operator status, instance deploy, pod startup, PVC storage class, registry override, reload, duplicate rejection, stop, UI deploy modal.

---

## Architecture

```
                        Internet
                           |
                     ┌─────┴─────┐
                     │    ALB    │ (Ingress, HTTPS)
                     └─────┬─────┘
                           |
┌──────────────────────────┼─────────────────────────────┐
│  EKS Cluster             |                              │
│                          |                              │
│  ┌───────────────────────┼────────────────────────────┐│
│  │  openclaw namespace   |                             ││
│  │                       |                             ││
│  │  ┌────────────────────┴───┐  ┌───────────────────┐ ││
│  │  │  admin-console         │  │ OpenClawInstance   │ ││
│  │  │  (FastAPI + React)     │  │ (operator-managed) │ ││
│  │  │  Helm chart            │  │ StatefulSet+Svc    │ ││
│  │  │  Pod Identity → AWS    │  │ +PVC (EFS)         │ ││
│  │  └────────────────────────┘  └───────────────────┘ ││
│  └─────────────────────────────────────────────────────┘│
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │  openclaw-operator-system                             ││
│  │  OpenClaw Operator (reconciles CRDs → K8s resources)  ││
│  └──────────────────────────────────────────────────────┘│
└───────────────────────────┬──────────────────────────────┘
                            │
                 ┌──────────┴──────────┐
                 │    AWS Services     │
                 │  Bedrock   DynamoDB │
                 │  S3   SSM   ECR     │
                 │  EFS  ACM   WAF     │
                 └─────────────────────┘
```

### Runtime comparison

| Runtime | Isolation | Storage | Image Source |
|---------|-----------|---------|--------------|
| **EKS Pods** | cgroups / namespaces | EFS | ghcr.io (global) / ECR mirror (China) |
| **EKS + Kata** | Firecracker microVM | EFS | Same, with `runtimeClass: kata-qemu` |
| **ECS Fargate** | Fargate microVM | EFS or S3 | Private ECR |
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

### Pod Identity IAM Scope

The admin console uses EKS Pod Identity with least-privilege IAM:

- **DynamoDB**: CRUD on enterprise table only
- **S3**: Read/write on workspace bucket only
- **SSM**: Parameters under `/openclaw/{stack}/*` only
- **EKS**: `ListClusters`, `DescribeCluster` (read-only)
- **ECR**: Image pull (read-only)
- **No Bedrock access** — agents use their own IRSA role

### Ingress Security

The Helm chart's ALB Ingress supports:
- HTTPS with ACM certificates (`ingress.annotations.alb.ingress.kubernetes.io/certificate-arn`)
- HTTP-to-HTTPS redirect (enabled by default)
- WAFv2 integration (`ingress.annotations.alb.ingress.kubernetes.io/wafv2-acl-arn`)

For production, always use HTTPS with a custom domain and consider enabling WAFv2.

---

## Troubleshooting

### Pod `ImagePullBackOff` (China)

Images can't be pulled from ghcr.io / Docker Hub. Two fixes:

```bash
# Option 1: Set globalRegistry when deploying instances
curl -X POST .../deploy -d '{"globalRegistry": "YOUR_CN_ECR"}'

# Option 2: Set OPENCLAW_REGISTRY env var on admin console (applies to all deploys)
helm upgrade admin-console enterprise/admin-console/chart \
  --namespace openclaw --reuse-values \
  --set openclawRegistry=YOUR_CN_ECR
```

### Pod `Pending` (unbound PVC)

No default StorageClass. Terraform sets EFS as default automatically. For manual clusters:

```bash
kubectl annotate storageclass efs-sc \
  storageclass.kubernetes.io/is-default-class=true
```

### Ingress not provisioning ALB

Verify the AWS Load Balancer Controller is running:

```bash
kubectl get deployment -n kube-system aws-load-balancer-controller
```

If not installed, set `enable_alb_controller = true` in Terraform, or install manually:

```bash
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system --set clusterName=YOUR_CLUSTER
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
aws eks list-pod-identity-associations \
  --cluster-name CLUSTER --namespace openclaw --region REGION
```

### Admin console K8s API 403

Both Terraform and the standalone deploy script create RBAC automatically (via the Helm chart). If you see 403 errors after a manual install, the ClusterRole may be missing. Re-run the Helm install or apply RBAC manually:

```bash
helm upgrade admin-console enterprise/admin-console/chart \
  --namespace openclaw --reuse-values --set rbac.create=true
```

---

## China Region Deployment Guide (Offline)

China regions (cn-northwest-1, cn-north-1) cannot access ghcr.io, Docker Hub, or other overseas container registries. This guide explains how to deploy using **only a China EC2 instance**, relaying all overseas resources through your local PC.

### Network Assumptions

| Environment | Network Access |
|-------------|---------------|
| **Local PC** (Windows/Mac) | Can access GitHub, ghcr.io, Docker Hub |
| **China EC2 instance** | No access to ghcr.io/Docker Hub; can access same-region S3 and ECR |
| **EKS cluster nodes** | Can only pull from same-region ECR |

### Prerequisites

**On your local PC:**

| Tool | Purpose | Download |
|------|---------|----------|
| Docker Desktop | Pull and save images | https://www.docker.com/products/docker-desktop |
| AWS CLI v2 | Upload to S3 | https://aws.amazon.com/cli |
| Git | Clone the repository | https://git-scm.com |

**On the China EC2 instance:**

| Tool | Purpose |
|------|---------|
| Docker | Load and push images to ECR |
| AWS CLI v2 | S3 download, ECR operations |
| kubectl | Cluster management |
| Terraform >= 1.3 | Infrastructure deployment |
| Helm >= 3.12 | Application deployment |

### Step 1: Clone and Package the Project (Local PC)

```bash
git clone https://github.com/aws-samples/sample-OpenClaw-on-AWS-with-Bedrock.git
cd sample-OpenClaw-on-AWS-with-Bedrock

# Package the project (Terraform modules, Helm chart, scripts)
tar czf openclaw-eks-project.tar.gz \
  eks/ enterprise/ docs/ CLAUDE.md README.md
```

### Step 2: Pull and Save Container Images (Local PC)

Choose `--platform` based on your EKS node architecture (Graviton = `linux/arm64`, Intel/AMD = `linux/amd64`).

```bash
PLATFORM="linux/arm64"  # Graviton nodes
# PLATFORM="linux/amd64"  # Intel/AMD nodes

# Core images (required)
docker pull --platform $PLATFORM ghcr.io/openclaw/openclaw:latest
docker pull --platform $PLATFORM ghcr.io/astral-sh/uv:0.6-bookworm-slim
docker pull --platform $PLATFORM nginx:1.27-alpine
docker pull --platform $PLATFORM otel/opentelemetry-collector:0.120.0
docker pull --platform $PLATFORM ghcr.io/openclaw-rocks/openclaw-operator:v0.25.2

# Optional sidecar images
docker pull --platform $PLATFORM chromedp/headless-shell:stable   # Browser sandbox
docker pull --platform $PLATFORM rclone/rclone:latest              # Backup
docker pull --platform $PLATFORM tsl0922/ttyd:latest               # Web terminal
docker pull --platform $PLATFORM ghcr.io/tailscale/tailscale:latest  # VPN

# Save to tar.gz (batch to minimize transfers)
docker save \
  ghcr.io/openclaw/openclaw:latest \
  ghcr.io/astral-sh/uv:0.6-bookworm-slim \
  nginx:1.27-alpine \
  otel/opentelemetry-collector:0.120.0 \
  ghcr.io/openclaw-rocks/openclaw-operator:v0.25.2 \
  | gzip > core-images.tar.gz

docker save \
  chromedp/headless-shell:stable \
  rclone/rclone:latest \
  tsl0922/ttyd:latest \
  ghcr.io/tailscale/tailscale:latest \
  | gzip > sidecar-images.tar.gz
```

### Step 3: Build the Admin Console Image (Local PC)

```bash
cd enterprise/admin-console

# Cross-platform build (e.g., x86 PC targeting arm64 EKS)
docker buildx build --platform $PLATFORM -t openclaw-admin-console:latest --load .

docker save openclaw-admin-console:latest | gzip > admin-console.tar.gz
```

### Step 4: Transfer via S3 to China

S3 multipart upload is more reliable than cross-border Docker push and supports resume.

```bash
# Configure China AWS CLI profile (if not already done)
aws configure --profile china
# Region: cn-northwest-1
# Output: json

S3_BUCKET="your-china-s3-bucket"  # Use an existing bucket or create one

# Upload images and project package
aws s3 cp core-images.tar.gz s3://$S3_BUCKET/openclaw-deploy/ --profile china --region cn-northwest-1
aws s3 cp sidecar-images.tar.gz s3://$S3_BUCKET/openclaw-deploy/ --profile china --region cn-northwest-1
aws s3 cp admin-console.tar.gz s3://$S3_BUCKET/openclaw-deploy/ --profile china --region cn-northwest-1
aws s3 cp openclaw-eks-project.tar.gz s3://$S3_BUCKET/openclaw-deploy/ --profile china --region cn-northwest-1
```

> **Tip:** Cross-border S3 upload runs at ~1-2 MiB/s. Core images (~1GB) take ~15-20 minutes. Once uploaded, same-region S3→EC2 download is 200+ MiB/s.

### Step 5: Load Images on China EC2

```bash
S3_BUCKET="your-china-s3-bucket"
REGION="cn-northwest-1"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com.cn"

# Download (same-region, very fast)
aws s3 cp s3://$S3_BUCKET/openclaw-deploy/core-images.tar.gz /tmp/
aws s3 cp s3://$S3_BUCKET/openclaw-deploy/sidecar-images.tar.gz /tmp/
aws s3 cp s3://$S3_BUCKET/openclaw-deploy/admin-console.tar.gz /tmp/
aws s3 cp s3://$S3_BUCKET/openclaw-deploy/openclaw-eks-project.tar.gz ~/

# Extract project
cd ~ && tar xzf openclaw-eks-project.tar.gz

# Load Docker images
gunzip -c /tmp/core-images.tar.gz | docker load
gunzip -c /tmp/sidecar-images.tar.gz | docker load
gunzip -c /tmp/admin-console.tar.gz | docker load
```

### Step 6: Push Images to China ECR

```bash
# Login to ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR

NAME="openclaw-cn"  # Must match Terraform var.name

# Create ECR repositories (idempotent)
for repo in openclaw/openclaw astral-sh/uv library/nginx otel/opentelemetry-collector \
            openclaw-rocks/openclaw-operator chromedp/headless-shell rclone/rclone \
            tsl0922/ttyd tailscale/tailscale ${NAME}/admin-console; do
  aws ecr create-repository --repository-name $repo --region $REGION 2>/dev/null || true
done

# Tag and push core images
docker tag ghcr.io/openclaw/openclaw:latest $ECR/openclaw/openclaw:latest
docker tag ghcr.io/astral-sh/uv:0.6-bookworm-slim $ECR/astral-sh/uv:0.6-bookworm-slim
docker tag nginx:1.27-alpine $ECR/library/nginx:1.27-alpine
docker tag otel/opentelemetry-collector:0.120.0 $ECR/otel/opentelemetry-collector:0.120.0
docker tag ghcr.io/openclaw-rocks/openclaw-operator:v0.25.2 $ECR/openclaw-rocks/openclaw-operator:v0.25.2
docker tag openclaw-admin-console:latest $ECR/${NAME}/admin-console:latest

for img in openclaw/openclaw:latest astral-sh/uv:0.6-bookworm-slim \
           library/nginx:1.27-alpine otel/opentelemetry-collector:0.120.0 \
           openclaw-rocks/openclaw-operator:v0.25.2 ${NAME}/admin-console:latest; do
  echo "Pushing $img..."
  docker push $ECR/$img
done

# Push optional sidecar images
docker tag chromedp/headless-shell:stable $ECR/chromedp/headless-shell:stable
docker tag rclone/rclone:latest $ECR/rclone/rclone:latest
docker tag tsl0922/ttyd:latest $ECR/tsl0922/ttyd:latest
docker tag ghcr.io/tailscale/tailscale:latest $ECR/tailscale/tailscale:latest

for img in chromedp/headless-shell:stable rclone/rclone:latest \
           tsl0922/ttyd:latest tailscale/tailscale:latest; do
  docker push $ECR/$img
done

echo "All images pushed to $ECR"
```

### Step 7: Terraform Deploy

```bash
cd ~/eks/terraform

# Initialize (Terraform providers download from HashiCorp registry, accessible from China)
terraform workspace new china 2>/dev/null || terraform workspace select china
terraform init -input=false

# Deploy
terraform apply -auto-approve \
  -var="region=cn-northwest-1" \
  -var="name=openclaw-cn" \
  -var="architecture=arm64" \
  -var="enable_efs=true" \
  -var="enable_admin_console=true" \
  -var="admin_password=YourPassword" \
  -var="seed_demo_data=true"
```

> **Note:** The first `apply` may fail with K8s permission errors due to EKS access entry propagation delay. Re-run `terraform apply` to resolve. If a Helm release is stuck, run `helm uninstall <name> -n <ns>` then retry.

### Step 8: Verify

```bash
# Configure kubectl
aws eks --region cn-northwest-1 update-kubeconfig --name openclaw-cn

# Check nodes and pods
kubectl get nodes
kubectl get pods -A

# Port-forward to admin console
kubectl -n openclaw port-forward svc/admin-console 8099:8099
# Open http://localhost:8099 in your browser
```

### Image Update Workflow

To update images later, repeat Steps 2-6 (pull only changed images). You can also use `build-and-mirror.sh` with the `--platform` flag:

```bash
# On a machine with overseas registry access
bash eks/scripts/build-and-mirror.sh \
  --region cn-northwest-1 \
  --name openclaw-cn \
  --profile china \
  --platform linux/arm64 \
  --mirror
```

### File Manifest

Complete list of files needed for deployment:

| File | Size (approx.) | Description |
|------|----------------|-------------|
| `openclaw-eks-project.tar.gz` | ~5 MB | Terraform, Helm chart, scripts |
| `core-images.tar.gz` | ~1 GB | OpenClaw + operator + base images |
| `sidecar-images.tar.gz` | ~100 MB | Optional sidecars (excludes ollama) |
| `admin-console.tar.gz` | ~140 MB | Admin console Docker image |
| **Total** | **~1.3 GB** | |

> `ollama/ollama` (~3.4 GB) is too large for routine transfer. Only transfer it if you need local LLM inference.
