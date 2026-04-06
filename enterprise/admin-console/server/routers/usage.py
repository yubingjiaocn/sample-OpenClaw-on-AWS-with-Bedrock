"""
Usage & Dashboard — Multi-dimension cost/token analytics.

Endpoints: /api/v1/usage/*, /api/v1/dashboard
"""

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

import db
from shared import require_auth, require_role, get_dept_scope, DYNAMODB_REGION

router = APIRouter(tags=["usage"])

# Default monthly budgets (USD) by department — overridden by DynamoDB CONFIG#budgets
_DEFAULT_BUDGETS = {
    "Engineering": 50.0, "Platform Team": 20.0, "Sales": 30.0,
    "Product": 25.0, "Finance": 20.0, "HR & Admin": 15.0,
    "Customer Success": 20.0, "Legal & Compliance": 10.0, "QA Team": 15.0,
}


def _get_agent_usage_today() -> dict:
    """Aggregate today's usage per agent from DynamoDB USAGE# records.
    Reads today's date dynamically. Also merges the last 6 days to capture
    recent real usage (Discord, Portal, Telegram) that may land on different dates."""
    from datetime import date as _date, timedelta
    today = _date.today().isoformat()
    all_usage = db.get_usage_by_date(today)
    for offset in range(1, 7):
        past = (_date.today() - timedelta(days=offset)).isoformat()
        past_usage = db.get_usage_by_date(past)
        for u in past_usage:
            aid = u.get("agentId", "")
            if aid and aid not in {uu.get("agentId") for uu in all_usage}:
                all_usage.append(u)
    result = {}
    for u in all_usage:
        aid = u.get("agentId", "")
        if not aid:
            continue
        if aid in result:
            result[aid]["inputTokens"] += u.get("inputTokens", 0)
            result[aid]["outputTokens"] += u.get("outputTokens", 0)
            result[aid]["requests"] += u.get("requests", 0)
            result[aid]["cost"] += float(u.get("cost", 0))
        else:
            result[aid] = {
                "inputTokens": u.get("inputTokens", 0),
                "outputTokens": u.get("outputTokens", 0),
                "requests": u.get("requests", 0),
                "cost": float(u.get("cost", 0)),
                "model": u.get("model", ""),
            }
    return result


def _get_budgets() -> dict:
    """Load department budgets from DynamoDB CONFIG#budgets; fall back to defaults."""
    stored = db.get_config("budgets")
    if stored:
        merged = dict(_DEFAULT_BUDGETS)
        merged.update({k: float(v) for k, v in stored.items() if k != "id" and not k.startswith("_")})
        return merged
    return dict(_DEFAULT_BUDGETS)


# ── Dashboard ─────────────────────────────────────────────────────────────

@router.get("/api/v1/dashboard")
def dashboard(authorization: str = Header(default="")):
    user = require_auth(authorization)
    scope = get_dept_scope(user)

    depts = db.get_departments()
    agents = db.get_agents()
    bindings = db.get_bindings()
    employees = db.get_employees()
    sessions = db.get_sessions()

    if scope is not None:
        depts = [d for d in depts if d["id"] in scope]
        employees = [e for e in employees if e.get("departmentId") in scope]
        emp_ids = {e["id"] for e in employees}
        positions = db.get_positions()
        pos_in_scope = {p["id"] for p in positions if p.get("departmentId") in scope}
        agents = [a for a in agents if a.get("positionId") in pos_in_scope or not a.get("employeeId")]
        bindings = [b for b in bindings if b.get("employeeId") in emp_ids]
        sessions = [s for s in sessions if s.get("employeeId") in emp_ids]

    return {
        "departments": len([d for d in depts if not d.get("parentId")]),
        "positions": len(db.get_positions() if scope is None else [p for p in db.get_positions() if p.get("departmentId") in scope]),
        "employees": len(employees),
        "agents": len(agents),
        "activeAgents": sum(1 for a in agents if a.get("status") == "active"),
        "bindings": sum(1 for b in bindings if b.get("status") == "active"),
        "sessions": len(sessions),
        "totalTurns": sum(s.get("turns", 0) for s in sessions),
        "unboundEmployees": sum(1 for e in employees if not e.get("agentId")),
    }


# ── Usage ─────────────────────────────────────────────────────────────────

