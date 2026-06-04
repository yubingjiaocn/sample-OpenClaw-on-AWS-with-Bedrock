provider "aws" {
  region = local.region
}

provider "kubernetes" {
  host                   = module.eks_cluster.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks_cluster.cluster_ca_data)

  # Use exec-based auth (aws eks get-token) instead of the
  # data.aws_eks_cluster_auth token. The data-source token is resolved at
  # plan time, which forces provider config to evaluate before the cluster
  # exists; exec defers credential resolution to apply time and avoids
  # "no configuration has been provided" errors on first apply.
  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks_cluster.cluster_name, "--region", local.region]
  }
}

provider "helm" {
  kubernetes {
    host                   = module.eks_cluster.cluster_endpoint
    cluster_ca_certificate = base64decode(module.eks_cluster.cluster_ca_data)

    exec {
      api_version = "client.authentication.k8s.io/v1beta1"
      command     = "aws"
      args        = ["eks", "get-token", "--cluster-name", module.eks_cluster.cluster_name, "--region", local.region]
    }
  }

  # ECR Public OCI registry — auth required in global regions, anonymous in China
  # (aws-cn partition cannot reach the us-east-1 ecrpublic endpoint)
  dynamic "registry" {
    for_each = local.is_china_region ? [] : [1]
    content {
      url      = "oci://public.ecr.aws"
      username = "AWS"
      password = data.aws_ecrpublic_authorization_token.this[0].password
    }
  }
}

# ECR Public auth token — only available in global regions (requires us-east-1)
data "aws_ecrpublic_authorization_token" "this" {
  count    = local.is_china_region ? 0 : 1
  provider = aws.us_east_1
}

# us-east-1 provider alias for ECR Public token
# In China partition this alias still exists but points to the deploy region
# (the data source using it has count=0 so it's never called)
provider "aws" {
  alias  = "us_east_1"
  region = startswith(var.region, "cn-") ? var.region : "us-east-1"
}

provider "kubectl" {
  apply_retry_count      = 30
  host                   = module.eks_cluster.cluster_endpoint
  cluster_ca_certificate = base64decode(module.eks_cluster.cluster_ca_data)
  load_config_file       = false

  exec {
    api_version = "client.authentication.k8s.io/v1beta1"
    command     = "aws"
    args        = ["eks", "get-token", "--cluster-name", module.eks_cluster.cluster_name, "--region", local.region]
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

data "aws_availability_zones" "available" {
  filter {
    name   = "opt-in-status"
    values = ["opt-in-not-required"]
  }
}

data "aws_iam_session_context" "current" {
  arn = data.aws_caller_identity.current.arn
}

locals {
  name   = var.name
  region = var.region

  is_china_region = var.is_china_region != null ? var.is_china_region : startswith(var.region, "cn-")
  partition       = local.is_china_region ? "aws-cn" : "aws"
  dns_suffix      = local.is_china_region ? "amazonaws.com.cn" : "amazonaws.com"

  pod_identity_principal = "pods.eks.amazonaws.com"

  # ECR host for China region Helm chart mirroring (see china-image-mirror.sh)
  ecr_host         = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${local.region}.${local.dns_suffix}"
  chart_repository = local.is_china_region ? "oci://${local.ecr_host}/charts" : ""

  openclaw_namespace = "openclaw"
  operator_namespace = "openclaw-operator-system"
  kata_namespace     = "kata-system"

  azs = slice(data.aws_availability_zones.available.names, 0, 3)

  # Architecture-based instance type defaults
  default_core_instance_types = var.architecture == "arm64" ? ["m6g.xlarge"] : ["m5.xlarge"]
  core_instance_types         = length(var.core_instance_types) > 0 ? var.core_instance_types : local.default_core_instance_types

  default_kata_instance_types = var.architecture == "arm64" ? ["c6g.metal"] : ["m5.metal", "m5d.metal", "c5.metal", "c5d.metal"]
  kata_instance_types         = var.kata_instance_types != null ? var.kata_instance_types : local.default_kata_instance_types

  ami_type = var.architecture == "arm64" ? "AL2023_ARM_64_STANDARD" : "AL2023_x86_64_STANDARD"

  tags = {
    Blueprint  = local.name
    GithubRepo = "github.com/hitsub2/sample-OpenClaw-on-AWS-with-Bedrock"
    Workload   = "openclaw-eks"
    ManagedBy  = "terraform"
  }
}
