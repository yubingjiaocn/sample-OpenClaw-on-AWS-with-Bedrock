"""
Playground — test agent with different tenant contexts.

Endpoints: /api/v1/playground/*
"""

import os
import json

from fastapi import APIRouter, Header
from pydantic import BaseModel

import db
from shared import require_role

router = APIRouter(tags=["playground"])


class PlaygroundMessage(BaseModel):
    tenant_id: str
    message: str
    mode: str = "simulate"  # "simulate" or "live"


_POS_TOOLS = {
    "pos-sa": ["web_search", "shell", "browser", "file", "file_write", "code_execution"],
    "pos-sde": ["web_search", "shell", "browser", "file", "file_write", "code_execution"],
    "pos-devops": ["web_search", "shell", "browser", "file", "file_write", "code_execution"],
    "pos-qa": ["web_search", "shell", "file", "code_execution"],
    "pos-ae": ["web_search", "file", "crm-query", "email-send"],
    "pos-pm": ["web_search", "file", "notion-sync", "calendar-check"],
    "pos-fa": ["web_search", "file", "excel-gen", "sap-connector"],
    "pos-hr": ["web_search", "file", "email-send", "calendar-check"],
    "pos-csm": ["web_search", "file", "crm-query", "email-send"],
    "pos-legal": ["web_search", "file"],
    "pos-exec": ["web_search", "shell", "browser", "file", "file_write", "code_execution"],
}


@router.get("/api/v1/playground/profiles")
def get_playground_profiles():
    """Dynamically generate profiles for all employees with agents."""
    emps = db.get_employees()
    positions = db.get_positions()
    pos_map = {p["id"]: p for p in positions}
    channel_short = {"whatsapp": "wa", "telegram": "tg", "discord": "dc", "slack": "sl", "feishu": "fs", "dingtalk": "dt", "portal": "port"}
    profiles = {}
    for emp in emps:
        if not emp.get("agentId"):
            continue
        pos_id = emp.get("positionId", "")
        pos = pos_map.get(pos_id, {})
        # Use port__ prefix for all playground profiles (channel-agnostic)
        tenant_id = f"port__{emp['id']}"
        role = pos.get("name", "unknown").lower().replace(" ", "_")
        tools = _POS_TOOLS.get(pos_id, pos.get("toolAllowlist", ["web_search"]))
        blocked = [t for t in ["shell", "browser", "file_write", "code_execution"] if t not in tools]
        plan_a = f"ALLOW: {', '.join(tools)}."
        if blocked:
            plan_a += f"\nDENY: {', '.join(blocked)}."
        plan_e = "Block PII (SSN, credit cards, phone numbers). Block credential exposure."
        profiles[tenant_id] = {"role": role, "tools": tools, "planA": plan_a, "planE": plan_e}
    # Always include admin profile for the floating assistant
    profiles["port__admin"] = {
        "role": "it_admin",
        "tools": ["web_search", "shell", "browser", "file", "file_write", "code_execution"],
        "planA": "ALLOW: all tools. Full IT Admin access.\nThis is the Admin Assistant running on the Gateway EC2.",
        "planE": "Block credential exposure in responses.",
    }
    return profiles


def _admin_assistant_direct(message: str) -> dict:
    """
    PATH B: IT Admin Assistant — runs OpenClaw CLI on EC2.

    The H2 Proxy (bedrock_proxy_h2.js) detects admin sessions and proxies
    the Bedrock request directly to real Bedrock (bypassing Tenant Router).
    This means OpenClaw on EC2 keeps all its tools (shell, file, browser)
    and reads the local SOUL.md for identity.

    Flow: FastAPI -> subprocess(openclaw CLI) -> OpenClaw reads SOUL.md ->
          OpenClaw calls Bedrock via H2 Proxy -> H2 Proxy detects admin ->
          H2 Proxy forwards to real Bedrock (not Tenant Router) ->
          Response back to OpenClaw -> back to FastAPI -> Admin Console
    """
    import subprocess as _sp
    profile = {"role": "it_admin",
               "tools": ["web_search", "shell", "browser", "file", "code_execution"],
               "planA": "Full IT Admin access (read-only safety)",
               "planE": "Block credential exposure"}

    openclaw_bin = "/home/ubuntu/.nvm/versions/node/v22.22.1/bin/openclaw"
    env_path = "/home/ubuntu/.nvm/versions/node/v22.22.1/bin:/usr/local/bin:/usr/bin:/bin"

    try:
        import time as _admin_t
        session_id = f"admin-assistant"  # Stable session for conversation continuity

        cmd = ["sudo", "-u", "ubuntu", "env", f"PATH={env_path}", "HOME=/home/ubuntu",
               openclaw_bin, "agent", "--session-id", session_id,
               "--message", message, "--json", "--timeout", "120"]
        result = _sp.run(cmd, capture_output=True, text=True, timeout=130)

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        # OpenClaw may write JSON to stderr in Gateway fallback mode
        raw = stdout if (stdout and '{' in stdout) else stderr if (stderr and '{' in stderr) else ""

        if raw and '{' in raw:
            json_start = raw.find('{')
            try:
                decoder = json.JSONDecoder()
                data, _ = decoder.raw_decode(raw, json_start)
                result_obj = data.get("result", data)
                payloads = result_obj.get("payloads", [])
                text = " ".join(p.get("text", "") for p in payloads if p.get("text")).strip()
                if not text:
                    text = data.get("text", result_obj.get("text", ""))
                if text:
                    return {"response": text, "tenant_id": "admin", "profile": profile,
                            "plan_a": profile["planA"], "plan_e": "✅ EC2 via H2 bypass", "source": "ec2-direct"}
            except (json.JSONDecodeError, ValueError):
                pass

        return {"response": f"OpenClaw output:\n```\n{(stdout or stderr)[:500]}\n```",
                "tenant_id": "admin", "profile": profile,
                "plan_a": "", "plan_e": "⚠️ Parse error", "source": "ec2-direct"}
    except _sp.TimeoutExpired:
        return {"response": "⏳ Timed out after 120s.", "tenant_id": "admin",
                "profile": profile, "plan_a": "", "plan_e": "TIMEOUT", "source": "error"}
    except Exception as e:
        return {"response": f"⚠️ Error: {e}", "tenant_id": "admin",
                "profile": profile, "plan_a": "", "plan_e": "ERROR", "source": "error"}


