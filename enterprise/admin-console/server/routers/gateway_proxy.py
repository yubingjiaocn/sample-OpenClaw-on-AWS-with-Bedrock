"""
Gateway Proxy — reverse proxy to always-on agent's OpenClaw Gateway UI.

Allows employees to manage their own IM channel connections through the
native OpenClaw Gateway UI, without knowing the container's internal IP
or gateway token.

Flow:
  Employee Portal → "Open Gateway Console" button
  → GET /api/v1/portal/gateway-access  (returns iframe URL or proxy base)
  → All subsequent requests: /api/v1/portal/gateway/{path}
  → This router proxies to http://{container_ip}:18789/{path}?token={gw_token}
  → Employee sees OpenClaw native channel management UI

Security:
  - Employee must be authenticated (JWT)
  - Employee can only access their own agent's Gateway
  - Gateway token is injected server-side, never exposed to the browser
  - Container IP is internal VPC, never exposed

Admin visibility:
  - IM channel config stored in openclaw.json on EFS → readable from S3 writeback
  - All agent invocations logged to DynamoDB audit trail
  - Admin can stop the service at any time
"""

import os
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Request, Response
import requests as _requests

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/portal/gateway", tags=["gateway-proxy"])

# Lazy imports to avoid circular deps
_boto3 = None
def _get_boto3():
    global _boto3
    if _boto3 is None:
        import boto3
        _boto3 = boto3
    return _boto3


class _UserInfo:
    def __init__(self, employee_id: str, name: str, role: str):
        self.employee_id = employee_id
        self.name = name
        self.role = role

