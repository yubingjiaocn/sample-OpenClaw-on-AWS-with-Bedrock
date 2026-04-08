# 在 Amazon EKS 上部署 OpenClaw

在 Amazon EKS 上部署 OpenClaw 企业管理控制台和 AI Agent 实例。支持 **AWS 全球区域**（us-west-2、us-east-1 等）和 **AWS 中国区域**（cn-northwest-1、cn-north-1）。

---

## 前提条件

### 通用要求

| 工具 | 版本要求 | 验证命令 |
|------|---------|---------|
| AWS CLI | >= 2.27 | `aws --version` |
| kubectl | >= 1.28 | `kubectl version --client` |
| Terraform | >= 1.3 | `terraform --version` |
| Docker | >= 20.0 | `docker --version` |
| Node.js | >= 22 | `node --version` |
| Helm | >= 3.12 | `helm version` |

### EKS Pod Identity Agent

两种部署方式均使用 [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html)（非 IRSA）进行 AWS 权限管理。验证或安装：

```bash
# 检查是否已安装
aws eks describe-addon --cluster-name 集群名称 --addon-name eks-pod-identity-agent --region 区域

# 如未安装
aws eks create-addon --cluster-name 集群名称 --addon-name eks-pod-identity-agent --region 区域
```

### 中国区域额外要求

AWS 中国区域（`cn-northwest-1`、`cn-north-1`）存在网络限制，需要提前准备：

| 要求 | 原因 | 处理方式 |
|------|------|---------|
| **镜像同步至中国区 ECR** | `ghcr.io` 和 Docker Hub 在中国大陆不可访问或极慢 | 运行 `build-and-mirror.sh`（见下方） |
| **第三方模型提供商** | Amazon Bedrock **不在中国区域运营** | 使用 LiteLLM 代理，或配置 Anthropic/OpenAI/DeepSeek 等 API Key |
| **AWS 中国账户** | 独立分区（`aws-cn`） | 需要单独的 IAM 凭证 |
| **AWS CLI Profile** | 中国账户需要独立的 Profile | `aws configure --profile china` |

#### 中国区模型提供商

Amazon Bedrock 不在 AWS 中国区域运营。有两种替代方案：

1. **LiteLLM 代理**（推荐）：在同一 EKS 集群部署 LiteLLM（Terraform 中设置 `enable_litellm = true`）。LiteLLM 提供 OpenAI 兼容接口，可路由至任意模型提供商。通过 `spec.config.raw` 配置 OpenClaw 实例使用 LiteLLM。

2. **直接 API Key**：通过 Kubernetes Secret 传入 API Key（如 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`），在 `spec.envFrom` 中引用。在 `spec.config.raw` 中配置模型指向提供商 API 端点。

#### 同步容器镜像至中国区 ECR

OpenClaw Operator 创建的 Pod 会从 `ghcr.io` 和 Docker Hub 拉取镜像。这些镜像仓库在中国大陆无法访问。**必须在部署 OpenClaw 实例之前将镜像同步到中国区 ECR。**

```bash
# 设置变量（按实际情况修改）
CN_ACCOUNT=834204282212
CN_REGION=cn-northwest-1
CN_REGISTRY="${CN_ACCOUNT}.dkr.ecr.${CN_REGION}.amazonaws.com.cn"

# 登录中国区 ECR
aws ecr get-login-password --region $CN_REGION --profile china \
  | docker login --username AWS --password-stdin $CN_REGISTRY

# 创建仓库（可重复执行）
for repo in openclaw/openclaw astral-sh/uv library/nginx otel/opentelemetry-collector; do
  aws ecr create-repository --repository-name "$repo" --region $CN_REGION --profile china 2>/dev/null || true
done

# 从全球区拉取，推送至中国区
declare -A IMAGES=(
  ["ghcr.io/openclaw/openclaw:latest"]="openclaw/openclaw:latest"
  ["ghcr.io/astral-sh/uv:0.6-bookworm-slim"]="astral-sh/uv:0.6-bookworm-slim"
  ["nginx:1.27-alpine"]="library/nginx:1.27-alpine"
  ["otel/opentelemetry-collector:0.120.0"]="otel/opentelemetry-collector:0.120.0"
)
for src in "${!IMAGES[@]}"; do
  docker pull "$src"
  docker tag "$src" "$CN_REGISTRY/${IMAGES[$src]}"
  docker push "$CN_REGISTRY/${IMAGES[$src]}"
