################################################################################
# Variables for OpenClaw Operator Module
################################################################################

variable "cluster_name" {
  description = "Name of the EKS cluster where the operator will be deployed"
  type        = string
}

variable "operator_namespace" {
  description = "Kubernetes namespace for the OpenClaw Operator"
  type        = string
  default     = "openclaw-operator-system"
}

variable "operator_version" {
  description = "Version of the OpenClaw Operator Helm chart to deploy"
  type        = string
  default     = "0.28.1"
}

variable "chart_repository" {
  description = "Override Helm chart OCI repository (e.g. oci://ECR_HOST/charts for China). Empty = default ghcr.io."
  type        = string
  default     = ""
}

variable "ecr_host" {
  description = "Private ECR host for China image mirrors (e.g. ACCOUNT.dkr.ecr.REGION.amazonaws.com.cn). Empty = use upstream."
  type        = string
  default     = ""
}

variable "is_china_region" {
  description = "Whether the deployment targets an AWS China region; when true, uses ECR mirror images"
  type        = bool
  default     = false
}

variable "tags" {
  description = "Tags to apply to all resources created by this module"
  type        = map(string)
  default     = {}
}
