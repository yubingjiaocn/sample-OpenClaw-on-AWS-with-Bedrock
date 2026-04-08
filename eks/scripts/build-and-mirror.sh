#!/bin/bash
# =============================================================================
# Build admin console image and mirror all operator images to ECR
#
# Run this BEFORE terraform apply to ensure all container images are available.
#
# Usage:
#   # Global region (builds admin console, pushes to ECR)
#   bash build-and-mirror.sh --region us-west-2 --name openclaw-prod
#
#   # China region (builds admin console + mirrors ALL operator images to China ECR)
#   bash build-and-mirror.sh --region cn-northwest-1 --name openclaw-cn --profile china
#
# Prerequisites:
#   - Docker running locally
#   - AWS CLI configured (with --profile for China)
#   - Internet access to ghcr.io and Docker Hub (for mirror source)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[error]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

REGION="us-west-2"
NAME="openclaw-eks"
AWS_PROFILE_ARG=""
SKIP_BUILD=false
SKIP_MIRROR=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --region)      REGION="$2"; shift 2 ;;
    --name)        NAME="$2"; shift 2 ;;
    --profile)     AWS_PROFILE_ARG="--profile $2"; export AWS_PROFILE="$2"; shift 2 ;;
    --skip-build)  SKIP_BUILD=true; shift ;;
    --skip-mirror) SKIP_MIRROR=true; shift ;;
    *) error "Unknown flag: $1" ;;
  esac
done

IS_CHINA=false
[[ "$REGION" == cn-* ]] && IS_CHINA=true

ACCOUNT_ID=$(aws sts get-caller-identity $AWS_PROFILE_ARG --query Account --output text --region "$REGION")
if $IS_CHINA; then
  ECR_HOST="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com.cn"
else
  ECR_HOST="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
fi
ADMIN_ECR="${ECR_HOST}/${NAME}/admin-console"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Build & Mirror — ${NAME} (${REGION})"
echo "  Account: ${ACCOUNT_ID}"
echo "  ECR Host: ${ECR_HOST}"
echo "  China: ${IS_CHINA}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── ECR Login ──────────────────────────────────────────────────
info "Logging in to ECR..."
aws ecr get-login-password $AWS_PROFILE_ARG --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_HOST" 2>/dev/null
success "ECR login"

# ── Create admin console ECR repo ──────────────────────────────
info "Ensuring ECR repo: ${NAME}/admin-console"
aws ecr create-repository $AWS_PROFILE_ARG \
  --repository-name "${NAME}/admin-console" \
  --region "$REGION" 2>/dev/null || true

# ── Build admin console Docker image ──────────────────────────
if ! $SKIP_BUILD; then
  info "Building admin console Docker image..."
  cd "$REPO_ROOT/enterprise/admin-console"
  docker build -t "$ADMIN_ECR:latest" .
  success "Docker build complete"

  info "Pushing to $ADMIN_ECR:latest..."
  docker push "$ADMIN_ECR:latest"
  success "Admin console image pushed"
else
  warn "Skipping build (--skip-build)"
fi

# ── Mirror operator images (required for China, optional for global) ──
# These are ALL images the OpenClaw Operator may use for init containers,
# main containers, and sidecars. The spec.registry CRD field rewrites the
# registry portion of each image.
#
# Source registry → ECR path mapping:
#   ghcr.io/openclaw/openclaw:latest    → ${ECR}/openclaw/openclaw:latest
#   ghcr.io/astral-sh/uv:0.6-...       → ${ECR}/astral-sh/uv:0.6-...
#   nginx:1.27-alpine                   → ${ECR}/library/nginx:1.27-alpine
#   otel/opentelemetry-collector:0.120  → ${ECR}/otel/opentelemetry-collector:0.120
#   chromedp/headless-shell:stable      → ${ECR}/chromedp/headless-shell:stable
#   ghcr.io/tailscale/tailscale:latest  → ${ECR}/tailscale/tailscale:latest
#   ollama/ollama:latest                → ${ECR}/ollama/ollama:latest
#   tsl0922/ttyd:latest                 → ${ECR}/tsl0922/ttyd:latest
#   rclone/rclone:latest                → ${ECR}/rclone/rclone:latest
#   ghcr.io/openclaw-rocks/openclaw-operator:v0.25.2 → ${ECR}/openclaw-rocks/openclaw-operator:v0.25.2

MIRROR_IMAGES=(
  # Core — always needed
  "ghcr.io/openclaw/openclaw:latest|openclaw/openclaw:latest"
  "ghcr.io/astral-sh/uv:0.6-bookworm-slim|astral-sh/uv:0.6-bookworm-slim"
  "nginx:1.27-alpine|library/nginx:1.27-alpine"
  "otel/opentelemetry-collector:0.120.0|otel/opentelemetry-collector:0.120.0"

  # Sidecars — needed when enabled in CRD spec
  "chromedp/headless-shell:stable|chromedp/headless-shell:stable"
  "ghcr.io/tailscale/tailscale:latest|tailscale/tailscale:latest"
  "ollama/ollama:latest|ollama/ollama:latest"
  "tsl0922/ttyd:latest|tsl0922/ttyd:latest"

  # Backup — needed when spec.backup is configured
  "rclone/rclone:latest|rclone/rclone:latest"

  # Operator itself
  "ghcr.io/openclaw-rocks/openclaw-operator:v0.25.2|openclaw-rocks/openclaw-operator:v0.25.2"
)

if $IS_CHINA && ! $SKIP_MIRROR; then
  info "Mirroring ${#MIRROR_IMAGES[@]} images to China ECR..."
  echo ""

  MIRROR_FAIL=0
  for entry in "${MIRROR_IMAGES[@]}"; do
    SRC="${entry%%|*}"
    DST_PATH="${entry##*|}"
    DST="${ECR_HOST}/${DST_PATH}"
    DST_REPO="${DST_PATH%%:*}"

    printf "  %-55s → " "$SRC"

    # Create repo
    aws ecr create-repository $AWS_PROFILE_ARG \
      --repository-name "$DST_REPO" \
      --region "$REGION" 2>/dev/null || true

    # Pull
    if ! docker pull "$SRC" > /dev/null 2>&1; then
      echo -e "${RED}PULL FAILED${NC}"
      MIRROR_FAIL=$((MIRROR_FAIL + 1))
      continue
    fi

    # Tag + push
    docker tag "$SRC" "$DST"
    if docker push "$DST" > /dev/null 2>&1; then
      echo -e "${GREEN}OK${NC}"
    else
      echo -e "${RED}PUSH FAILED${NC}"
      MIRROR_FAIL=$((MIRROR_FAIL + 1))
    fi
  done

  echo ""
  if [[ $MIRROR_FAIL -eq 0 ]]; then
    success "All ${#MIRROR_IMAGES[@]} images mirrored to China ECR"
  else
    warn "${MIRROR_FAIL} image(s) failed to mirror"
  fi
elif $IS_CHINA; then
  warn "Skipping mirror (--skip-mirror)"
else
  info "Global region — image mirror not needed (ghcr.io accessible)"
fi

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}Done!${NC}"
echo ""
echo "  Admin Console: ${ADMIN_ECR}:latest"
if $IS_CHINA; then
  echo "  Registry:      ${ECR_HOST}"
  echo ""
  echo "  When deploying OpenClaw instances, set:"
  echo "    globalRegistry: ${ECR_HOST}"
fi
echo ""
echo "  Next: run terraform apply"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
