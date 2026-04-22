################################################################################
# Karpenter Module Variables
################################################################################

variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
}

variable "cluster_endpoint" {
  description = "Endpoint URL of the EKS cluster API server"
  type        = string
}

variable "karpenter_version" {
  description = "Version of the Karpenter Helm chart to deploy"
  type        = string
  default     = "1.7.4"
}

variable "architecture" {
  description = "CPU architecture for standard nodes (amd64 or arm64)"
  type        = string

  validation {
    condition     = contains(["amd64", "arm64"], var.architecture)
    error_message = "architecture must be one of: amd64, arm64."
  }
}

variable "partition" {
  description = "AWS partition identifier (aws, aws-cn, or aws-us-gov)"
  type        = string
}

variable "tags" {
  description = "Tags to apply to all resources created by this module"
  type        = map(string)
  default     = {}
}
