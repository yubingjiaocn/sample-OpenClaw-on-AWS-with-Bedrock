################################################################################
# Karpenter Module Outputs
################################################################################

output "karpenter_node_iam_role_name" {
  description = "Name of the IAM role for Karpenter-managed nodes (consumed by kata module)"
  value       = module.karpenter.node_iam_role_name
}

output "queue_name" {
  description = "Name of the SQS queue for Karpenter interruption handling"
  value       = module.karpenter.queue_name
}

output "standard_node_pool_name" {
  description = "Name of the standard ARM64 Karpenter NodePool"
  value       = "standard-arm64"
}
