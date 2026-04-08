################################################################################
# Variables for Admin Console Module
################################################################################

variable "name" {
  description = "Base name used for resource naming"
  type        = string
}

variable "cluster_name" {
  description = "Name of the EKS cluster"
  type        = string
}

variable "openclaw_namespace" {
  description = "Kubernetes namespace for the admin console"
  type        = string
  default     = "openclaw"
}

variable "region" {
  description = "AWS region for DynamoDB, S3, SSM"
  type        = string
}

variable "admin_password" {
  description = "Admin console login password (stored in SSM SecureString)"
  type        = string
  sensitive   = true
}

variable "image_repository" {
  description = "ECR repository URI for the admin console image. If empty, creates a new ECR repo."
  type        = string
  default     = ""
}

variable "image_tag" {
  description = "Docker image tag to deploy"
  type        = string
  default     = "latest"
}

variable "is_china_region" {
  description = "Whether the deployment targets an AWS China region"
  type        = bool
  default     = false
}

variable "partition" {
  description = "AWS partition (aws, aws-cn)"
  type        = string
  default     = "aws"
}

variable "ingress_class" {
  description = "Ingress class name (e.g. alb for AWS LB Controller)"
  type        = string
  default     = "alb"
}

variable "ingress_host" {
  description = "Hostname for the Ingress rule (empty = ALB DNS name, no host-based routing)"
  type        = string
  default     = ""
}

variable "ingress_certificate_arn" {
  description = "ACM certificate ARN for HTTPS on the ALB (optional)"
  type        = string
  default     = ""
}

variable "tags" {
  description = "Tags to apply to all resources"
  type        = map(string)
  default     = {}
}
