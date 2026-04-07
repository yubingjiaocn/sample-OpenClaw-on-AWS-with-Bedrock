"""
Tests for routers/admin_eks.py — EKS agent management endpoints.

Covers:
  1. Operator pre-flight — deploy blocked when operator not installed
  2. Deploy — creates CRD, writes SSM, updates DynamoDB
  3. Stop — deletes CRD, cleans SSM
  4. Reload — patches CRD config version
  5. Status — returns CRD + pod info
  6. Logs — returns pod logs
  7. Assign / Unassign — SSM endpoint routing
  8. Operator endpoints — status, install, upgrade
"""

import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

# Add server dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Mock kubernetes_asyncio before any imports pull it in
sys.modules["kubernetes_asyncio"] = MagicMock()
sys.modules["kubernetes_asyncio.config"] = MagicMock()
sys.modules["kubernetes_asyncio.client"] = MagicMock()

# Mock the k8s_client singleton at module level
_mock_k8s = MagicMock()
_mock_k8s.get_operator_status = AsyncMock(return_value={
    "installed": True, "crd_exists": True, "deployment_ready": True,
    "namespace": "openclaw-operator-system", "version": "0.22.2", "pods": [],
})
_mock_k8s.create_openclaw_instance = AsyncMock(return_value={"status": "created", "name": "agt-1"})
_mock_k8s.delete_openclaw_instance = AsyncMock(return_value={"status": "deleted", "name": "agt-1"})
_mock_k8s.patch_openclaw_instance = AsyncMock(return_value={"status": "patched", "name": "agt-1"})
_mock_k8s.get_openclaw_instance = AsyncMock(return_value={"metadata": {"name": "agt-1"}, "status": {"phase": "Running"}})
_mock_k8s.get_pod_status = AsyncMock(return_value={"status": "found", "phase": "Running", "pod_name": "agt-1-0", "node": "ip-10-0-1-42", "containers": [], "conditions": []})
_mock_k8s.get_pod_logs = AsyncMock(return_value={"pod_name": "agt-1-0", "container": "openclaw", "logs": "INFO started", "available_containers": ["openclaw"], "tail_lines": 100})
_mock_k8s.install_operator = AsyncMock(return_value={"status": "installed", "version": "0.22.2", "namespace": "openclaw-operator-system", "output": "ok"})
_mock_k8s.upgrade_operator = AsyncMock(return_value={"status": "upgraded", "version": "0.23.0", "namespace": "openclaw-operator-system", "output": "ok"})

# Patch before importing the router
with patch.dict("sys.modules", {
    "services.k8s_client": MagicMock(
        k8s_client=_mock_k8s,
        OPENCLAW_NAMESPACE="openclaw",
        OPERATOR_NAMESPACE="openclaw-operator-system",
    ),
}):
    # Mock shared module dependencies
    _mock_ssm_client = MagicMock()
    _mock_shared = MagicMock()
    _mock_shared.require_role = MagicMock(return_value=MagicMock(role="admin", employee_id="admin-1", name="Admin"))
    _mock_shared.require_auth = _mock_shared.require_role
    _mock_shared.ssm_client = MagicMock(return_value=_mock_ssm_client)
    _mock_shared.STACK_NAME = "test-stack"
    _mock_shared.GATEWAY_REGION = "us-east-1"
    _mock_shared.GATEWAY_ACCOUNT_ID = "123456789012"

    _mock_db = MagicMock()
    _mock_db.get_agent = MagicMock(return_value={
        "id": "agt-carol", "employeeId": "emp-carol", "positionId": "pos-sde",
        "name": "Carol's Agent", "status": "active", "deployMode": "serverless",
    })
    _mock_db.create_audit_entry = MagicMock()

    _mock_s3ops = MagicMock()
    _mock_s3ops.get_soul_layers = MagicMock(return_value={
        "global": {"SOUL.md": "You are a helpful AI assistant.", "AGENTS.md": "", "TOOLS.md": ""},
        "position": {"SOUL.md": "You are an SDE.", "AGENTS.md": ""},
        "personal": {"SOUL.md": "", "USER.md": "Carol, Engineering"},
    })

    with patch.dict("sys.modules", {"shared": _mock_shared, "db": _mock_db, "s3ops": _mock_s3ops, "auth": MagicMock()}):
        from fastapi.testclient import TestClient
        from routers.admin_eks import router

        from fastapi import FastAPI
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)