done
```

> **提示**：建议在具有良好国际网络的机器上执行镜像同步（如全球区域的 EC2 实例），然后推送至中国区 ECR。

---

## 部署方式一：Terraform（推荐）

创建完整基础设施：VPC、EKS 集群、EFS、OpenClaw Operator、管理控制台及所有相关资源。

### 第一步：构建镜像（Terraform 之前执行）

Terraform 会创建 ECR 仓库和 K8s 部署，但必须先构建并推送 Docker 镜像。中国区域还需同步所有 Operator 使用的镜像。

```bash
# 全球区域
bash eks/scripts/build-and-mirror.sh --region us-west-2 --name openclaw-prod

# 中国区域（同时同步所有 Operator 镜像至中国区 ECR）
bash eks/scripts/build-and-mirror.sh --region cn-northwest-1 --name openclaw-cn --profile china
```

同步的镜像包括：

| 镜像 | 用途 |
|------|------|
| `ghcr.io/openclaw/openclaw:latest` | OpenClaw 主容器 |
| `ghcr.io/astral-sh/uv:0.6-bookworm-slim` | Python 依赖安装 Init 容器 |
| `nginx:1.27-alpine` | Gateway 代理 Sidecar |
| `otel/opentelemetry-collector:0.120.0` | 可观测性 Sidecar |
| `chromedp/headless-shell:stable` | 浏览器自动化 Sidecar |
| `ghcr.io/tailscale/tailscale:latest` | Tailscale VPN Sidecar |
| `ollama/ollama:latest` | 本地 LLM 推理 Sidecar |
| `tsl0922/ttyd:latest` | Web 终端 Sidecar |
| `rclone/rclone:latest` | S3 备份 Job |
| `ghcr.io/openclaw-rocks/openclaw-operator:v0.25.2` | Operator 本身 |

### 第二步：Terraform apply

#### 全球区域

```bash
cd eks/terraform
terraform init

terraform apply \
  -var="name=openclaw-prod" \
  -var="region=us-west-2" \
  -var="architecture=arm64" \
  -var="enable_efs=true" \
  -var="enable_admin_console=true" \
  -var="admin_password=您的安全密码"
```

#### 中国区域

```bash
cd eks/terraform

# 使用独立 workspace 隔离中国区状态
terraform workspace new china
terraform init

AWS_PROFILE=china terraform apply \
  -var="name=openclaw-cn" \
  -var="region=cn-northwest-1" \
  -var="architecture=x86" \
  -var="enable_efs=true" \
  -var="enable_admin_console=true" \
  -var="admin_password=您的安全密码"
```

Terraform 会在每次 apply 时自动填充 DynamoDB 示例数据和上传 SOUL 模板至 S3（幂等操作）。

### Terraform 变量参考

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `name` | `openclaw-eks` | 集群和资源名称前缀 |
| `region` | `us-west-2` | AWS 区域（自动检测 `cn-` 前缀为中国区） |
| `architecture` | `arm64` | `arm64`（Graviton）或 `x86` |
| `enable_efs` | `true` | 启用 EFS 持久化存储（设为默认 StorageClass） |
| `enable_admin_console` | `false` | 部署管理控制台（DynamoDB、S3、ECR、IAM、K8s） |
| `admin_password` | `""` | 管理员登录密码（启用控制台时必填） |
| `enable_kata` | `false` | 启用 Kata Containers（Firecracker 虚拟机隔离） |
| `enable_monitoring` | `false` | 启用 Prometheus + Grafana 监控栈 |

### 后续更新管理控制台镜像

如需更新管理控制台镜像：

```bash
ECR_URI=$(cd eks/terraform && terraform output -raw admin_console_ecr)
cd enterprise/admin-console && docker build -t $ECR_URI:latest . && docker push $ECR_URI:latest
kubectl -n openclaw rollout restart deployment/admin-console
```

---

## 部署方式二：独立脚本（无需 Terraform）

适用于**已有** EKS 集群的场景，仅创建管理控制台相关资源（不创建 VPC/EKS）。

### 全球区域

```bash
cd enterprise/admin-console

bash deploy-eks.sh \
  --cluster dev-cluster \
  --region us-west-2 \
  --password 管理员密码
