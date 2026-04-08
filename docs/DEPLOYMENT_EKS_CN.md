# 在 Amazon EKS 上部署 OpenClaw

在 Amazon EKS 上部署 OpenClaw 企业管理控制台和 AI Agent 实例。支持 **AWS 全球区域**（us-west-2、us-east-1 等）和 **AWS 中国区域**（cn-northwest-1、cn-north-1）。

---

## 前提条件

### 通用要求

| 工具        | 版本要求  | 验证命令 |
|-------------|----------|---------|
| AWS CLI     | >= 2.27  | `aws --version` |
| kubectl     | >= 1.28  | `kubectl version --client` |
| Terraform   | >= 1.3   | `terraform --version` |
| Docker      | >= 20.0  | `docker --version` |
| Node.js     | >= 22    | `node --version` |
| Helm        | >= 3.12  | `helm version` |

### EKS Pod Identity Agent

两种部署方式均使用 [EKS Pod Identity](https://docs.aws.amazon.com/eks/latest/userguide/pod-identities.html)（非 IRSA）进行 AWS 权限管理。验证或安装：

```bash
# 检查是否已安装
aws eks describe-addon --cluster-name 集群名称 \
  --addon-name eks-pod-identity-agent --region 区域

# 如未安装
aws eks create-addon --cluster-name 集群名称 \
  --addon-name eks-pod-identity-agent --region 区域
```

### AWS Load Balancer Controller（互联网访问）

如需通过 ALB Ingress 将管理控制台暴露到互联网，需要安装 [AWS Load Balancer Controller](https://kubernetes-sigs.github.io/aws-load-balancer-controller/)。Terraform 中设置 `enable_alb_controller = true` 即可自动部署。

### 中国区域额外要求

AWS 中国区域（`cn-northwest-1`、`cn-north-1`）存在网络限制：

| 要求 | 原因 | 处理方式 |
|------|------|---------|
| **镜像同步至中国区 ECR** | `ghcr.io` 和 Docker Hub 不可访问 | 运行 `build-and-mirror.sh` |
| **第三方模型提供商** | Amazon Bedrock **不在中国区域运营** | 使用 LiteLLM 代理或直接 API Key |
| **AWS 中国账户** | 独立分区（`aws-cn`） | 需要单独的 IAM 凭证 |
| **AWS CLI Profile** | 中国账户需要独立的 Profile | `aws configure --profile china` |

#### 中国区模型提供商

Amazon Bedrock 不在 AWS 中国区域运营。两种替代方案：

1. **LiteLLM 代理**（推荐）：在同一集群部署（Terraform 设置 `enable_litellm = true`）。提供 OpenAI 兼容接口，可路由至任意模型提供商。

2. **直接 API Key**：创建 Kubernetes Secret 并在 OpenClawInstance CRD 中引用：

```bash
kubectl -n openclaw create secret generic model-api-keys \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-...

kubectl -n openclaw patch openclawinstance AGENT名称 --type=merge \
  -p '{"spec":{"envFrom":[{"secretRef":{"name":"model-api-keys"}}]}}'
```

#### 同步容器镜像至中国区 ECR

在具有良好国际网络的机器上运行（如全球区域的 EC2 实例）：

```bash
bash eks/scripts/build-and-mirror.sh \
  --region cn-northwest-1 \
  --name openclaw-cn \
  --profile china
```

该脚本构建管理控制台镜像，并同步全部 10 个 Operator 镜像至中国区 ECR：

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

---

## 部署方式一：Terraform（推荐）

创建完整基础设施：VPC、EKS 集群、EFS、ALB Controller、OpenClaw Operator、管理控制台（含 Ingress）及所有 AWS 支撑资源。

### 第一步：构建并推送镜像

Terraform 会创建 ECR 仓库，但不会构建 Docker 镜像。需先执行：

```bash
# 全球区域
bash eks/scripts/build-and-mirror.sh --region us-west-2 --name openclaw-prod

# 中国区域（同时同步所有 Operator 镜像）
bash eks/scripts/build-and-mirror.sh --region cn-northwest-1 --name openclaw-cn --profile china
```

### 第二步：Terraform apply

**全球区域：**

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
  -var="admin_password=您的安全密码"
```

**中国区域：**

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
  -var="admin_password=您的安全密码"
```

Terraform 自动完成：
- DynamoDB 示例数据初始化（幂等操作，不覆盖已有记录）
- SOUL 模板上传至 S3
- 创建 ALB Ingress 暴露到互联网
- 配置 RBAC（ClusterRole + ClusterRoleBinding）实现 K8s API 访问
- 配置 Pod Identity 实现 AWS API 访问

### 第三步：访问管理控制台

Apply 完成后，获取 ALB 地址：

```bash
kubectl -n openclaw get ingress admin-console \
  -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
```

在浏览器中打开该地址。使用 `emp-jiade` 和设置的密码登录。

如需自定义域名和 HTTPS：

```bash
terraform apply \
  -var="admin_console_ingress_host=admin.openclaw.example.com" \
  -var="admin_console_certificate_arn=arn:aws:acm:区域:账户:certificate/证书ID" \
  ...
```

### Terraform 变量参考

**核心变量：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `name` | `openclaw-eks` | 集群和资源名称前缀 |
| `region` | `us-west-2` | AWS 区域（自动检测 `cn-` 前缀为中国区） |
| `architecture` | `arm64` | `arm64`（Graviton）或 `x86` |
| `enable_efs` | `true` | 启用 EFS 持久化存储（设为默认 StorageClass） |
| `enable_alb_controller` | `false` | 启用 AWS Load Balancer Controller（ALB Ingress） |
| `enable_kata` | `false` | 启用 Kata Containers（Firecracker 虚拟机隔离） |
| `enable_monitoring` | `false` | 启用 Prometheus + Grafana 监控栈 |
| `enable_litellm` | `false` | 启用 LiteLLM 代理（中国区域必需） |

**管理控制台变量：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `enable_admin_console` | `false` | 部署管理控制台 |
| `admin_password` | `""` | 登录密码（启用时必填） |
| `admin_console_image_tag` | `latest` | Docker 镜像标签 |
| `admin_console_ingress_class` | `alb` | Ingress 类名 |
| `admin_console_ingress_host` | `""` | 自定义域名（空 = ALB DNS） |
| `admin_console_certificate_arn` | `""` | ACM 证书 ARN（HTTPS） |

### 后续更新

更新管理控制台代码后，重新构建推送：

```bash
ECR_URI=$(cd eks/terraform && terraform output -raw admin_console_ecr)
cd enterprise/admin-console
docker build -t $ECR_URI:latest .
docker push $ECR_URI:latest
kubectl -n openclaw rollout restart deployment/admin-console
```

---

## 部署方式二：独立脚本（已有集群）

适用于**已有** EKS 集群的场景，通过 Helm Chart 部署。仅创建管理控制台相关资源。

**全球区域：**

```bash
cd enterprise/admin-console

bash deploy-eks.sh \
  --cluster dev-cluster \
  --region us-west-2 \
  --password 管理员密码
```

**中国区域：**

```bash
cd enterprise/admin-console

AWS_PROFILE=china bash deploy-eks.sh \
  --cluster openclaw-cn \
  --region cn-northwest-1 \
  --password 管理员密码
```

脚本内部使用 `helm upgrade --install`，自动部署：
- ServiceAccount（含可选 IRSA 注解）
- ClusterRole + ClusterRoleBinding（K8s API 访问权限：CRD 管理、Pod/日志读取）
- Deployment（FastAPI + React，端口 8099）
- Service（ClusterIP）

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

### 创建的 AWS 资源

| 资源 | 命名规则 | 用途 |
|------|---------|------|
| ECR 仓库 | `{stack}/admin-console` | Docker 镜像存储 |
| DynamoDB 表 | `{stack}-enterprise` | 企业数据（单表设计） |
| S3 存储桶 | `{stack}-workspaces-{account}` | SOUL 模板、工作空间、知识库 |
| IAM 角色 | `{stack}-admin-console` | Pod Identity 权限 |
| SSM 参数 | `/openclaw/{stack}/*` | 密钥（密码、JWT） |

### 启用互联网访问（独立部署）

独立脚本默认部署为 ClusterIP。如需通过 ALB 暴露到互联网：

```bash
helm upgrade admin-console enterprise/admin-console/chart \
  --namespace openclaw \
  --reuse-values \
  --set ingress.enabled=true \
  --set ingress.className=alb \
  --set ingress.host=admin.openclaw.example.com \
  --set 'ingress.annotations.alb\.ingress\.kubernetes\.io/certificate-arn=ACM_ARN'
```

或使用端口转发本地访问：

```bash
kubectl -n openclaw port-forward svc/admin-console 8099:8099
open http://localhost:8099
```

---

## 部署 OpenClaw Agent 实例

管理控制台运行后，可通过 UI 或 API 部署 AI Agent 实例。

### 通过 UI

1. 打开管理控制台（ALB 地址或 `http://localhost:8099`）
2. 进入 **Agent Factory** > **EKS** 标签页
3. 点击 **Deploy Agent**
4. 配置选项：
   - **Agent**：从列表中选择
   - **Model**：选择 Bedrock 模型（全球）或配置第三方模型（中国）
   - **Container Image** / **Global Registry**：自定义镜像或中国区 ECR 地址
   - **Compute Resources**：CPU / 内存的请求值和上限
   - **Storage**：StorageClass 和大小
   - **Chromium**：启用无头浏览器 Sidecar
   - **高级选项**：Runtime Class（Kata）、Service 类型、备份计划、节点选择器、容忍度、自定义配置（JSON）
5. 点击 **Deploy**

如需编辑运行中实例的配置，点击 EKS 实例表格中的 **齿轮图标**（⚙）。这将打开 JSON 编辑器，显示当前的 `spec.config.raw`。编辑后点击 **Save & Restart** 即可深度合并更改并重启 Pod。

### 通过 API

```bash
# 全球区域
curl -X POST https://ALB地址/api/v1/admin/eks/agent-helpdesk/deploy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model": "bedrock/us.amazon.nova-2-lite-v1:0"}'

# 中国区域（设置全局镜像仓库）
curl -X POST https://ALB地址/api/v1/admin/eks/agent-helpdesk/deploy \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4-5-20250929",
    "globalRegistry": "账户ID.dkr.ecr.cn-northwest-1.amazonaws.com.cn"
  }'
```

### 部署 API 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `model` | Nova 2 Lite | 模型 ID（中国区使用第三方模型） |
| `image` | ghcr.io/openclaw/openclaw | 主容器镜像 URI |
| `globalRegistry` | （无） | **中国区域必填**：重写所有镜像的仓库地址 |
| `storageClass` | 集群默认（efs-sc） | K8s StorageClass |
| `storageSize` | `10Gi` | PVC 大小 |
| `cpuRequest` / `cpuLimit` | `500m` / `2` | CPU 资源 |
| `memoryRequest` / `memoryLimit` | `2Gi` / `4Gi` | 内存资源 |
| `runtimeClass` | （无） | `kata-qemu`：Firecracker 虚拟机隔离 |
| `chromium` | `false` | 启用无头浏览器 Sidecar |
| `backupSchedule` | （无） | S3 备份 Cron 表达式（如 `0 2 * * *`） |
| `serviceType` | `ClusterIP` | K8s Service 类型 |
| `nodeSelector` | （无） | 节点标签 JSON |
| `tolerations` | （无） | 容忍度 JSON |
| `configOverride` | （无） | 深度合并到 `spec.config.raw` 的 JSON 对象（见下文） |

### 自定义配置注入

`configOverride` 参数（部署和重载均可用）允许您覆盖 OpenClaw `openclaw.json` 配置的任何部分，无需构建自定义容器镜像。该 JSON 将**深度合并**到默认的 Bedrock 配置中 —— 未显式覆盖的现有配置会被保留。

#### 使用场景

- **自定义模型提供商** —— 使用 OpenAI 兼容 API、自托管模型或 LiteLLM 代理
- **工具设置** —— 覆盖工具权限、执行策略或沙盒设置
- **Agent 默认值** —— 自定义压缩设置、工作空间路径或启动行为
- **Gateway 配置** —— 更改认证模式、允许的来源或控制台 UI 设置

#### API 示例

```bash
# 部署时使用 OpenAI 兼容模型提供商
curl -X POST https://ALB地址/api/v1/admin/eks/agent-helpdesk/deploy \
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

# 更新运行中实例的配置（重载并覆盖）
curl -X POST https://ALB地址/api/v1/admin/eks/agent-helpdesk/reload \
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

# 读取当前配置
curl https://ALB地址/api/v1/admin/eks/agent-helpdesk/config \
  -H "Authorization: Bearer TOKEN"
```

#### LiteLLM 代理示例

如果部署了可选的 LiteLLM 模块（Terraform 中 `enable_litellm = true`），可将 Agent 指向集群内 LiteLLM 端点：

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

#### 深度合并规则

- **字典值**递归合并（基础配置和覆盖配置的键均会保留）
- **列表值**由覆盖配置完全替换（不追加）
- **标量值**由覆盖配置替换
- 除非显式覆盖，原始 Bedrock 提供商配置将被保留

---

## 集成测试

运行集成测试脚本验证部署：

```bash
# 全球区域
bash eks/scripts/integration-test.sh \
  --cluster openclaw-prod \
  --region us-west-2 \
  --password 密码

# 中国区域
bash eks/scripts/integration-test.sh \
  --cluster openclaw-cn \
  --region cn-northwest-1 \
  --password 密码 \
  --registry 账户ID.dkr.ecr.cn-northwest-1.amazonaws.com.cn
```

测试内容：登录、Operator 状态、实例部署、Pod 启动、PVC 存储类、镜像仓库覆盖、重载、重复部署拒绝、停止、UI 部署弹窗。

---

## 架构

```
                        互联网
                          |
                    ┌─────┴─────┐
                    │    ALB    │ (Ingress, HTTPS)
                    └─────┬─────┘
                          |
┌─────────────────────────┼────────────────────────────┐
│  EKS 集群               |                            │
│                         |                            │
│  ┌──────────────────────┼──────────────────────────┐ │
│  │  openclaw 命名空间    |                          │ │
│  │                      |                          │ │
│  │  ┌───────────────────┴──┐  ┌──────────────────┐ │ │
│  │  │  管理控制台           │  │ OpenClawInstance  │ │ │
│  │  │  (FastAPI + React)   │  │ (Operator 管理)   │ │ │
│  │  │  Helm Chart 部署     │  │ StatefulSet+Svc   │ │ │
│  │  │  Pod Identity → AWS  │  │ +PVC (EFS)        │ │ │
│  │  └──────────────────────┘  └──────────────────┘ │ │
│  └──────────────────────────────────────────────────┘ │
│                                                        │
│  ┌────────────────────────────────────────────────────┐│
│  │  openclaw-operator-system 命名空间                  ││
│  │  OpenClaw Operator（监听 CRD → 创建 K8s 资源）      ││
│  └────────────────────────────────────────────────────┘│
└────────────────────────────┬───────────────────────────┘
                             │
                  ┌──────────┴──────────┐
                  │    AWS 服务          │
                  │  Bedrock   DynamoDB │
                  │  S3   SSM   ECR    │
                  │  EFS  ACM   WAF    │
                  └─────────────────────┘
```

### 运行时对比

| 运行时 | 隔离级别 | 存储 | 镜像来源 |
|--------|---------|------|---------|
| **EKS Pod** | cgroups / 命名空间 | EFS | ghcr.io（全球）/ ECR 镜像（中国） |
| **EKS + Kata** | Firecracker 微虚拟机 | EFS | 同上，加 `runtimeClass: kata-qemu` |
| **ECS Fargate** | Fargate 微虚拟机 | EFS 或 S3 | 私有 ECR |
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

### Pod Identity IAM 权限范围

管理控制台使用 EKS Pod Identity，遵循最小权限原则：

- **DynamoDB**：仅对企业数据表读写
- **S3**：仅对工作空间存储桶读写
- **SSM**：仅 `/openclaw/{stack}/*` 路径下的参数
- **EKS**：`ListClusters`、`DescribeCluster`（只读）
- **ECR**：镜像拉取（只读）
- **无 Bedrock 权限**——Agent 通过自身 IRSA 角色调用模型

### Ingress 安全

Helm Chart 的 ALB Ingress 支持：
- 通过 ACM 证书启用 HTTPS（`ingress.annotations.alb.ingress.kubernetes.io/certificate-arn`）
- HTTP 自动跳转 HTTPS（默认启用）
- WAFv2 集成（`ingress.annotations.alb.ingress.kubernetes.io/wafv2-acl-arn`）

生产环境建议始终使用自定义域名 + HTTPS，并考虑启用 WAFv2。

---

## 故障排查

### Pod `ImagePullBackOff`（中国区域）

镜像无法从 ghcr.io / Docker Hub 拉取。两种修复方式：

```bash
# 方式 1：部署实例时指定 globalRegistry
curl -X POST .../deploy -d '{"globalRegistry": "中国区ECR地址"}'

# 方式 2：在 Helm 中全局设置 OPENCLAW_REGISTRY（所有部署生效）
helm upgrade admin-console enterprise/admin-console/chart \
  --namespace openclaw --reuse-values \
  --set openclawRegistry=中国区ECR地址
```

### Pod `Pending`（PVC 未绑定）

未设置默认 StorageClass。Terraform 自动将 EFS 设为默认。手动部署的集群需执行：

```bash
kubectl annotate storageclass efs-sc \
  storageclass.kubernetes.io/is-default-class=true
```

### Ingress 未创建 ALB

检查 AWS Load Balancer Controller 是否运行：

```bash
kubectl get deployment -n kube-system aws-load-balancer-controller
```

如未安装，Terraform 中设置 `enable_alb_controller = true`，或手动安装：

```bash
helm repo add eks https://aws.github.io/eks-charts
helm install aws-load-balancer-controller eks/aws-load-balancer-controller \
  -n kube-system --set clusterName=集群名称
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
aws eks list-pod-identity-associations \
  --cluster-name 集群名称 --namespace openclaw --region 区域
```

### 管理控制台 K8s API 403

Terraform 和独立部署脚本均通过 Helm Chart 自动创建 RBAC。如手动安装后出现 403，重新执行 Helm 安装即可：

```bash
helm upgrade admin-console enterprise/admin-console/chart \
  --namespace openclaw --reuse-values --set rbac.create=true
```