AUTH_HEADER = {"Authorization": "Bearer test-token"}


# ---------------------------------------------------------------------------
# 1. Operator Pre-flight Check
# ---------------------------------------------------------------------------

class TestOperatorPreflight(unittest.TestCase):

    def test_deploy_blocked_when_operator_not_installed(self):
        _mock_k8s.get_operator_status = AsyncMock(return_value={
            "installed": False, "crd_exists": False, "deployment_ready": False,
            "namespace": "openclaw-operator-system", "version": "", "pods": [],
        })
        resp = client.post("/api/v1/admin/eks/agt-carol/deploy", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 428)
        self.assertIn("not installed", resp.json()["detail"])

    def test_deploy_succeeds_when_operator_installed(self):
        _mock_k8s.get_operator_status = AsyncMock(return_value={
            "installed": True, "crd_exists": True, "deployment_ready": True,
            "namespace": "openclaw-operator-system", "version": "0.22.2", "pods": [],
        })
        _mock_k8s.create_openclaw_instance = AsyncMock(return_value={"status": "created", "name": "agt-carol"})
        resp = client.post("/api/v1/admin/eks/agt-carol/deploy", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["deployed"])


# ---------------------------------------------------------------------------
# 2. Deploy
# ---------------------------------------------------------------------------

class TestDeploy(unittest.TestCase):

    def setUp(self):
        _mock_k8s.get_operator_status = AsyncMock(return_value={
            "installed": True, "crd_exists": True, "deployment_ready": True,
            "namespace": "openclaw-operator-system", "version": "0.22.2", "pods": [],
        })
        _mock_k8s.create_openclaw_instance = AsyncMock(return_value={"status": "created", "name": "agt-carol"})

    def test_deploy_success(self):
        resp = client.post("/api/v1/admin/eks/agt-carol/deploy", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["deployed"])
        self.assertEqual(body["agentId"], "agt-carol")
        self.assertEqual(body["namespace"], "openclaw")
        self.assertIn("openclaw.svc:18789", body["endpoint"])
        # Verify workspace files from S3 SOUL layers are passed
        self.assertIn("SOUL.md", body["workspaceFiles"])

    def test_deploy_passes_workspace_files_and_skills(self):
        resp = client.post("/api/v1/admin/eks/agt-carol/deploy", headers=AUTH_HEADER,
                           json={"skills": ["jina-reader", "deep-research-pro"]})
        self.assertEqual(resp.status_code, 200)
        call_kwargs = _mock_k8s.create_openclaw_instance.call_args[1]
        # Should pass assembled workspace files from s3ops.get_soul_layers
        self.assertIn("SOUL.md", call_kwargs["workspace_files"])
        self.assertIn("USER.md", call_kwargs["workspace_files"])
        # Should pass skills
        self.assertEqual(call_kwargs["skills"], ["jina-reader", "deep-research-pro"])

    def test_deploy_with_custom_model(self):
        resp = client.post("/api/v1/admin/eks/agt-carol/deploy", headers=AUTH_HEADER,
                           json={"model": "bedrock/claude-opus"})
        self.assertEqual(resp.status_code, 200)
        call_kwargs = _mock_k8s.create_openclaw_instance.call_args[1]
        self.assertEqual(call_kwargs["model"], "bedrock/claude-opus")

    def test_deploy_agent_not_found(self):
        _mock_db.get_agent = MagicMock(return_value=None)
        resp = client.post("/api/v1/admin/eks/agt-missing/deploy", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 404)
        # Restore
        _mock_db.get_agent = MagicMock(return_value={
            "id": "agt-carol", "employeeId": "emp-carol", "positionId": "pos-sde",
            "name": "Carol's Agent", "status": "active",
        })

    def test_deploy_conflict_returns_409(self):
        _mock_k8s.create_openclaw_instance = AsyncMock(
            side_effect=ValueError("Agent agt-carol already exists"))
        resp = client.post("/api/v1/admin/eks/agt-carol/deploy", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 409)
        self.assertIn("already exists", resp.json()["detail"])

    def test_deploy_creates_audit_entry(self):
        _mock_k8s.create_openclaw_instance = AsyncMock(return_value={"status": "created"})
        _mock_db.create_audit_entry.reset_mock()
        client.post("/api/v1/admin/eks/agt-carol/deploy", headers=AUTH_HEADER, json={})
        _mock_db.create_audit_entry.assert_called_once()
        audit = _mock_db.create_audit_entry.call_args[0][0]
        self.assertEqual(audit["eventType"], "config_change")
        self.assertIn("EKS", audit["detail"])


