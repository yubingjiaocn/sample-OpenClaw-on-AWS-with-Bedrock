"""
EKS Agents — Deploy, manage, and route agents on Kubernetes.

Architecture: Admin Console -> K8s API -> OpenClawInstance CRD ->
Operator reconciles -> StatefulSet + Service + PVC.
Tenant Router reads SSM eks-endpoint -> routes to K8s Service.

Endpoints:
  /api/v1/admin/eks/operator/*    (operator management — must be before {agent_id})
  /api/v1/admin/eks/{agent_id}/*  (agent lifecycle)
"""

import asyncio
import os
from datetime import datetime, timezone

import boto3

from fastapi import APIRouter, HTTPException, Header

import db
from shared import require_role, ssm_client, STACK_NAME, GATEWAY_REGION
from services.k8s_client import k8s_client, OPENCLAW_NAMESPACE, OPERATOR_NAMESPACE

router = APIRouter(tags=["admin-eks"])

IS_CHINA_REGION = os.environ.get("AWS_REGION", "").startswith("cn-")


def _agent_svc_endpoint(agent_name: str) -> str:
    """Derive the in-cluster Service endpoint for an EKS agent."""
    return f"http://{agent_name}.{OPENCLAW_NAMESPACE}.svc:18789"


# =========================================================================
# Cluster Discovery & Association (fixed-path routes — before {agent_id})
# =========================================================================

@router.get("/api/v1/admin/eks/cluster")
async def get_cluster_config(authorization: str = Header(default="")):
    """Get the currently associated EKS cluster configuration."""
    require_role(authorization, roles=["admin"])

    ssm = ssm_client()
    cluster = {}
    for key in ["cluster-name", "cluster-endpoint", "cluster-region", "cluster-version"]:
        try:
            r = ssm.get_parameter(Name=f"/openclaw/{STACK_NAME}/eks/{key}")
            cluster[key.replace("-", "_")] = r["Parameter"]["Value"]
        except Exception:
            pass

    if not cluster.get("cluster_name"):
        return {"configured": False}

    # Get operator status if cluster is configured
    operator = {}
    try:
        operator = await k8s_client.get_operator_status()
    except Exception:
        operator = {"installed": False, "error": "Cannot reach K8s API"}

    return {
        "configured": True,
        **cluster,
        "operator": operator,
    }


@router.get("/api/v1/admin/eks/clusters/discover")
async def discover_clusters(authorization: str = Header(default="")):
    """List available EKS clusters in the current AWS region."""
    require_role(authorization, roles=["admin"])

    region = os.environ.get("EKS_REGION", GATEWAY_REGION)
    try:
        eks = boto3.client("eks", region_name=region)
        names = eks.list_clusters()["clusters"]
    except Exception as e:
        raise HTTPException(502, f"Failed to list EKS clusters: {e}")

    clusters = []
    for name in names:
        try:
            info = eks.describe_cluster(name=name)["cluster"]
            clusters.append({
                "name": info["name"],
                "status": info["status"],
                "endpoint": info["endpoint"],
                "version": info.get("version", ""),
                "region": region,
                "arn": info["arn"],
                "platformVersion": info.get("platformVersion", ""),
                "vpcId": info.get("resourcesVpcConfig", {}).get("vpcId", ""),
            })
        except Exception:
            clusters.append({"name": name, "status": "UNKNOWN", "region": region})

    return {"clusters": clusters, "region": region}


