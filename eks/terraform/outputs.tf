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

output "admin_console_url" {
  description = "Admin console access (ALB URL or port-forward command)"
  value = var.enable_admin_console ? (
    var.admin_console_ingress_host != "" ? "https://${var.admin_console_ingress_host}" : module.admin_console[0].ingress_command
  ) : "Admin console not enabled"
}

output "admin_console_ecr" {
  description = "Admin console ECR repository URL (when enabled)"
  value       = var.enable_admin_console ? module.admin_console[0].ecr_repository_url : ""
}