# ---------------------------------------------------------------------------
# 3. Stop
# ---------------------------------------------------------------------------

class TestStop(unittest.TestCase):

    def setUp(self):
        _mock_k8s.delete_openclaw_instance = AsyncMock(return_value={"status": "deleted", "name": "agt-carol"})

    def test_stop_success(self):
        resp = client.post("/api/v1/admin/eks/agt-carol/stop", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["stopped"])

    def test_stop_agent_not_found(self):
        _mock_db.get_agent = MagicMock(return_value=None)
        resp = client.post("/api/v1/admin/eks/agt-missing/stop", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 404)
        _mock_db.get_agent = MagicMock(return_value={
            "id": "agt-carol", "employeeId": "emp-carol", "positionId": "pos-sde",
            "name": "Carol's Agent", "status": "active",
        })


# ---------------------------------------------------------------------------
# 4. Reload
# ---------------------------------------------------------------------------

class TestReload(unittest.TestCase):

    def setUp(self):
        _mock_k8s.patch_openclaw_instance = AsyncMock(return_value={"status": "patched"})

    def test_reload_success(self):
        resp = client.post("/api/v1/admin/eks/agt-carol/reload", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["reloaded"])
        self.assertIn("configVersion", body)

    def test_reload_with_model_update(self):
        resp = client.post("/api/v1/admin/eks/agt-carol/reload", headers=AUTH_HEADER,
                           json={"model": "bedrock/claude-opus"})
        self.assertEqual(resp.status_code, 200)
        call_kwargs = _mock_k8s.patch_openclaw_instance.call_args[0]
        patch_body = call_kwargs[2]  # third positional arg is the patch dict
        # Model ID should use amazon-bedrock/ prefix (matching openclaw.json provider name)
        self.assertEqual(patch_body["spec"]["config"]["raw"]["agents"]["defaults"]["model"]["primary"],
                         "amazon-bedrock/claude-opus")
        # Should also include full Bedrock provider config with model details
        self.assertIn("models", patch_body["spec"]["config"]["raw"])
        bedrock_models = patch_body["spec"]["config"]["raw"]["models"]["providers"]["amazon-bedrock"]["models"]
        self.assertEqual(bedrock_models[0]["id"], "claude-opus")

    def test_reload_not_found(self):
        _mock_k8s.patch_openclaw_instance = AsyncMock(
            side_effect=ValueError("Agent agt-gone not found"))
        resp = client.post("/api/v1/admin/eks/agt-gone/reload", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 404)


# ---------------------------------------------------------------------------
# 5. Status
# ---------------------------------------------------------------------------