@router.post("/api/v1/admin/eks/cluster")
async def associate_cluster(body: dict, authorization: str = Header(default="")):
    """Associate an EKS cluster with this admin console.

    Saves the cluster config to SSM and updates kubeconfig so
    the k8s_client can reach the cluster's API server.

    Body: { name: str, region?: str }
    """
    require_role(authorization, roles=["admin"])

    cluster_name = body.get("name", "").strip()
    if not cluster_name:
        raise HTTPException(400, "Cluster name required")

    region = body.get("region", os.environ.get("EKS_REGION", GATEWAY_REGION))

    # Describe the cluster to validate and get endpoint
    try:
        eks = boto3.client("eks", region_name=region)
        info = eks.describe_cluster(name=cluster_name)["cluster"]
    except Exception as e:
        raise HTTPException(404, f"Cluster '{cluster_name}' not found in {region}: {e}")

    if info["status"] != "ACTIVE":
        raise HTTPException(400, f"Cluster is {info['status']}, must be ACTIVE to associate")

    # Save to SSM
    ssm = ssm_client()
    params = {
        "cluster-name": cluster_name,
        "cluster-endpoint": info["endpoint"],
        "cluster-region": region,
        "cluster-version": info.get("version", ""),
    }
    for key, value in params.items():
        ssm.put_parameter(
            Name=f"/openclaw/{STACK_NAME}/eks/{key}",
            Value=value, Type="String", Overwrite=True,
        )

    # Update kubeconfig so k8s_client can connect
    proc = await asyncio.create_subprocess_exec(
        "aws", "eks", "update-kubeconfig",
        "--name", cluster_name,
        "--region", region,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    kubeconfig_ok = proc.returncode == 0

    # Reset k8s_client so it re-initializes with new kubeconfig
    try:
        await k8s_client.close()
    except Exception:
        pass

    db.create_audit_entry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "eventType": "config_change", "actorId": "admin", "actorName": "Admin",
        "targetType": "eks-cluster", "targetId": cluster_name,
        "detail": f"Associated EKS cluster {cluster_name} ({region}, K8s {info.get('version', '?')})",
        "status": "success",
    })

    return {
        "associated": True,
        "cluster_name": cluster_name,
        "cluster_endpoint": info["endpoint"],
        "cluster_region": region,
        "cluster_version": info.get("version", ""),
        "kubeconfig_updated": kubeconfig_ok,
        "kubeconfig_error": stderr.decode().strip() if not kubeconfig_ok else None,
    }


@router.get("/api/v1/admin/eks/instances")
async def list_eks_instances(authorization: str = Header(default="")):
    """List all OpenClawInstance CRDs in the EKS namespace."""
    require_role(authorization, roles=["admin"])
    try:
        instances = await k8s_client.list_openclaw_instances(OPENCLAW_NAMESPACE)
    except Exception as e:
        raise HTTPException(502, f"Cannot list instances: {e}")
    return {"instances": instances, "namespace": OPENCLAW_NAMESPACE}


@router.delete("/api/v1/admin/eks/cluster")
async def disassociate_cluster(authorization: str = Header(default="")):
    """Remove the EKS cluster association."""
    require_role(authorization, roles=["admin"])

    ssm = ssm_client()
    for key in ["cluster-name", "cluster-endpoint", "cluster-region", "cluster-version"]:
        try:
            ssm.delete_parameter(Name=f"/openclaw/{STACK_NAME}/eks/{key}")
        except Exception:
            pass

    try:
        await k8s_client.close()
    except Exception:
        pass

    return {"disassociated": True}


# =========================================================================
# Operator Management (MUST be registered before {agent_id} routes
# so FastAPI doesn't match "operator" as an agent_id)
# =========================================================================

@router.get("/api/v1/admin/eks/operator/status")
async def get_operator_status(authorization: str = Header(default="")):
    """Check if the OpenClaw operator is installed and running on the EKS cluster.

    Returns CRD registration, deployment status, pod health, and version."""
    require_role(authorization, roles=["admin"])

    try:
        status = await k8s_client.get_operator_status()
    except Exception as e:
        raise HTTPException(502, f"Cannot reach K8s API: {e}")

    return status