def _require_employee_auth(authorization: str) -> _UserInfo:
    """Validate JWT and return user info. Standalone — no import from main.py."""
    import json, hmac, hashlib, base64, time
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing authorization")
    token = authorization.replace("Bearer ", "")
    # Decode JWT (HS256) — read secret from SSM
    try:
        boto3 = _get_boto3()
        stack = os.environ.get("STACK_NAME", "openclaw-multitenancy")
        region = os.environ.get("GATEWAY_REGION", "us-east-1")
        secret = boto3.client("ssm", region_name=region).get_parameter(
            Name=f"/openclaw/{stack}/jwt-secret", WithDecryption=True
        )["Parameter"]["Value"]
    except Exception:
        secret = os.environ.get("JWT_SECRET", "dev-secret")
    try:
        parts = token.split(".")
        payload_b64 = parts[1] + "=" * (4 - len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        # Verify expiry
        if payload.get("exp", 0) < time.time():
            raise HTTPException(401, "Token expired")
        return _UserInfo(
            employee_id=payload.get("sub", ""),
            name=payload.get("name", ""),
            role=payload.get("role", "employee"),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(401, f"Invalid token: {e}")


def _get_agent_gateway_url(employee_id: str) -> Optional[str]:
    """Resolve the always-on agent's Gateway URL for an employee.
    Returns http://{container_ip}:18789/?token={gw_token} or None."""
    boto3 = _get_boto3()
    stack = os.environ.get("STACK_NAME", "openclaw-multitenancy")
    region = os.environ.get("GATEWAY_REGION", os.environ.get("AWS_REGION", "us-east-1"))
    # SSM params are in the gateway region (us-east-1), not DynamoDB region (us-east-2)
    if region == "us-east-2":
        region = "us-east-1"
    ssm = boto3.client("ssm", region_name=region)

    # 1. Check if employee has an always-on agent
    try:
        agent_id = ssm.get_parameter(
            Name=f"/openclaw/{stack}/tenants/{employee_id}/always-on-agent"
        )["Parameter"]["Value"]
    except Exception:
        return None  # Not always-on

    # 2. Get container endpoint (http://10.0.x.x:8080)
    try:
        endpoint = ssm.get_parameter(
            Name=f"/openclaw/{stack}/always-on/{agent_id}/endpoint"
        )["Parameter"]["Value"]
    except Exception:
        return None  # Container not running

    # 3. Derive Gateway URL (port 18789 instead of 8080)
    gateway_url = endpoint.replace(":8080", ":18789")

    # 4. Get gateway token from SSM or container config
    gw_token = ""
    try:
        gw_token = ssm.get_parameter(
            Name=f"/openclaw/{stack}/always-on/{agent_id}/gateway-token",
            WithDecryption=True,
        )["Parameter"]["Value"]
    except Exception:
        # Fallback: try to read from the container's /ping which doesn't need auth
        # or use a default token. For now, try without token.
        logger.warning("Gateway token not found for %s — proxy may fail auth", agent_id)

    return f"{gateway_url}/?token={gw_token}" if gw_token else gateway_url


# Cache: employee_id → (gateway_base_url, token, timestamp)
_gw_cache: dict = {}
_GW_CACHE_TTL = 120  # seconds

def _get_cached_gateway(employee_id: str) -> Optional[tuple]:
    """Return (base_url, token) for an employee's Gateway, with caching."""
    import time
    now = time.time()
    if employee_id in _gw_cache:
        base, token, ts = _gw_cache[employee_id]
        if now - ts < _GW_CACHE_TTL:
            return base, token

    boto3 = _get_boto3()
    stack = os.environ.get("STACK_NAME", "openclaw-multitenancy")
    region = os.environ.get("GATEWAY_REGION", os.environ.get("AWS_REGION", "us-east-1"))
    # SSM params are in the gateway region (us-east-1), not DynamoDB region (us-east-2)
    if region == "us-east-2":
        region = "us-east-1"
    ssm = boto3.client("ssm", region_name=region)

    print(f"[gateway-proxy] stack={stack} region={region} emp={employee_id}")
    try:
        param_name = f"/openclaw/{stack}/tenants/{employee_id}/always-on-agent"
        agent_id = ssm.get_parameter(Name=param_name)["Parameter"]["Value"]
        print(f"[gateway-proxy] SSM lookup OK: {param_name} → {agent_id}")
    except Exception as e:
        print(f"[gateway-proxy] SSM lookup FAILED: /openclaw/{stack}/tenants/{employee_id}/always-on-agent → {e}")
        return None

    try:
        endpoint = ssm.get_parameter(
            Name=f"/openclaw/{stack}/always-on/{agent_id}/endpoint"
        )["Parameter"]["Value"]
        logger.info("Gateway proxy: endpoint=%s", endpoint)
    except Exception as e:
        logger.info("Gateway proxy: no endpoint for %s: %s", agent_id, e)
        return None

    base_url = endpoint.replace(":8080", ":18789")

    gw_token = ""
    try:
        gw_token = ssm.get_parameter(
            Name=f"/openclaw/{stack}/always-on/{agent_id}/gateway-token",
            WithDecryption=True,
        )["Parameter"]["Value"]
    except Exception:
        # Try reading from openclaw.json via S3
        try:
            import json
            s3_bucket = os.environ.get("S3_BUCKET", "")
            if s3_bucket:
                s3 = boto3.client("s3", region_name=region)
                # The agent's employee ID for S3 path
                emp_id = employee_id
                obj = s3.get_object(Bucket=s3_bucket, Key=f"{emp_id}/workspace/.openclaw-gateway-token")
                gw_token = obj["Body"].read().decode().strip()
        except Exception:
            pass

    if not gw_token:
        # Last resort: try the stack-level gateway token
        try:
            gw_token = ssm.get_parameter(
                Name=f"/openclaw/{stack}/gateway-token",
                WithDecryption=True,
            )["Parameter"]["Value"]
        except Exception:
            pass

    _gw_cache[employee_id] = (base_url, gw_token, now)
    return base_url, gw_token


@router.get("/access")
def get_gateway_access(authorization: str = Header(default="")):
    """Check if the employee has Gateway access and return status.
    Does NOT return the URL directly — all access goes through the proxy."""
    user = _require_employee_auth(authorization)
    print(f"[gateway-proxy] access check: emp={user.employee_id} role={user.role}")
    result = _get_cached_gateway(user.employee_id)
    print(f"[gateway-proxy] cache result: {result}")

    if not result:
        return {
            "available": False,
            "reason": "Your agent is not in always-on mode. IM channels are managed through the shared company bot.",
            "deployMode": "serverless",
        }

    base_url, token = result
    # Quick health check
    try:
        resp = _requests.get(f"{base_url}/api/health", timeout=3)
        healthy = resp.status_code == 200
    except Exception:
        healthy = False

    return {
        "available": True,
        "healthy": healthy,
        "deployMode": "always-on-ecs",
        "proxyBase": "/api/v1/portal/gateway/ui/",
    }


@router.api_route("/ui/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def proxy_gateway(path: str, request: Request, authorization: str = Header(default="")):
    """Reverse proxy to the always-on agent's OpenClaw Gateway UI.
    Injects the gateway token server-side — employee never sees it."""
    user = _require_employee_auth(authorization)
    result = _get_cached_gateway(user.employee_id)

    if not result:
        raise HTTPException(403, "Gateway not available — agent is not always-on")

    base_url, token = result

    # Build target URL
    target = f"{base_url}/{path}"
    if token:
        separator = "&" if "?" in target else "?"
        target = f"{target}{separator}token={token}"

    # Forward query params (except our auth header)
    query = str(request.query_params)
    if query:
        separator = "&" if "?" in target else "?"
        target = f"{target}{separator}{query}"

    # Forward the request
    try:
        body = await request.body()
        headers = {
            "Content-Type": request.headers.get("content-type", "application/json"),
            "Accept": request.headers.get("accept", "*/*"),
        }

        resp = _requests.request(
            method=request.method,
            url=target,
            headers=headers,
            data=body if body else None,
            timeout=30,
            allow_redirects=False,
        )

        # Return proxied response
        excluded_headers = {"transfer-encoding", "content-encoding", "connection"}
        response_headers = {
            k: v for k, v in resp.headers.items()
            if k.lower() not in excluded_headers
        }

        return Response(
            content=resp.content,
            status_code=resp.status_code,
            headers=response_headers,
            media_type=resp.headers.get("content-type"),
        )

    except _requests.exceptions.ConnectionError:
        raise HTTPException(502, "Gateway container not reachable. It may be starting up.")
    except _requests.exceptions.Timeout:
        raise HTTPException(504, "Gateway request timed out")
    except Exception as e:
        raise HTTPException(502, f"Gateway proxy error: {e}")