class TestStatus(unittest.TestCase):

    def test_status_running(self):
        _mock_k8s.get_openclaw_instance = AsyncMock(
            return_value={"metadata": {"name": "agt-carol"}, "status": {"phase": "Running"}})
        _mock_k8s.get_pod_status = AsyncMock(return_value={
            "status": "found", "phase": "Running", "pod_name": "agt-carol-0",
            "node": "ip-10-0-1-42", "containers": [], "conditions": [],
        })
        resp = client.get("/api/v1/admin/eks/agt-carol/status", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["running"])
        self.assertIn("18789", body["endpoint"])

    def test_status_crd_not_found(self):
        _mock_k8s.get_openclaw_instance = AsyncMock(return_value=None)
        resp = client.get("/api/v1/admin/eks/agt-missing/status", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertFalse(body["running"])
        self.assertEqual(body["crdStatus"], "NOT_FOUND")

    def test_status_pod_pending(self):
        _mock_k8s.get_openclaw_instance = AsyncMock(return_value={"status": {"phase": "Pending"}})
        _mock_k8s.get_pod_status = AsyncMock(return_value={
            "status": "found", "phase": "Pending", "pod_name": "agt-1-0",
        })
        resp = client.get("/api/v1/admin/eks/agt-1/status", headers=AUTH_HEADER)
        body = resp.json()
        self.assertFalse(body["running"])
        self.assertIsNone(body["endpoint"])


# ---------------------------------------------------------------------------
# 6. Logs
# ---------------------------------------------------------------------------

class TestLogs(unittest.TestCase):

    def test_logs_success(self):
        _mock_k8s.get_pod_logs = AsyncMock(return_value={
            "pod_name": "agt-carol-0", "container": "openclaw",
            "logs": "INFO started", "available_containers": ["openclaw"],
            "tail_lines": 100,
        })
        resp = client.get("/api/v1/admin/eks/agt-carol/logs", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 200)
        self.assertIn("INFO started", resp.json()["logs"])

    def test_logs_not_found(self):
        _mock_k8s.get_pod_logs = AsyncMock(return_value={"error": "Pod not found", "logs": ""})
        resp = client.get("/api/v1/admin/eks/agt-gone/logs", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 404)

    def test_logs_custom_params(self):
        _mock_k8s.get_pod_logs = AsyncMock(return_value={
            "pod_name": "agt-1-0", "container": "metrics-exporter",
            "logs": "metric line", "available_containers": ["openclaw", "metrics-exporter"],
            "tail_lines": 50,
        })
        resp = client.get("/api/v1/admin/eks/agt-1/logs?container=metrics-exporter&tail=50",
                          headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 200)
        call_kwargs = _mock_k8s.get_pod_logs.call_args[1]
        self.assertEqual(call_kwargs["container"], "metrics-exporter")
        self.assertEqual(call_kwargs["tail_lines"], 50)


# ---------------------------------------------------------------------------
# 7. Assign / Unassign
# ---------------------------------------------------------------------------

class TestAssign(unittest.TestCase):

    def test_assign_success(self):
        resp = client.put("/api/v1/admin/eks/agt-carol/assign/emp-carol", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["assigned"])
        self.assertIn("18789", body["endpoint"])

    def test_unassign_success(self):
        resp = client.delete("/api/v1/admin/eks/agt-carol/assign/emp-carol", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.json()["unassigned"])


# ---------------------------------------------------------------------------
# 8. Operator Endpoints
# ---------------------------------------------------------------------------

class TestOperatorStatus(unittest.TestCase):

    def test_operator_status(self):
        _mock_k8s.get_operator_status = AsyncMock(return_value={
            "installed": True, "crd_exists": True, "deployment_ready": True,
            "namespace": "openclaw-operator-system", "version": "0.22.2", "pods": [],
        })
        resp = client.get("/api/v1/admin/eks/operator/status", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body["installed"])
        self.assertEqual(body["version"], "0.22.2")

    def test_operator_status_k8s_unreachable(self):
        _mock_k8s.get_operator_status = AsyncMock(side_effect=Exception("Connection refused"))
        resp = client.get("/api/v1/admin/eks/operator/status", headers=AUTH_HEADER)
        self.assertEqual(resp.status_code, 502)


class TestOperatorInstall(unittest.TestCase):

    def test_install_success(self):
        _mock_k8s.get_operator_status = AsyncMock(return_value={
            "installed": False, "crd_exists": False, "deployment_ready": False,
            "namespace": "openclaw-operator-system", "version": "", "pods": [],
        })
        _mock_k8s.install_operator = AsyncMock(return_value={
            "status": "installed", "version": "0.22.2", "namespace": "openclaw-operator-system", "output": "ok",
        })
        resp = client.post("/api/v1/admin/eks/operator/install", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "installed")

    def test_install_already_installed(self):
        _mock_k8s.get_operator_status = AsyncMock(return_value={
            "installed": True, "crd_exists": True, "deployment_ready": True,
            "namespace": "openclaw-operator-system", "version": "0.22.2", "pods": [],
        })
        resp = client.post("/api/v1/admin/eks/operator/install", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "already_installed")

    def test_install_failure(self):
        _mock_k8s.get_operator_status = AsyncMock(return_value={
            "installed": False, "crd_exists": False, "deployment_ready": False,
            "namespace": "openclaw-operator-system", "version": "", "pods": [],
        })
        _mock_k8s.install_operator = AsyncMock(side_effect=RuntimeError("helm: command not found"))
        resp = client.post("/api/v1/admin/eks/operator/install", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 500)
        self.assertIn("helm", resp.json()["detail"])

    def test_install_custom_version(self):
        _mock_k8s.get_operator_status = AsyncMock(return_value={"installed": False})
        _mock_k8s.install_operator = AsyncMock(return_value={"status": "installed", "version": "0.23.0"})
        resp = client.post("/api/v1/admin/eks/operator/install", headers=AUTH_HEADER,
                           json={"version": "0.23.0"})
        self.assertEqual(resp.status_code, 200)
        call_kwargs = _mock_k8s.install_operator.call_args[1]
        self.assertEqual(call_kwargs["version"], "0.23.0")


class TestOperatorUpgrade(unittest.TestCase):

    def test_upgrade_success(self):
        _mock_k8s.upgrade_operator = AsyncMock(return_value={
            "status": "upgraded", "version": "0.23.0", "namespace": "openclaw-operator-system",
        })
        resp = client.post("/api/v1/admin/eks/operator/upgrade", headers=AUTH_HEADER,
                           json={"version": "0.23.0"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["status"], "upgraded")

    def test_upgrade_failure(self):
        _mock_k8s.upgrade_operator = AsyncMock(side_effect=RuntimeError("release not found"))
        resp = client.post("/api/v1/admin/eks/operator/upgrade", headers=AUTH_HEADER, json={})
        self.assertEqual(resp.status_code, 500)


# ---------------------------------------------------------------------------
# Route ordering — "operator" must not match {agent_id}
# ---------------------------------------------------------------------------

class TestRouteOrdering(unittest.TestCase):

    def test_operator_status_not_matched_as_agent_id(self):
        """Verify /admin/eks/operator/status hits the operator endpoint, not {agent_id}/status."""
        _mock_k8s.get_operator_status = AsyncMock(return_value={
            "installed": True, "crd_exists": True, "deployment_ready": True,
            "namespace": "openclaw-operator-system", "version": "0.22.2", "pods": [],
        })
        resp = client.get("/api/v1/admin/eks/operator/status", headers=AUTH_HEADER)
        body = resp.json()
        # Operator endpoint returns "installed" key; agent status returns "running"
        self.assertIn("installed", body)
        self.assertNotIn("running", body)


if __name__ == "__main__":
    unittest.main(verbosity=2)