```

### 中国区域

```bash
cd enterprise/admin-console

AWS_PROFILE=china bash deploy-eks.sh \
  --cluster openclaw-cn \
  --region cn-northwest-1 \
  --password 管理员密码
```

### 脚本参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--cluster` | （必填） | EKS 集群名称 |
| `--region` | `us-west-2` | AWS 区域 |
| `--namespace` | `openclaw` | Kubernetes 命名空间 |
| `--stack` | `openclaw-eks` | 资源名称前缀 |
| `--password` | `admin123` | 管理控制台登录密码 |
| `--skip-build` | false | 跳过 Docker 镜像构建 |
| `--skip-seed` | false | 跳过 DynamoDB 数据初始化 |

### 创建的资源

| 资源 | 命名规则 | 用途 |
|------|---------|------|
| ECR 仓库 | `{stack}/admin-console` | Docker 镜像存储 |
| DynamoDB 表 | `{stack}-enterprise` | 企业数据（单表设计） |
| S3 存储桶 | `{stack}-workspaces-{account}` | SOUL 模板、工作空间、知识库 |
| IAM 角色 | `{stack}-admin-console` | Pod Identity（DynamoDB/S3/SSM/EKS/ECR/CloudWatch） |
| SSM 参数 | `/openclaw/{stack}/*` | 密钥（密码、JWT） |
| K8s 资源 | ServiceAccount、Deployment、Service、ClusterRole | 管理控制台 Pod |

---

## 部署 OpenClaw Agent 实例

管理控制台运行后，可通过 UI 或 API 部署 AI Agent 实例。

### 通过 UI

1. 开启端口转发：`kubectl -n openclaw port-forward svc/admin-console 8099:8099`
2. 打开浏览器访问 `http://localhost:8099`
3. 进入 **Agent Factory** → **EKS** 标签页
4. 点击 **Deploy Agent** → 选择 Agent、模型和基础设施配置
5. **中国区域**：在 **Global Registry** 字段填入中国区 ECR 地址（例如 `834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn`）

### 通过 API

```bash
# 全球区域
curl -X POST http://localhost:8099/api/v1/admin/eks/agent-helpdesk/deploy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "bedrock/us.amazon.nova-2-lite-v1:0"}'

# 中国区域（设置全局镜像仓库）
curl -X POST http://localhost:8099/api/v1/admin/eks/agent-helpdesk/deploy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "bedrock/us.amazon.nova-2-lite-v1:0",
    "globalRegistry": "834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn"
  }'
```

### 部署 API 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `model` | Nova 2 Lite | Bedrock 模型 ID |
| `image` | ghcr.io/openclaw/openclaw | 主容器镜像（自定义构建用 ECR URI） |
| `globalRegistry` | （无） | **中国区域必填**：重写所有镜像的仓库地址 |
| `storageClass` | 集群默认 | K8s StorageClass（推荐 `efs-sc`） |
| `storageSize` | `10Gi` | PVC 大小 |
| `cpuRequest` / `cpuLimit` | `500m` / `2` | CPU 资源 |
| `memoryRequest` / `memoryLimit` | `2Gi` / `4Gi` | 内存资源 |
| `runtimeClass` | （无） | `kata-qemu`：启用 Firecracker 隔离 |
| `chromium` | `false` | 启用无头浏览器 Sidecar |
| `backupSchedule` | （无） | S3 备份的 Cron 表达式（如 `0 2 * * *`） |
| `serviceType` | `ClusterIP` | K8s Service 类型 |
| `nodeSelector` | （无） | 节点标签 JSON（如 `{"gpu": "true"}`） |
| `tolerations` | （无） | 容忍度 JSON |

---

## 集成测试

运行集成测试脚本验证部署：

```bash
# 全球区域
bash eks/scripts/integration-test.sh \
  --cluster openclaw-prod \
  --region us-west-2 \
  --password 密码

# 中国区域（指定镜像仓库）
bash eks/scripts/integration-test.sh \
  --cluster openclaw-cn \
  --region cn-northwest-1 \
  --password 密码 \
  --registry 834204282212.dkr.ecr.cn-northwest-1.amazonaws.com.cn
```

测试内容：登录、Operator 状态、实例部署、Pod 启动、PVC 存储类、镜像仓库覆盖、重载、重复部署拒绝、停止、UI 部署弹窗。

