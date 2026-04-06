"""
Shared dependencies for all routers.
Provides auth, config, helpers, and module-level constants.
Import this instead of main.py to avoid circular dependencies.
"""

import os
import time
import json
import logging
from datetime import datetime, timezone
from typing import Optional

import boto3 as _boto3_shared

logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────
GATEWAY_REGION = os.environ.get("GATEWAY_REGION", os.environ.get("SSM_REGION", "us-east-1"))
STACK_NAME = os.environ.get("STACK_NAME", "openclaw-multitenancy")
S3_BUCKET_ENV = os.environ.get("S3_BUCKET", "")
DYNAMODB_TABLE = os.environ.get("DYNAMODB_TABLE", "openclaw-enterprise")
DYNAMODB_REGION = os.environ.get("DYNAMODB_REGION", "us-east-2")
CONSOLE_PORT = os.environ.get("CONSOLE_PORT", "8099")
ALWAYS_ON_ECR_IMAGE = os.environ.get("AGENT_ECR_IMAGE", "")


def _resolve_gateway_instance_id() -> str:
    try:
        return os.environ.get("GATEWAY_INSTANCE_ID", "") or (
            _boto3_shared.client("ssm", region_name=GATEWAY_REGION)
            .get_parameter(Name=f"/openclaw/{STACK_NAME}/gateway-instance-id")["Parameter"]["Value"]
        )
    except Exception:
        # Try IMDS
        try:
            import urllib.request
            tok = urllib.request.urlopen(
                urllib.request.Request("http://169.254.169.254/latest/api/token",
                                      method="PUT", headers={"X-aws-ec2-metadata-token-ttl-seconds": "60"}),
                timeout=2).read().decode()
            return urllib.request.urlopen(
                urllib.request.Request("http://169.254.169.254/latest/meta-data/instance-id",
                                      headers={"X-aws-ec2-metadata-token": tok}),
                timeout=2).read().decode()
        except Exception:
            return ""


def _resolve_gateway_account_id() -> str:
    try:
        return _boto3_shared.client("sts", region_name=GATEWAY_REGION).get_caller_identity()["Account"]
    except Exception:
        return ""


GATEWAY_INSTANCE_ID: str = _resolve_gateway_instance_id()
GATEWAY_ACCOUNT_ID: str = _resolve_gateway_account_id()


# ── SSM helper ──────────────────────────────────────────────────────────
def ssm_client():
    return _boto3_shared.client("ssm", region_name=GATEWAY_REGION)


# ── Config version ──────────────────────────────────────────────────────
def bump_config_version() -> None:
    """Write a new CONFIG#global-version to DynamoDB.
    Agent-container/server.py polls this every 5 minutes."""
    try:
        import db
        version = datetime.now(timezone.utc).isoformat()
        ddb = _boto3_shared.resource("dynamodb", region_name=db.AWS_REGION)
        ddb.Table(db.TABLE_NAME).put_item(Item={
            "PK": "ORG#acme", "SK": "CONFIG#global-version",
            "GSI1PK": "TYPE#config", "GSI1SK": "CONFIG#global-version",
            "version": version,
        })
    except Exception as e:
        print(f"[config-version] bump failed (non-fatal): {e}")


# ── StopRuntimeSession helper ──────────────────────────────────────────
def stop_employee_session(emp_id: str) -> dict:
    """Call Tenant Router /stop-session to force agent workspace refresh."""
    router_url = os.environ.get("TENANT_ROUTER_URL", "http://localhost:8090")
    try:
        import requests as _req_stop
        r = _req_stop.post(f"{router_url}/stop-session",
                          json={"emp_id": emp_id}, timeout=30)
        return r.json() if r.status_code == 200 else {"error": r.text}
    except Exception as e:
        print(f"[stop-session] Failed for {emp_id}: {e}")
        return {"error": str(e)}


# ── Auth (re-exported from auth module) ─────────────────────────────────
# These are set by main.py after the auth module is loaded.
# Routers import from shared to avoid circular deps with main.py.
_auth_module = None

def _init_auth(auth_mod):
    global _auth_module
    _auth_module = auth_mod

def require_auth(authorization: str):
    """Validate JWT and return UserContext. Raises HTTPException on failure."""
    if _auth_module is None:
        raise RuntimeError("Auth module not initialized")
    return _auth_module.require_auth(authorization)

def require_role(authorization: str, roles: list = None):
    """Validate JWT + check role. Raises HTTPException on failure."""
    if _auth_module is None:
        raise RuntimeError("Auth module not initialized")
    return _auth_module.require_role(authorization, roles or ["admin"])

def get_dept_scope(user) -> Optional[set]:
    """For managers: return set of department IDs they can see (BFS sub-departments)."""
    if _auth_module is None:
        return None
    return _auth_module.get_dept_scope(user)
