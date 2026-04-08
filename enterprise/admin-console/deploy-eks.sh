#!/bin/bash
# =============================================================================
# OpenClaw Admin Console — Deploy to EKS (standalone, no Terraform required)
#
# Usage:
#   bash deploy-eks.sh                          # full deploy
#   bash deploy-eks.sh --skip-build             # redeploy without rebuilding image
#   bash deploy-eks.sh --skip-seed              # redeploy without re-seeding DynamoDB
#   bash deploy-eks.sh --cluster dev-cluster    # specify cluster name
#   bash deploy-eks.sh --region us-west-2       # specify region
#
# Prerequisites:
#   - aws cli configured with appropriate permissions
#   - kubectl configured for the target cluster
#   - docker (for building the image)
#   - npm (for building the frontend)
#
# What this script does:
#   1. Creates ECR repo (if needed)
#   2. Builds and pushes Docker image
#   3. Creates DynamoDB table (if needed)
#   4. Creates S3 bucket (if needed)
#   5. Creates IAM role with Pod Identity
#   6. Seeds DynamoDB with org data
#   7. Uploads SOUL templates to S3
#   8. Deploys to EKS (ServiceAccount, Deployment, Service)
# =============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()    { echo -e "${CYAN}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[error]${NC} $*"; exit 1; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENTERPRISE_DIR="$(dirname "$SCRIPT_DIR")"

# ── Defaults ─────────────────────────────────────────────────────────────────
CLUSTER_NAME="${CLUSTER_NAME:-}"
REGION="${REGION:-us-west-2}"
NAMESPACE="${NAMESPACE:-openclaw}"
STACK_NAME="${STACK_NAME:-openclaw-eks}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-admin123}"
SKIP_BUILD="${SKIP_BUILD:-false}"
SKIP_SEED="${SKIP_SEED:-false}"

# ── Parse CLI flags ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --cluster)   CLUSTER_NAME="$2"; shift 2 ;;
    --region)    REGION="$2"; shift 2 ;;
    --namespace) NAMESPACE="$2"; shift 2 ;;
    --stack)     STACK_NAME="$2"; shift 2 ;;
    --password)  ADMIN_PASSWORD="$2"; shift 2 ;;
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-seed)  SKIP_SEED=true; shift ;;
    *) error "Unknown flag: $1" ;;
  esac
done

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text) \
  || error "AWS credentials not configured"

[ -z "$CLUSTER_NAME" ] && error "EKS cluster name required. Use --cluster NAME"

# Validate cluster exists
aws eks describe-cluster --name "$CLUSTER_NAME" --region "$REGION" &>/dev/null \
  || error "Cluster '$CLUSTER_NAME' not found in $REGION"

# Ensure kubectl context points to this cluster
aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$REGION" &>/dev/null

ECR_REPO="${STACK_NAME}/admin-console"
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${ECR_REPO}"
DDB_TABLE="${STACK_NAME}-enterprise"
S3_BUCKET="${STACK_NAME}-workspaces-${ACCOUNT_ID}"
IAM_ROLE="${STACK_NAME}-admin-console"
JWT_SECRET=$(openssl rand -hex 32)

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  OpenClaw Admin Console — Deploy to EKS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Cluster:     $CLUSTER_NAME"
echo "  Region:      $REGION"
echo "  Account:     $ACCOUNT_ID"
echo "  Namespace:   $NAMESPACE"
echo "  Stack:       $STACK_NAME"
echo "  DynamoDB:    $DDB_TABLE"
echo "  S3:          $S3_BUCKET"
echo "  ECR:         $ECR_URI"
echo "  Skip build:  $SKIP_BUILD"
echo "  Skip seed:   $SKIP_SEED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Step 1: ECR Repository ───────────────────────────────────────────────────
info "[1/8] ECR repository..."
aws ecr describe-repositories --repository-names "$ECR_REPO" --region "$REGION" &>/dev/null || \
  aws ecr create-repository --repository-name "$ECR_REPO" --region "$REGION" --query 'repository.repositoryUri' --output text &>/dev/null