@router.post("/api/v1/admin/eks/operator/install")
async def install_operator(body: dict = {}, authorization: str = Header(default="")):
    """Install the OpenClaw operator on the EKS cluster via Helm.

    Requires `helm` CLI available on the server. Uses the official
    OCI chart from ghcr.io/openclaw-rocks/charts. For China regions,
    automatically uses the ECR mirror image.

    Body (all optional):
      - version: Helm chart version (default: env OPERATOR_VERSION or 0.22.2)
      - chinaRegion: bool, use ECR mirror (auto-detected from AWS_REGION)
    """
    require_role(authorization, roles=["admin"])

    version = body.get("version", "")
    china = body.get("chinaRegion", IS_CHINA_REGION)

    # Check if already installed
    try:
        status = await k8s_client.get_operator_status()
        if status["installed"]:
            return {
                "status": "already_installed",
                "version": status["version"],
                "namespace": status["namespace"],
                "note": "Operator is already running. Use POST .../operator/upgrade to update.",
            }
    except Exception:
        pass  # K8s API might be unreachable; proceed with install attempt

    try:
        result = await k8s_client.install_operator(version=version, china_region=china)
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    db.create_audit_entry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "eventType": "config_change", "actorId": "admin", "actorName": "Admin",
        "targetType": "eks-operator", "targetId": "openclaw-operator",
        "detail": f"Installed OpenClaw operator v{result.get('version', '?')} to {result.get('namespace', '')}",
        "status": "success",
    })

    return result


@router.post("/api/v1/admin/eks/operator/upgrade")
async def upgrade_operator(body: dict = {}, authorization: str = Header(default="")):
    """Upgrade the OpenClaw operator to a new version via Helm.

    Body (all optional):
      - version: Target Helm chart version
      - chinaRegion: bool, use ECR mirror
    """
    require_role(authorization, roles=["admin"])

    version = body.get("version", "")
    china = body.get("chinaRegion", IS_CHINA_REGION)

    try:
        result = await k8s_client.upgrade_operator(version=version, china_region=china)
    except RuntimeError as e:
        raise HTTPException(500, str(e))

    db.create_audit_entry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "eventType": "config_change", "actorId": "admin", "actorName": "Admin",
        "targetType": "eks-operator", "targetId": "openclaw-operator",
        "detail": f"Upgraded OpenClaw operator to v{result.get('version', '?')}",
        "status": "success",
    })

    return result


# =========================================================================
# Agent Lifecycle (EKS)
# =========================================================================