@router.get("/api/v1/usage/summary")
def usage_summary():
    usage_map = _get_agent_usage_today()
    total_input = sum(u["inputTokens"] for u in usage_map.values())
    total_output = sum(u["outputTokens"] for u in usage_map.values())
    total_cost = sum(u["cost"] for u in usage_map.values())
    total_requests = sum(u["requests"] for u in usage_map.values())
    employees = db.get_employees()
    chatgpt_daily = len([e for e in employees if e.get("agentId")]) * 0.83
    return {
        "totalInputTokens": total_input,
        "totalOutputTokens": total_output,
        "totalCost": round(total_cost, 2),
        "totalRequests": total_requests,
        "tenantCount": len([e for e in employees if e.get("agentId")]),
        "chatgptEquivalent": round(chatgpt_daily, 2),
    }


@router.get("/api/v1/usage/by-department")
def usage_by_department():
    """Aggregate usage by department from DynamoDB."""
    agents = db.get_agents()
    positions = db.get_positions()
    usage_map = _get_agent_usage_today()
    pos_to_dept = {p["id"]: p.get("departmentName", "Unknown") for p in positions}

    dept_usage: dict = {}
    for agent in agents:
        dept = pos_to_dept.get(agent.get("positionId", ""), "Unknown")
        usage = usage_map.get(agent["id"], {"inputTokens": 0, "outputTokens": 0, "requests": 0, "cost": 0})
        if dept not in dept_usage:
            dept_usage[dept] = {"department": dept, "inputTokens": 0, "outputTokens": 0, "requests": 0, "cost": 0, "agents": 0}
        dept_usage[dept]["inputTokens"] += usage["inputTokens"]
        dept_usage[dept]["outputTokens"] += usage["outputTokens"]
        dept_usage[dept]["requests"] += usage["requests"]
        dept_usage[dept]["cost"] += usage["cost"]
        dept_usage[dept]["agents"] += 1

    result = sorted(dept_usage.values(), key=lambda x: x["cost"], reverse=True)
    for r in result:
        r["cost"] = round(r["cost"], 2)
    return result


@router.get("/api/v1/usage/by-agent")
def usage_by_agent():
    """Per-agent usage breakdown from DynamoDB."""
    agents = db.get_agents()
    usage_map = _get_agent_usage_today()
    result = []
    for agent in agents:
        usage = usage_map.get(agent["id"], {"inputTokens": 0, "outputTokens": 0, "requests": 0, "cost": 0})
        result.append({
            "agentId": agent["id"],
            "agentName": agent["name"],
            "employeeName": agent.get("employeeName", ""),
            "positionName": agent.get("positionName", ""),
            **usage,
        })
    return sorted(result, key=lambda x: x["cost"], reverse=True)


@router.get("/api/v1/usage/by-model")
def usage_by_model():
    """Aggregate usage by model from DynamoDB USAGE# records."""
    from datetime import date as _date, timedelta
    model_usage: dict = {}
    for offset in range(7):
        d = (_date.today() - timedelta(days=offset)).isoformat()
        records = db.get_usage_by_date(d)
        for u in records:
            model = u.get("model", "unknown")
            if model == "unknown" or not model:
                model = "global.amazon.nova-2-lite-v1:0"
            if model not in model_usage:
                model_usage[model] = {"model": model, "inputTokens": 0, "outputTokens": 0, "requests": 0, "cost": 0}
            model_usage[model]["inputTokens"] += u.get("inputTokens", 0)
            model_usage[model]["outputTokens"] += u.get("outputTokens", 0)
            model_usage[model]["requests"] += u.get("requests", 0)
            model_usage[model]["cost"] += float(u.get("cost", 0))
    if not model_usage:
        records = db.get_usage_by_date("2026-03-20")
        for u in records:
            model = u.get("model", "global.amazon.nova-2-lite-v1:0")
            if model not in model_usage:
                model_usage[model] = {"model": model, "inputTokens": 0, "outputTokens": 0, "requests": 0, "cost": 0}
            model_usage[model]["inputTokens"] += u.get("inputTokens", 0)
            model_usage[model]["outputTokens"] += u.get("outputTokens", 0)
            model_usage[model]["requests"] += u.get("requests", 0)
            model_usage[model]["cost"] += float(u.get("cost", 0))
    result = sorted(model_usage.values(), key=lambda x: x["cost"], reverse=True)
    for r in result:
        r["cost"] = round(r["cost"], 4)
    return result


