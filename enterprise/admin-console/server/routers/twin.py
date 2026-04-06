"""
Digital Twin — public shareable agent URL.

Endpoints: /api/v1/portal/twin, /api/v1/public/twin/*
"""

import os
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Header

import db
from shared import require_auth

router = APIRouter(tags=["twin"])

_PUBLIC_URL = os.environ.get("PUBLIC_URL", "https://openclaw.awspsa.com")


@router.get("/api/v1/portal/twin")
def get_twin_status(authorization: str = Header(default="")):
    """Get the current employee's digital twin status."""
    user = require_auth(authorization)
    record = db.get_twin_by_employee(user.employee_id)
    if not record or not record.get("active"):
        return {"active": False, "url": None, "chatCount": 0, "viewCount": 0}
    token = record.get("tokenRef") or record.get("token", "")
    return {
        "active": True,
        "url": f"{_PUBLIC_URL}/twin/{token}",
        "token": token,
        "chatCount": record.get("chatCount", 0),
        "viewCount": record.get("viewCount", 0),
        "createdAt": record.get("createdAt", ""),
    }


@router.post("/api/v1/portal/twin")
def enable_twin(authorization: str = Header(default="")):
    """Enable digital twin — generate a shareable URL for this employee's agent."""
    user = require_auth(authorization)
    existing = db.get_twin_by_employee(user.employee_id)
    if existing:
        db.disable_twin(user.employee_id)
    emp = db.get_employee(user.employee_id)
    if not emp:
        raise HTTPException(404, "Employee not found")
    agents = db.get_agents()
    agent = next((a for a in agents if a.get("employeeId") == user.employee_id), None)
    import secrets
    token = secrets.token_urlsafe(20)
    db.create_twin(
        emp_id=user.employee_id,
        token=token,
        emp_name=emp.get("name", user.name),
        position_name=emp.get("positionName", ""),
        agent_name=agent.get("name", f"{emp.get('name')} Agent") if agent else f"{emp.get('name')} Agent",
    )
    db.create_audit_entry({
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "eventType": "config_change", "actorId": user.employee_id,
        "actorName": user.name, "targetType": "twin", "targetId": token,
        "detail": f"Digital twin enabled for {user.name}", "status": "success",
    })
    return {"active": True, "url": f"{_PUBLIC_URL}/twin/{token}", "token": token}


@router.delete("/api/v1/portal/twin")
def disable_twin(authorization: str = Header(default="")):
    """Disable digital twin — revoke the public URL."""
    user = require_auth(authorization)
    db.disable_twin(user.employee_id)
    return {"active": False}


# ── Public twin endpoints (NO auth required) ──────────────────────────────────

@router.get("/api/v1/public/twin/{token}")
def get_public_twin_info(token: str):
    """Public: get employee info for the twin page (no auth)."""
    record = db.get_twin_by_token(token)
    if not record or not record.get("active"):
        raise HTTPException(404, "This digital twin is not available")
    db.increment_twin_stat(token, "viewCount")
    return {
        "empName": record.get("empName", ""),
        "positionName": record.get("positionName", ""),
        "agentName": record.get("agentName", ""),
        "companyName": "ACME Corp",
    }


@router.post("/api/v1/public/twin/{token}/chat")
def twin_chat(token: str, body: dict):
    """Public: send a message to the employee's digital twin (no auth)."""
    record = db.get_twin_by_token(token)
    if not record or not record.get("active"):
        raise HTTPException(404, "This digital twin is not available")

    emp_id = record.get("empId", "")
    message = body.get("message", "").strip()
    if not message:
        raise HTTPException(400, "message required")
    if len(message) > 2000:
        raise HTTPException(400, "Message too long (max 2000 chars)")

    db.increment_twin_stat(token, "chatCount")

    router_url = os.environ.get("TENANT_ROUTER_URL", "http://localhost:8090")
    try:
        import requests as _req
        r = _req.post(f"{router_url}/route", json={
            "channel": "twin",
            "user_id": emp_id,
            "message": message,
        }, timeout=180)
        if r.status_code == 200:
            data = r.json()
            resp = data.get("response", {})
            reply = resp.get("response", str(resp)) if isinstance(resp, dict) else str(resp)
            return {"reply": reply, "agentName": record.get("agentName", "")}
        raise HTTPException(502, "Agent unavailable")
    except Exception as e:
        raise HTTPException(502, f"Agent unavailable: {str(e)[:100]}")