success "ECR: $ECR_URI"

# ── Step 2: Build and push Docker image ──────────────────────────────────────
if [ "$SKIP_BUILD" = "true" ]; then
  info "[2/8] Skipping Docker build (--skip-build)"
else
  info "[2/8] Building Docker image..."
  aws ecr get-login-password --region "$REGION" | \
    docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com" &>/dev/null

  docker build -t "$ECR_URI:latest" "$SCRIPT_DIR"
  docker push "$ECR_URI:latest"
  success "Image pushed: $ECR_URI:latest"
fi

# ── Step 3: DynamoDB table ───────────────────────────────────────────────────
info "[3/8] DynamoDB table..."
TABLE_STATUS=$(aws dynamodb describe-table --table-name "$DDB_TABLE" --region "$REGION" \
  --query 'Table.TableStatus' --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$TABLE_STATUS" = "NOT_FOUND" ]; then
  aws dynamodb create-table \
    --table-name "$DDB_TABLE" \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
    --key-schema \
      AttributeName=PK,KeyType=HASH \
      AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes '[{
      "IndexName":"GSI1",
      "KeySchema":[
        {"AttributeName":"GSI1PK","KeyType":"HASH"},
        {"AttributeName":"GSI1SK","KeyType":"RANGE"}
      ],
      "Projection":{"ProjectionType":"ALL"}
    }]' \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" &>/dev/null
  aws dynamodb wait table-exists --table-name "$DDB_TABLE" --region "$REGION"
  success "DynamoDB table created: $DDB_TABLE"
else
  success "DynamoDB table exists: $DDB_TABLE ($TABLE_STATUS)"
fi

# ── Step 4: S3 bucket ───────────────────────────────────────────────────────
info "[4/8] S3 bucket..."
if aws s3api head-bucket --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null; then
  success "S3 bucket exists: $S3_BUCKET"
else
  aws s3api create-bucket --bucket "$S3_BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" &>/dev/null
  aws s3api put-bucket-versioning --bucket "$S3_BUCKET" --region "$REGION" \
    --versioning-configuration Status=Enabled &>/dev/null
  success "S3 bucket created: $S3_BUCKET"
fi

# ── Step 5: IAM Role (Pod Identity) ─────────────────────────────────────────
info "[5/8] IAM role (Pod Identity)..."
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/${IAM_ROLE}"
if aws iam get-role --role-name "$IAM_ROLE" &>/dev/null; then
  success "IAM role exists: $IAM_ROLE"