@router.get("/api/v1/usage/agent/{agent_id}")
def usage_for_agent(agent_id: str):
    """Get daily usage records for a specific agent."""
    records = db.get_usage_for_agent(agent_id)
    records.sort(key=lambda x: x.get("date", ""))
    return [{
        "date": r.get("date"),
        "inputTokens": r.get("inputTokens", 0),
        "outputTokens": r.get("outputTokens", 0),
        "requests": r.get("requests", 0),
        "cost": float(r.get("cost", 0)),
    } for r in records]


@router.get("/api/v1/usage/trend")
def usage_trend():
    """7-day cost trend — aggregated from real USAGE#{agent}#{date} records in DynamoDB.
    Falls back to seed COST_TREND# data if real usage is too sparse."""
    from datetime import timedelta
    employees = db.get_employees()
    active_emp_count = len([e for e in employees if e.get("agentId")])
    chatgpt_daily = round(active_emp_count * 0.83, 2)

    try:
        import boto3 as _b3tr
        from decimal import Decimal
        ddb = _b3tr.resource("dynamodb", region_name=db.AWS_REGION)
        table = ddb.Table(db.TABLE_NAME)
        now = datetime.now(timezone.utc)
        daily_costs: dict = {}
        daily_requests: dict = {}
        for i in range(7):
            date_str = (now - timedelta(days=i)).strftime("%Y-%m-%d")
            daily_costs[date_str] = 0.0
            daily_requests[date_str] = 0

        resp = table.query(
            IndexName="GSI1",
            KeyConditionExpression="GSI1PK = :pk AND begins_with(GSI1SK, :sk)",
            ExpressionAttributeValues={":pk": "TYPE#usage", ":sk": "USAGE#"},
            Limit=500)
        for item in resp.get("Items", []):
            date = item.get("date", "")
            if date in daily_costs:
                daily_costs[date] += float(item.get("cost", 0))
                daily_requests[date] += int(item.get("requests", 0))

        real_trend = []
        has_real_data = any(v > 0 for v in daily_costs.values())
        for i in range(6, -1, -1):
            date_str = (now - timedelta(days=i)).strftime("%Y-%m-%d")
            real_trend.append({
                "date": date_str,
                "openclawCost": round(daily_costs.get(date_str, 0), 4),
                "chatgptEquivalent": chatgpt_daily,
                "totalRequests": daily_requests.get(date_str, 0),
                "source": "real" if has_real_data else "seed",
            })

        if has_real_data:
            return real_trend
    except Exception:
        pass

    trend = db.get_cost_trend()
    return [{
        "date": t.get("date"),
        "openclawCost": float(t.get("openclawCost", 0)),
        "chatgptEquivalent": float(t["chatgptEquivalent"]) if t.get("chatgptEquivalent") else chatgpt_daily,
        "totalRequests": t.get("totalRequests", 0),
        "source": "seed",
    } for t in trend]


@router.get("/api/v1/usage/budgets")
def usage_budgets():
    """Department budget tracking — budgets loaded from DynamoDB CONFIG#budgets."""
    dept_usage = usage_by_department()
    budgets = _get_budgets()
    result = []
    for dept in dept_usage:
        budget = budgets.get(dept["department"], 20.0)
        used = dept["cost"]
        projected = used * 30
        result.append({
            "department": dept["department"],
            "budget": budget,
            "used": round(used, 2),
            "projected": round(projected, 2),
            "status": "over" if projected > budget else "warning" if projected > budget * 0.8 else "ok",
        })
    return result


class BudgetUpdateRequest(BaseModel):
    budgets: dict  # {"Engineering": 60.0, "Sales": 35.0, ...}


@router.put("/api/v1/usage/budgets")
def update_budgets(body: BudgetUpdateRequest, authorization: str = Header(default="")):
    """Save department budget config to DynamoDB. Admin only."""
    require_role(authorization, roles=["admin"])
    merged = _get_budgets()
    merged.update({k: float(v) for k, v in body.budgets.items()})
    db.set_config("budgets", merged)
    return merged