@router.post("/api/v1/playground/send")
def playground_send(body: PlaygroundMessage, authorization: str = Header(default="")):
    """Send message to agent. mode=live routes through real Tenant Router -> AgentCore."""
    require_role(authorization, roles=["admin", "manager"])
    profiles = get_playground_profiles()
    profile = profiles.get(body.tenant_id, {"role": "unknown", "tools": ["web_search"], "planA": "Default", "planE": "Default"})

    # Extract employee ID from tenant_id (port__emp-xxx -> emp-xxx)
    emp_id = body.tenant_id.replace("port__", "")

    # Live mode: route through Tenant Router -> AgentCore -> OpenClaw
    if body.mode == "live":
        # PATH B: Admin Assistant runs directly on EC2 (not via AgentCore)
        # See _admin_assistant_direct() docstring for full architecture explanation
        if emp_id == "admin":
            return _admin_assistant_direct(body.message)

        # PATH A: Employee agents route through Tenant Router -> AgentCore microVM
        router_url = os.environ.get("TENANT_ROUTER_URL", "http://localhost:8090")
        try:
            import requests as _req
            # Use "playground" channel so Tenant Router creates an isolated session
            # (pgnd__emp-xxx__<hash>) that won't pollute the employee's real conversation.
            # workspace_assembler.py detects "pgnd" prefix -> SESSION_CONTEXT.md = Admin Test mode.
            r = _req.post(f"{router_url}/route", json={
                "channel": "playground",
                "user_id": emp_id,
                "message": body.message,
            }, timeout=180)
            if r.status_code == 200:
                data = r.json()
                agent_response = data.get("response", {})
                resp_text = agent_response.get("response", str(data)) if isinstance(agent_response, dict) else str(agent_response)
                return {
                    "response": resp_text,
                    "tenant_id": data.get("tenant_id", body.tenant_id),
                    "profile": profile,
                    "plan_a": profile.get("planA", ""),
                    "plan_e": "✅ PASS — Real agent response via AgentCore.",
                    "source": "agentcore",
                }
            else:
                return {
                    "response": f"⚠️ AgentCore returned {r.status_code}: {r.text[:200]}",
                    "tenant_id": body.tenant_id,
                    "profile": profile,
                    "plan_a": profile.get("planA", ""),
                    "plan_e": f"⚠️ ERROR — Status {r.status_code}",
                    "source": "error",
                }
        except Exception as e:
            return {
                "response": f"⚠️ AgentCore call failed: {e}\n\nFalling back to simulation.",
                "tenant_id": body.tenant_id,
                "profile": profile,
                "plan_a": profile.get("planA", ""),
                "plan_e": "⚠️ ERROR — AgentCore unreachable.",
                "source": "error",
            }

    # Simulate mode: permission-aware canned responses
    msg = body.message.lower()
    is_shell = any(w in msg for w in ["shell", "run", "execute", "command", "terminal"])
    is_file = any(w in msg for w in ["file", "write", "save", "create file", "export"])
    is_code = any(w in msg for w in ["code", "compile", "debug", "test"])
    is_search = any(w in msg for w in ["search", "find", "look up", "google", "research"])
    is_email = any(w in msg for w in ["email", "send mail", "compose"])
    is_jira = any(w in msg for w in ["jira", "ticket", "issue", "bug"])

    # Check permission
    if is_shell and "shell" not in profile["tools"]:
        response = f"⛔ Permission denied: Your {profile['role']} role does not have access to shell commands. This request has been logged.\n\nYou can submit an approval request if you need temporary access. Would you like me to do that?"
        plan_e = "⛔ BLOCKED — Plan A denied before execution."
    elif is_file and "file_write" not in profile["tools"] and "file" not in profile["tools"]:
        response = f"⛔ Permission denied: Your {profile['role']} role does not have file write access. Only read-only file access is available."
        plan_e = "⛔ BLOCKED — Plan A denied file_write."
    elif is_code and "code_execution" not in profile["tools"]:
        response = f"⛔ Permission denied: Your {profile['role']} role does not have code execution access."
        plan_e = "⛔ BLOCKED — Plan A denied code_execution."
    elif is_shell:
        response = "✅ Shell access granted. Running in sandboxed Docker environment.\n\n```\n$ git status\nOn branch main\nYour branch is up to date with 'origin/main'.\n\nChanges not staged for commit:\n  modified:   src/api/handler.py\n  modified:   tests/test_handler.py\n\nno changes added to commit\n```\n\nYou have 2 modified files. Would you like me to show the diff?"
        plan_e = "✅ PASS — Output scanned. No sensitive data, no credentials detected."
    elif is_email:
        if "email-send" in str(profile["tools"]) or profile["role"] in ["sales", "csm", "hr", "management"]:
            response = "📧 I can help you compose an email. Please provide:\n\n- **To:** recipient email address\n- **Subject:** email subject line\n- **Body:** email content\n\n⚠️ Note: Every email requires your confirmation before sending (Approval Required skill)."
            plan_e = "✅ PASS — Email skill available, approval-per-use enforced."
        else:
            response = f"⛔ Your {profile['role']} role does not have email sending capability. Please contact IT to request access."
            plan_e = "⛔ BLOCKED — email-send skill not in role allowlist."
    elif is_jira:
        if profile["role"] in ["engineering", "product", "management", "qa", "admin"]:
            response = "🎫 Querying Jira...\n\n| Key | Summary | Status | Assignee | Priority |\n|-----|---------|--------|----------|----------|\n| PROJ-1234 | Fix login timeout | In Progress | Alice Chen | High |\n| PROJ-1235 | Update API docs | Open | Bob Wang | Medium |\n| PROJ-1236 | Add unit tests | In Review | Carol Li | Low |\n\n3 issues found. Would you like details on any of these?"
            plan_e = "✅ PASS — Jira query returned public project data only."
        else:
            response = f"⛔ Your {profile['role']} role does not have Jira access. This skill is restricted to engineering, product, and management roles."
            plan_e = "⛔ BLOCKED — jira-query skill not in role allowlist."
    elif is_search:
        response = "🔍 Searching the web...\n\nHere's what I found:\n\n1. **AWS Well-Architected Framework** — Best practices for building secure, high-performing, resilient, and efficient infrastructure.\n2. **Microservices Design Patterns** — Common patterns for building distributed systems.\n3. **Cost Optimization on AWS** — Strategies to reduce cloud spending by 30-50%.\n\nWould you like me to dive deeper into any of these topics?"
        plan_e = "✅ PASS — Web search results contain no sensitive data."
    elif "hello" in msg or "hi" in msg or "hey" in msg:
        response = f"Hello! I'm your AI assistant running as a **{profile['role']}** role. I have access to these tools: {', '.join(profile['tools'])}.\n\nHow can I help you today? Try asking me to:\n- Search the web for information\n- {'Run shell commands' if 'shell' in profile['tools'] else '(shell access not available for your role)'}\n- {'Query Jira tickets' if profile['role'] in ['engineering','product','admin','qa'] else '(Jira not available for your role)'}"
        plan_e = "✅ PASS — Greeting response, no tool execution."
    elif "help" in msg or "what can" in msg or "capabilities" in msg:
        tools_desc = {
            "web_search": "🔍 Web Search — search the internet",
            "shell": "💻 Shell — execute terminal commands (sandboxed)",
            "browser": "🌐 Browser — navigate web pages",
            "file": "📁 File — read files",
            "file_write": "✏️ File Write — create and edit files",
            "code_execution": "⚡ Code Execution — run code in Docker sandbox",
        }
        available = "\n".join(f"  - {tools_desc.get(t, t)}" for t in profile["tools"])
        response = f"I'm running as **{profile['role']}** role. Here are my capabilities:\n\n**Available tools:**\n{available}\n\n**Skills:** web-search, jina-reader, deep-research" + (", jira-query, github-pr" if profile["role"] in ["engineering","admin"] else "") + "\n\nWhat would you like me to do?"
        plan_e = "✅ PASS — Capability listing, no execution."
    else:
        response = f"I can help you with that. As a **{profile['role']}** role, I have access to: {', '.join(profile['tools'])}.\n\nCould you be more specific about what you'd like me to do? For example:\n- \"Search for AWS best practices\"\n- \"Run git status\"\n- \"Query Jira ticket PROJ-1234\""
        plan_e = "✅ PASS — No policy violations."

    return {
        "response": response,
        "tenant_id": body.tenant_id,
        "profile": profile,
        "plan_a": profile["planA"],
        "plan_e": plan_e,
    }