---

## 架构

```
┌─────────────────────────────────────────────────────┐
│  EKS 集群                                            │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │  openclaw 命名空间                                │ │
│  │                                                   │ │
│  │  ┌───────────────────┐  ┌──────────────────────┐│ │
│  │  │  管理控制台        │  │  OpenClawInstance     ││ │
│  │  │  (FastAPI+React)  │  │  (Operator 管理)      ││ │
│  │  │  端口 8099        │──│  StatefulSet+Service  ││ │
│  │  │  Pod Identity     │  │  +PVC (EFS)           ││ │
│  │  └────────┬──────────┘  └──────────────────────┘│ │
│  └───────────┼──────────────────────────────────────┘ │
│              │                                         │
│  ┌───────────┼──────────────────────────────────────┐ │
│  │  openclaw-operator-system 命名空间                 │ │
│  │  OpenClaw Operator（监听 CRD → 创建 K8s 资源）     │ │
│  └───────────────────────────────────────────────────┘ │
└──────────────┼─────────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │   AWS 服务           │
    │  Bedrock  DynamoDB  │
    │  S3  SSM  ECR  EFS  │
    └─────────────────────┘
```

### 运行时对比

| 运行时 | 隔离级别 | 默认存储 | 镜像来源 |
|--------|---------|---------|---------|
| **EKS Pod** | cgroups/命名空间 | EFS | ghcr.io（全球）/ ECR 镜像（中国） |
| **EKS + Kata** | Firecracker 微虚拟机 | EFS | 同上，加 `runtimeClass: kata-qemu` |
| **ECS Fargate** | Fargate 微虚拟机 | EFS 或 S3 同步 | 私有 ECR |
| **AgentCore** | Firecracker 微虚拟机 | Session Storage | 内置 |

---

## 安全考量

### 计算隔离

| 运行时 | 内核 | Prompt 注入风险 |
|--------|------|----------------|
| AgentCore / ECS | 独立微虚拟机 | 容器逃逸不可能 |
| **EKS Pod** | **共享宿主机内核** | 内核漏洞理论上可利用 |
| EKS + Kata | 独立 Firecracker 虚拟机 | 容器逃逸不可能 |

生产环境如有不可信代码执行需求，建议启用 Kata Containers（`enable_kata = true`）。

### Pod Identity vs IRSA

本部署使用 EKS Pod Identity（比 IRSA 更简单——无需 OIDC 提供商）。IAM 权限范围：

- **DynamoDB**：仅对企业数据表读写
- **S3**：仅对工作空间存储桶读写
- **SSM**：仅 `/openclaw/{stack}/*` 路径下的参数
- **EKS**：`ListClusters`、`DescribeCluster`（只读）
- **ECR**：镜像拉取（只读）
- **无 Bedrock 权限**——Agent 通过自身 IRSA 角色调用模型

---

## 故障排查

### Pod `ImagePullBackOff`（中国区域）

镜像无法从 ghcr.io / Docker Hub 拉取。部署实例时设置 `globalRegistry`：

```bash
# API 方式
curl -X POST .../deploy -d '{"globalRegistry": "中国区ECR地址"}'

# 或设置管理控制台环境变量（全局生效）
kubectl -n openclaw set env deployment/admin-console OPENCLAW_REGISTRY=中国区ECR地址
```

### Pod `Pending`（PVC 未绑定）

未设置默认 StorageClass。Terraform 会自动将 EFS 设为默认。手动部署的集群需执行：

```bash
kubectl annotate storageclass efs-sc storageclass.kubernetes.io/is-default-class=true
```

### Operator 未检测到

管理控制台会查找名为 `openclaw-operator` 或 `openclaw-operator-controller-manager` 的 Deployment：

```bash
kubectl get deployment -n openclaw-operator-system
```

### Pod Identity 403 错误

```bash
# 检查 addon
kubectl get pods -n kube-system -l app.kubernetes.io/name=eks-pod-identity-agent

# 检查关联
aws eks list-pod-identity-associations --cluster-name 集群名称 --namespace openclaw --region 区域
```

### 管理控制台 K8s API 403

管理控制台的 ServiceAccount 需要 ClusterRole。Terraform 会自动创建。手动部署时需要执行：

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