else
  aws iam create-role --role-name "$IAM_ROLE" \
    --assume-role-policy-document '{
      "Version": "2012-10-17",
      "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "pods.eks.amazonaws.com"},
        "Action": ["sts:AssumeRole", "sts:TagSession"]
      }]
    }' &>/dev/null

  aws iam put-role-policy --role-name "$IAM_ROLE" \
    --policy-name "admin-console-access" \
    --policy-document "{
      \"Version\": \"2012-10-17\",
      \"Statement\": [
        {
          \"Sid\": \"DynamoDB\",
          \"Effect\": \"Allow\",
          \"Action\": [
            \"dynamodb:GetItem\", \"dynamodb:PutItem\", \"dynamodb:UpdateItem\",
            \"dynamodb:DeleteItem\", \"dynamodb:Query\", \"dynamodb:Scan\",
            \"dynamodb:BatchGetItem\", \"dynamodb:BatchWriteItem\", \"dynamodb:DescribeTable\"
          ],
          \"Resource\": [
            \"arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${DDB_TABLE}\",
            \"arn:aws:dynamodb:${REGION}:${ACCOUNT_ID}:table/${DDB_TABLE}/index/*\"
          ]
        },
        {
          \"Sid\": \"S3\",
          \"Effect\": \"Allow\",
          \"Action\": [
            \"s3:GetObject\", \"s3:PutObject\", \"s3:DeleteObject\",
            \"s3:ListBucket\", \"s3:GetObjectVersion\", \"s3:ListBucketVersions\"
          ],
          \"Resource\": [
            \"arn:aws:s3:::${S3_BUCKET}\",
            \"arn:aws:s3:::${S3_BUCKET}/*\"
          ]
        },
        {
          \"Sid\": \"SSM\",
          \"Effect\": \"Allow\",
          \"Action\": [
            \"ssm:GetParameter\", \"ssm:GetParameters\", \"ssm:GetParametersByPath\",
            \"ssm:PutParameter\", \"ssm:DeleteParameter\"
          ],
          \"Resource\": \"arn:aws:ssm:${REGION}:${ACCOUNT_ID}:parameter/openclaw/${STACK_NAME}/*\"
        },
        {
          \"Sid\": \"EKS\",
          \"Effect\": \"Allow\",
          \"Action\": [\"eks:ListClusters\", \"eks:DescribeCluster\"],
          \"Resource\": \"*\"
        },
        {
          \"Sid\": \"ECR\",
          \"Effect\": \"Allow\",
          \"Action\": [
            \"ecr:GetAuthorizationToken\", \"ecr:BatchCheckLayerAvailability\",
            \"ecr:GetDownloadUrlForLayer\", \"ecr:BatchGetImage\",
            \"ecr:DescribeImages\", \"ecr:DescribeRepositories\"
          ],
          \"Resource\": \"*\"
        },
        {
          \"Sid\": \"CloudWatch\",
          \"Effect\": \"Allow\",
          \"Action\": [\"logs:FilterLogEvents\", \"logs:DescribeLogGroups\", \"logs:GetLogEvents\"],
          \"Resource\": \"*\"
        },
        {
          \"Sid\": \"STS\",
          \"Effect\": \"Allow\",
          \"Action\": [\"sts:GetCallerIdentity\"],
          \"Resource\": \"*\"
        }
      ]
    }" &>/dev/null
  success "IAM role created: $IAM_ROLE"
fi

# SSM secrets
aws ssm put-parameter --name "/openclaw/${STACK_NAME}/admin-password" \
  --value "$ADMIN_PASSWORD" --type SecureString --overwrite --region "$REGION" &>/dev/null
aws ssm put-parameter --name "/openclaw/${STACK_NAME}/jwt-secret" \
  --value "$JWT_SECRET" --type SecureString --overwrite --region "$REGION" &>/dev/null
success "SSM secrets stored"

# ── Step 6: Seed DynamoDB ────────────────────────────────────────────────────
if [ "$SKIP_SEED" = "true" ]; then
  info "[6/8] Skipping DynamoDB seed (--skip-seed)"
else
  info "[6/8] Seeding DynamoDB..."
  SEED_DIR="$SCRIPT_DIR/server"
  cd "$SEED_DIR"

  export DYNAMODB_TABLE="$DDB_TABLE"
  export DYNAMODB_REGION="$REGION"
  export AWS_REGION="$REGION"
  export S3_BUCKET="$S3_BUCKET"

  python3 seed_dynamodb.py --table "$DDB_TABLE" --region "$REGION" 2>/dev/null && \
    success "  Org data seeded" || warn "  seed_dynamodb.py failed"

  python3 seed_roles.py --table "$DDB_TABLE" --region "$REGION" 2>/dev/null && \
    success "  Roles seeded" || warn "  seed_roles.py failed"

  python3 seed_settings.py --table "$DDB_TABLE" --region "$REGION" 2>/dev/null && \
    success "  Settings seeded" || warn "  seed_settings.py skipped"

  python3 seed_knowledge_docs.py --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null && \
    success "  Knowledge docs uploaded" || warn "  seed_knowledge_docs.py skipped"

  python3 seed_workspaces.py --bucket "$S3_BUCKET" --region "$REGION" 2>/dev/null && \
    success "  Workspaces seeded" || warn "  seed_workspaces.py skipped"

  python3 seed_ssm_tenants.py --region "$REGION" --stack "$STACK_NAME" 2>/dev/null && \
    success "  SSM tenants seeded" || warn "  seed_ssm_tenants.py skipped"

  cd "$SCRIPT_DIR"