@router.post("/api/v1/admin/eks/{agent_id}/deploy")
async def deploy_eks_agent(agent_id: str, body: dict = {}, authorization: str = Header(default="")):
    """Deploy an agent to EKS by creating an OpenClawInstance CRD.
    The OpenClaw Operator watches the CRD and creates the StatefulSet, Service, PVC."""
    require_role(authorization, roles=["admin"])

    # Pre-flight: ensure the OpenClaw operator is installed
    operator_status = await k8s_client.get_operator_status()
    if not operator_status["installed"]:
        raise HTTPException(
            428,
            "OpenClaw operator is not installed on the EKS cluster. "
            "Call POST /api/v1/admin/eks/operator/install first, or install via "
            f"helm install openclaw-operator oci://ghcr.io/openclaw-rocks/charts/openclaw-operator "
            f"--namespace {OPERATOR_NAMESPACE} --create-namespace")

    agent = db.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")

    emp_id = agent.get("employeeId", agent_id)
    pos_id = agent.get("positionId", "")
    model = body.get("model", os.environ.get(
        "DEFAULT_MODEL", "bedrock/us.anthropic.claude-sonnet-4-5-20250929-v1:0"))
    registry = body.get("registry", os.environ.get("OPENCLAW_REGISTRY", ""))
    bedrock_role_arn = body.get("bedrockRoleArn", os.environ.get("BEDROCK_ROLE_ARN", ""))

    try:
        await k8s_client.create_openclaw_instance(
            namespace=OPENCLAW_NAMESPACE,
            agent_name=agent_id,
            employee_id=emp_id,
            position_id=pos_id,
            model=model,
            registry=registry,
            bedrock_role_arn=bedrock_role_arn,
        )
    except ValueError as e:
        raise HTTPException(409, str(e))
    except Exception as e:
        raise HTTPException(500, f"Failed to create OpenClawInstance: {e}")

    # Write SSM eks-endpoint so tenant_router can find this agent
    try:
        ssm = ssm_client()
        ssm.put_parameter(
            Name=f"/openclaw/{STACK_NAME}/tenants/{emp_id}/eks-endpoint",
            Value=_agent_svc_endpoint(agent_id),
            Type="String", Overwrite=True,
        )
    except Exception as e:
        print(f"[eks] SSM eks-endpoint write failed for {emp_id}: {e}")

    # Update DynamoDB
    ddb_region = os.environ.get("DYNAMODB_REGION", "us-east-2")
    ddb_table = os.environ.get("DYNAMODB_TABLE", "openclaw-enterprise")
    try:
        ddb = boto3.resource("dynamodb", region_name=ddb_region)
        ddb.Table(ddb_table).update_item(
            Key={"PK": "ORG#acme", "SK": f"AGENT#{agent_id}"},
            UpdateExpression="SET deployMode = :m, containerStatus = :s",
            ExpressionAttributeValues={":m": "eks", ":s": "starting"},
        )
    except Exception as e:
        print(f"[eks] DynamoDB update failed: {e}")

    db.create_audit_entry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "eventType": "config_change", "actorId": "admin", "actorName": "Admin",
        "targetType": "agent", "targetId": agent_id,
        "detail": f"Deployed agent to EKS (namespace={OPENCLAW_NAMESPACE}, model={model})",
        "status": "success",
    })

    return {"deployed": True, "agentId": agent_id, "namespace": OPENCLAW_NAMESPACE,
            "endpoint": _agent_svc_endpoint(agent_id),
            "note": "OpenClawInstance CRD created. Pod starting (~60s)."}


@router.post("/api/v1/admin/eks/{agent_id}/stop")
async def stop_eks_agent(agent_id: str, authorization: str = Header(default="")):
    """Stop an EKS agent by deleting the OpenClawInstance CRD.
    The operator cleans up the StatefulSet, Service, and PVC."""
    require_role(authorization, roles=["admin"])

    agent = db.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")

    emp_id = agent.get("employeeId", agent_id)

    try:
        result = await k8s_client.delete_openclaw_instance(OPENCLAW_NAMESPACE, agent_id)
    except Exception as e:
        raise HTTPException(500, f"Failed to delete OpenClawInstance: {e}")

    # Clean up SSM eks-endpoint
    try:
        ssm = ssm_client()
        ssm.delete_parameter(
            Name=f"/openclaw/{STACK_NAME}/tenants/{emp_id}/eks-endpoint")
    except Exception:
        pass

    # Update DynamoDB
    ddb_region = os.environ.get("DYNAMODB_REGION", "us-east-2")
    ddb_table = os.environ.get("DYNAMODB_TABLE", "openclaw-enterprise")
    try:
        ddb = boto3.resource("dynamodb", region_name=ddb_region)
        ddb.Table(ddb_table).update_item(
            Key={"PK": "ORG#acme", "SK": f"AGENT#{agent_id}"},
            UpdateExpression="SET deployMode = :m, containerStatus = :s",
            ExpressionAttributeValues={":m": "serverless", ":s": "stopped"},
        )
    except Exception:
        pass

    db.create_audit_entry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "eventType": "config_change", "actorId": "admin", "actorName": "Admin",
        "targetType": "agent", "targetId": agent_id,
        "detail": f"Stopped EKS agent (deleted CRD from {OPENCLAW_NAMESPACE})",
        "status": "success",
    })

    return {"stopped": True, "agentId": agent_id, "result": result}


