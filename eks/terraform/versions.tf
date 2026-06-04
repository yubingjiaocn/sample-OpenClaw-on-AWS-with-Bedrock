terraform {
  required_version = ">= 1.3.2"

  # Optional S3 backend for workshop/production use
  # Uncomment and configure for remote state
  # backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.95"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.31"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.17"
    }
    # Pin kubectl provider: open-ended ">= 2.0" let alekc/kubectl drift to a
    # version that errors on unknown host at plan time ("no configuration has
    # been provided"), breaking first-apply provisioning. Pin to a known-good
    # minor and commit .terraform.lock.hcl to freeze the resolved versions.
    kubectl = {
      source  = "alekc/kubectl"
      version = "~> 2.1.0"
    }
  }
}
