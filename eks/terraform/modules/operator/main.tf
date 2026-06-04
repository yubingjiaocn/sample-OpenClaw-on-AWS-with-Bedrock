################################################################################
# OpenClaw Operator Module
#
# Deploys the OpenClaw Operator into the EKS cluster via Helm.
# Supports both global and China region deployments with ECR mirror images.
################################################################################

# -----------------------------------------------------------------------------
# Operator Namespace
# -----------------------------------------------------------------------------
resource "kubernetes_namespace_v1" "operator" {
  metadata {
    name = var.operator_namespace
  }
}

# -----------------------------------------------------------------------------
# OpenClaw Operator Helm Release
# -----------------------------------------------------------------------------
resource "helm_release" "openclaw_operator" {
  name       = "openclaw-operator"
  repository = var.chart_repository != "" ? var.chart_repository : "oci://ghcr.io/paperclipinc/charts"
  chart      = "openclaw-operator"
  version    = var.operator_version
  namespace  = kubernetes_namespace_v1.operator.metadata[0].name

  set {
    name  = "crds.install"
    value = "true"
  }

  set {
    name  = "crds.keep"
    value = "true"
  }

  set {
    name  = "image.pullPolicy"
    value = "Always"
  }

  # Always override image.repository: the chart's values.yaml still defaults to
  # the old ghcr.io/openclaw-rocks/openclaw-operator namespace (even in the
  # latest chart releases), which now 404/403s after the upstream org rename to
  # paperclipinc. Without this override the operator pod hits ImagePullBackOff
  # and the helm_release hangs until timeout. China uses the private ECR mirror.
  set {
    name  = "image.repository"
    value = var.ecr_host != "" ? "${var.ecr_host}/paperclipinc/openclaw-operator" : "ghcr.io/paperclipinc/openclaw-operator"
  }

  # Always set image.tag explicitly. The published image tags are prefixed with
  # "v" (e.g. v0.28.1), but the chart appVersion is unprefixed (0.28.1), so the
  # chart default (tag="" -> appVersion) would resolve to a non-existent tag.
  set {
    name  = "image.tag"
    value = "v${var.operator_version}"
  }

  timeout = 600
}