@router.post("/api/v1/admin/eks/{agent_id}/reload")
async def reload_eks_agent(agent_id: str, body: dict = {}, authorization: str = Header(default="")):
    """Reload an EKS agent by patching the CRD config version.
    The operator detects the change and restarts the pod with new config."""
    require_role(authorization, roles=["admin"])

    agent = db.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")

    # Bump configVersion annotation to trigger operator reconcile
    config_version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    patch = {
        "metadata": {
            "annotations": {
                "openclaw.rocks/config-version": config_version,
            },
        },
    }

    # Optionally update model
    if body.get("model"):
        patch["spec"] = {
            "config": {
                "raw": {
                    "agents": {
                        "defaults": {
                            "model": {"primary": body["model"]},
                        },
                    },
                },
            },
        }

    try:
        await k8s_client.patch_openclaw_instance(OPENCLAW_NAMESPACE, agent_id, patch)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Failed to patch OpenClawInstance: {e}")

    db.create_audit_entry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "eventType": "config_change", "actorId": "admin", "actorName": "Admin",
        "targetType": "agent", "targetId": agent_id,
        "detail": f"Reloaded EKS agent (config-version={config_version})",
        "status": "success",
    })

    return {"reloaded": True, "agentId": agent_id, "configVersion": config_version,
            "note": "CRD patched. Operator will restart pod with new config (~30s)."}


@router.get("/api/v1/admin/eks/{agent_id}/status")
async def get_eks_agent_status(agent_id: str, authorization: str = Header(default="")):
    """Get pod status for an EKS agent."""
    require_role(authorization, roles=["admin"])

    # Get CRD status
    crd = await k8s_client.get_openclaw_instance(OPENCLAW_NAMESPACE, agent_id)
    if not crd:
        return {"running": False, "agentId": agent_id, "crdStatus": "NOT_FOUND"}

    # Get pod status
    pod_status = await k8s_client.get_pod_status(OPENCLAW_NAMESPACE, agent_id)

    running = pod_status.get("phase") == "Running"
    return {
        "running": running,
        "agentId": agent_id,
        "namespace": OPENCLAW_NAMESPACE,
        "endpoint": _agent_svc_endpoint(agent_id) if running else None,
        "crdStatus": crd.get("status", {}).get("phase", "Unknown"),
        "pod": pod_status,
    }


@router.get("/api/v1/admin/eks/{agent_id}/logs")
async def get_eks_agent_logs(
    agent_id: str,
    container: str = "openclaw",
    tail: int = 100,
    authorization: str = Header(default=""),
):
    """Get pod logs for an EKS agent."""
    require_role(authorization, roles=["admin"])

    result = await k8s_client.get_pod_logs(
        OPENCLAW_NAMESPACE, agent_id, container=container, tail_lines=tail)

    if result.get("error"):
        raise HTTPException(404, result["error"])
    return result


@router.put("/api/v1/admin/eks/{agent_id}/assign/{emp_id}")
async def assign_eks_to_employee(agent_id: str, emp_id: str, authorization: str = Header(default="")):
    """Assign an employee to route through the EKS agent instead of AgentCore."""
    require_role(authorization, roles=["admin"])

    try:
        ssm = ssm_client()
        ssm.put_parameter(
            Name=f"/openclaw/{STACK_NAME}/tenants/{emp_id}/eks-endpoint",
            Value=_agent_svc_endpoint(agent_id),
            Type="String", Overwrite=True,
        )
    except Exception as e:
        raise HTTPException(500, f"SSM write failed: {e}")

    return {"assigned": True, "empId": emp_id, "agentId": agent_id,
            "endpoint": _agent_svc_endpoint(agent_id)}


@router.delete("/api/v1/admin/eks/{agent_id}/assign/{emp_id}")
async def unassign_eks_from_employee(agent_id: str, emp_id: str, authorization: str = Header(default="")):
    """Remove employee's EKS assignment -- they fall back to AgentCore."""
    require_role(authorization, roles=["admin"])

    try:
        ssm = ssm_client()
        ssm.delete_parameter(
            Name=f"/openclaw/{STACK_NAME}/tenants/{emp_id}/eks-endpoint")
    except Exception:
        pass

    return {"unassigned": True, "empId": emp_id}