fi

# ── Step 7: Upload SOUL templates to S3 ─────────────────────────────────────
info "[7/8] Uploading SOUL templates to S3..."
TEMPLATES_DIR="$ENTERPRISE_DIR/agent-container/templates"
if [ -d "$TEMPLATES_DIR" ]; then
  aws s3 sync "$TEMPLATES_DIR/" "s3://${S3_BUCKET}/_shared/templates/" --region "$REGION" --quiet
  GLOBAL_SOUL="$TEMPLATES_DIR/default.md"
  [ -f "$GLOBAL_SOUL" ] && aws s3 cp "$GLOBAL_SOUL" "s3://${S3_BUCKET}/_shared/soul/global/SOUL.md" \
    --region "$REGION" --quiet
  success "SOUL templates uploaded"
else
  warn "Templates dir not found: $TEMPLATES_DIR"
fi

# ── Step 8: Deploy to EKS via Helm ──────────────────────────────────────────
info "[8/8] Deploying to EKS via Helm chart..."

# Namespace
kubectl create namespace "$NAMESPACE" 2>/dev/null || true

# Pod Identity Association (AWS-side, not in Helm)
EXISTING_ASSOC=$(aws eks list-pod-identity-associations \
  --cluster-name "$CLUSTER_NAME" --namespace "$NAMESPACE" \
  --service-account admin-console --region "$REGION" \
  --query 'associations[0].associationId' --output text 2>/dev/null || echo "None")

if [ "$EXISTING_ASSOC" = "None" ] || [ -z "$EXISTING_ASSOC" ]; then
  aws eks create-pod-identity-association \
    --cluster-name "$CLUSTER_NAME" \
    --namespace "$NAMESPACE" \
    --service-account admin-console \
    --role-arn "arn:aws:iam::${ACCOUNT_ID}:role/${IAM_ROLE}" \
    --region "$REGION" &>/dev/null
  success "Pod Identity association created"
else
  success "Pod Identity association exists: $EXISTING_ASSOC"
fi

# Helm install/upgrade — includes ServiceAccount, RBAC, Deployment, Service
CHART_DIR="$(dirname "$SCRIPT_DIR")/chart"
if [ ! -f "$CHART_DIR/Chart.yaml" ]; then
  error "Helm chart not found at $CHART_DIR"
fi

helm upgrade --install admin-console "$CHART_DIR" \
  --namespace "$NAMESPACE" \
  --set "image.repository=${ECR_URI}" \
  --set "image.tag=latest" \
  --set "image.pullPolicy=Always" \
  --set "aws.region=${REGION}" \
  --set "aws.stackName=${STACK_NAME}" \
  --set "aws.dynamodbTable=${DDB_TABLE}" \
  --set "aws.dynamodbRegion=${REGION}" \
  --set "aws.s3Bucket=${S3_BUCKET}" \
  --set "auth.adminPassword=${ADMIN_PASSWORD}" \
  --set "namespace=${NAMESPACE}" \
  --wait --timeout 120s || \
  warn "Helm install timed out — check: kubectl -n $NAMESPACE get pods -l app=admin-console"

# ── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "  ${GREEN}Deployment Complete!${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Cluster:     $CLUSTER_NAME"
echo "  Namespace:   $NAMESPACE"
echo "  DynamoDB:    $DDB_TABLE"
echo "  S3:          $S3_BUCKET"
echo "  ECR:         $ECR_URI"
echo ""
echo "  Access:"
echo "    kubectl -n $NAMESPACE port-forward svc/admin-console 8099:8099"
echo "    open http://localhost:8099"
echo "    Login: emp-jiade / password: $ADMIN_PASSWORD"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
