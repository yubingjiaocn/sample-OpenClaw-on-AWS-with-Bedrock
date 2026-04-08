################################################################################
# Outputs for Admin Console Module
################################################################################

output "ecr_repository_url" {
  description = "ECR repository URL for the admin console image"
  value       = local.ecr_uri
}

output "dynamodb_table_name" {
  description = "DynamoDB table name for enterprise data"
  value       = aws_dynamodb_table.enterprise.name
}

output "s3_bucket_name" {
  description = "S3 bucket name for workspaces and SOUL templates"
  value       = aws_s3_bucket.workspaces.id
}

output "iam_role_arn" {
  description = "IAM role ARN for admin console Pod Identity"
  value       = aws_iam_role.admin_console.arn
}

output "service_account_name" {
  description = "Kubernetes ServiceAccount name"
  value       = local.service_account
}

output "service_url" {
  description = "In-cluster URL for the admin console service"
  value       = "http://admin-console.${var.openclaw_namespace}.svc:8099"
}

output "port_forward_command" {
  description = "kubectl port-forward command to access the admin console"
  value       = "kubectl -n ${var.openclaw_namespace} port-forward svc/admin-console 8099:8099"
}
