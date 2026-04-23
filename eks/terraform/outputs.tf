output "configure_kubectl" {
  description = "Command to configure kubectl"
  value       = "aws eks --region ${local.region} update-kubeconfig --name ${module.eks_cluster.cluster_name}"
}

output "cluster_name" {
  description = "EKS cluster name"
  value       = module.eks_cluster.cluster_name
}

output "cluster_endpoint" {
  description = "EKS cluster endpoint"
  value       = module.eks_cluster.cluster_endpoint
}

output "operator_namespace" {
  description = "OpenClaw operator namespace"
  value       = local.operator_namespace
}

output "openclaw_namespace" {
  description = "OpenClaw workload namespace"
  value       = local.openclaw_namespace
}

output "vpc_id" {
  description = "VPC ID"
  value       = module.vpc.vpc_id
}

output "bedrock_role_arn" {
  description = "Bedrock IRSA role ARN for OpenClaw instances"
  value       = module.bedrock_iam.bedrock_role_arn
}


