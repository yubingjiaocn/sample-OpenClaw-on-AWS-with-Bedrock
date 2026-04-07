"""
Routing validation tests for tenant_router.py

Covers:
  1. derive_tenant_id — format, length, stability, all channel aliases
  2. TenantRouterHandler HTTP — bad request cases, successful route
  3. _invoke_local_container — success and error paths
  4. _invoke_agentcore — success and ClientError paths
  5. Full POST /route → invoke_agent_runtime → response chain (demo mode)
"""

import io
import json
import os
import sys
import unittest
from unittest.mock import MagicMock, patch

# Add agent-container dir to path so imports work
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import tenant_router


# ---------------------------------------------------------------------------
# 1. derive_tenant_id
# ---------------------------------------------------------------------------

class TestDeriveTenantId(unittest.TestCase):

    def test_basic_format(self):
        tid = tenant_router.derive_tenant_id("whatsapp", "8613800138000")
        parts = tid.split("__")
        self.assertEqual(len(parts), 3, f"Expected 3 parts, got: {tid}")
        self.assertEqual(parts[0], "wa")
        self.assertEqual(parts[1], "8613800138000")
        self.assertEqual(len(parts[2]), 19)

    def test_minimum_length_33(self):
        # AgentCore requires runtimeSessionId >= 33 chars
        tid = tenant_router.derive_tenant_id("wa", "abc")
        self.assertGreaterEqual(len(tid), 33, f"tenant_id too short: {tid!r}")

    def test_all_channel_aliases(self):
        aliases = {
            "whatsapp": "wa", "telegram": "tg", "discord": "dc",
            "slack": "sl", "teams": "ms", "imessage": "im",
            "googlechat": "gc", "webchat": "web",
        }
        for full, short in aliases.items():
            tid = tenant_router.derive_tenant_id(full, "user123")
            self.assertTrue(tid.startswith(f"{short}__"), f"{full} -> {tid}")

    def test_unknown_channel_truncated(self):
        tid = tenant_router.derive_tenant_id("mychannel", "user1")
        self.assertTrue(tid.startswith("myc"), tid)

    def test_pattern_valid(self):
        tid = tenant_router.derive_tenant_id("telegram", "123456789")
        self.assertRegex(tid, r"^[a-zA-Z0-9_.\-]{1,128}$")

    def test_max_length_128(self):
        long_user = "x" * 200
        tid = tenant_router.derive_tenant_id("whatsapp", long_user)
        self.assertLessEqual(len(tid), 128, f"tenant_id too long: {len(tid)}")

    def test_stability_same_day(self):
        """Same channel+user on same day always produces same tenant_id."""
        tid1 = tenant_router.derive_tenant_id("discord", "987654321")
        tid2 = tenant_router.derive_tenant_id("discord", "987654321")
        self.assertEqual(tid1, tid2)

    def test_special_chars_sanitized(self):
        tid = tenant_router.derive_tenant_id("whatsapp", "+86 138-0013#8000")
        self.assertRegex(tid, r"^[a-zA-Z0-9_.\-]{1,128}$")

    def test_different_users_different_ids(self):
        tid1 = tenant_router.derive_tenant_id("telegram", "111")
        tid2 = tenant_router.derive_tenant_id("telegram", "222")
        self.assertNotEqual(tid1, tid2)

    def test_different_channels_different_ids(self):
        tid1 = tenant_router.derive_tenant_id("whatsapp", "user1")
        tid2 = tenant_router.derive_tenant_id("telegram", "user1")
        self.assertNotEqual(tid1, tid2)


# ---------------------------------------------------------------------------
# 2. TenantRouterHandler — HTTP request handling
# ---------------------------------------------------------------------------

def _make_handler(method, path, body_dict=None):
    """Build a TenantRouterHandler with a fake socket/request."""
    body_bytes = json.dumps(body_dict or {}).encode() if body_dict is not None else b""
    headers = {
        "Content-Length": str(len(body_bytes)),
        "Content-Type": "application/json",
    }

    # Build a minimal fake request object
    class FakeRequest:
        def makefile(self, mode, bufsize=None):
            return io.BytesIO(body_bytes)

    fake_request = FakeRequest()
    fake_address = ("127.0.0.1", 12345)
    fake_server = MagicMock()

    # Patch BaseHTTPRequestHandler internals
    handler = tenant_router.TenantRouterHandler.__new__(tenant_router.TenantRouterHandler)
    handler.rfile = io.BytesIO(body_bytes)
    handler.wfile = io.BytesIO()
    handler.path = path
    handler.command = method
    handler.request_version = "HTTP/1.1"
    handler.headers = MagicMock()
    handler.headers.get = lambda k, d=None: headers.get(k, d)
    handler.server = fake_server
    handler.close_connection = True

    # Capture _respond output
    responses = []
    def fake_respond(status, body):
        responses.append((status, body))
    handler._respond = fake_respond

    return handler, responses


class TestTenantRouterHandler(unittest.TestCase):

    def test_get_health(self):
        handler, responses = _make_handler("GET", "/health")
        handler.do_GET()
        self.assertEqual(len(responses), 1)
        status, body = responses[0]
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

    def test_get_unknown(self):
        handler, responses = _make_handler("GET", "/unknown")
        handler.do_GET()
        status, body = responses[0]
        self.assertEqual(status, 404)

    def test_post_unknown_path(self):
        handler, responses = _make_handler("POST", "/notaroute", {"x": 1})
        handler.do_POST()
        self.assertEqual(responses[0][0], 404)

    def test_route_missing_channel(self):
        handler, responses = _make_handler("POST", "/route", {"user_id": "u1", "message": "hi"})
        handler.do_POST()
        status, body = responses[0]
        self.assertEqual(status, 400)
        self.assertIn("channel", body["error"])

    def test_route_missing_user_id(self):
        handler, responses = _make_handler("POST", "/route", {"channel": "telegram", "message": "hi"})
        handler.do_POST()
        status, body = responses[0]
        self.assertEqual(status, 400)
        self.assertIn("user_id", body["error"])

    def test_route_missing_message(self):
        handler, responses = _make_handler("POST", "/route", {"channel": "telegram", "user_id": "u1"})
        handler.do_POST()
        status, body = responses[0]
        self.assertEqual(status, 400)
        self.assertIn("message", body["error"])

    def test_route_invalid_json(self):
        handler, responses = _make_handler("POST", "/route")
        # Override rfile with garbage
        handler.rfile = io.BytesIO(b"not-json{{{")
        handler.headers.get = lambda k, d=None: {"Content-Length": "11"}.get(k, d)
        handler.do_POST()
        self.assertEqual(responses[0][0], 400)

    def test_route_success_demo_mode(self):
        handler, responses = _make_handler("POST", "/route", {
            "channel": "whatsapp",
            "user_id": "8613800138000",
            "message": "Hello",
        })
        mock_result = {"response": "Hi there!", "status": "success"}
        with patch.object(tenant_router, "invoke_agent_runtime", return_value=mock_result):
            handler.do_POST()

        status, body = responses[0]
        self.assertEqual(status, 200)
        self.assertIn("tenant_id", body)
        self.assertEqual(body["response"], mock_result)
        # Verify tenant_id was derived correctly
        self.assertTrue(body["tenant_id"].startswith("wa__8613800138000__"))

    def test_route_runtime_error_returns_502(self):
        handler, responses = _make_handler("POST", "/route", {
            "channel": "telegram",
            "user_id": "user42",
            "message": "test",
        })
        with patch.object(tenant_router, "invoke_agent_runtime", side_effect=RuntimeError("AgentCore down")):
            handler.do_POST()

        status, body = responses[0]
        self.assertEqual(status, 502)
        self.assertIn("AgentCore down", body["error"])


# ---------------------------------------------------------------------------
# 3. _invoke_local_container
# ---------------------------------------------------------------------------

class TestInvokeLocalContainer(unittest.TestCase):

    def test_success(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"response": "Hello from agent", "status": "success"}

        with patch("requests.post", return_value=mock_resp):
            result = tenant_router._invoke_local_container(
                "http://localhost:8080", "wa__user1__abc", "Hello", None
            )
        self.assertEqual(result["response"], "Hello from agent")

    def test_non_200_raises(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "Internal Server Error"

        with patch("requests.post", return_value=mock_resp):
            with self.assertRaises(RuntimeError) as ctx:
                tenant_router._invoke_local_container(
                    "http://localhost:8080", "wa__user1__abc", "Hi", None
                )
        self.assertIn("500", str(ctx.exception))

    def test_connection_error_raises(self):
        import requests as _req
        with patch("requests.post", side_effect=_req.exceptions.ConnectionError("refused")):
            with self.assertRaises(RuntimeError) as ctx:
                tenant_router._invoke_local_container(
                    "http://localhost:9999", "wa__user1__abc", "Hi", None
                )
        self.assertIn("not reachable", str(ctx.exception))

    def test_model_forwarded(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"response": "ok"}

        captured = {}
        def fake_post(url, json, timeout):
            captured["json"] = json
            return mock_resp

        with patch("requests.post", side_effect=fake_post):
            tenant_router._invoke_local_container(
                "http://localhost:8080", "tg__u__abc", "Hello", "claude-sonnet"
            )
        self.assertEqual(captured["json"]["model"], "claude-sonnet")


# ---------------------------------------------------------------------------
# 4. _invoke_agentcore — production path
# ---------------------------------------------------------------------------

class TestInvokeAgentcore(unittest.TestCase):

    def _make_mock_client(self, response_payload: dict):
        client = MagicMock()
        client.invoke_agent_runtime.return_value = {
            "response": json.dumps(response_payload).encode()
        }
        return client

    def test_success_with_arn_env(self):
        mock_client = self._make_mock_client({"response": "Done!", "status": "success"})
        with patch.object(tenant_router, "_agentcore_client", return_value=mock_client):
            with patch.dict(os.environ, {
                "AGENTCORE_RUNTIME_ARN": "arn:aws:bedrock-agentcore:us-east-1:123456789012:runtime/rt-abc",
                "AGENTCORE_RUNTIME_ID": "rt-abc",
            }):
                result = tenant_router._invoke_agentcore("wa__user1__abc", "Hello", None)
        self.assertEqual(result["response"], "Done!")

    def test_constructs_arn_from_sts(self):
        # RUNTIME_ID is a module-level var set at import time — must patch the module attr directly
        mock_client = self._make_mock_client({"response": "Hi"})
        mock_sts = MagicMock()
        mock_sts.get_caller_identity.return_value = {"Account": "111122223333"}

        with patch.object(tenant_router, "RUNTIME_ID", "rt-xyz"):
            with patch.object(tenant_router, "_agentcore_client", return_value=mock_client):
                with patch("boto3.client", return_value=mock_sts):
                    os.environ.pop("AGENTCORE_RUNTIME_ARN", None)
                    result = tenant_router._invoke_agentcore("tg__u2__abc", "test", None)
        self.assertEqual(result["response"], "Hi")
        # Verify correct ARN was constructed
        call_kwargs = mock_client.invoke_agent_runtime.call_args[1]
        self.assertIn("111122223333", call_kwargs["agentRuntimeArn"])
        self.assertIn("rt-xyz", call_kwargs["agentRuntimeArn"])

    def test_client_error_raises_runtime_error(self):
        from botocore.exceptions import ClientError
        mock_client = MagicMock()
        mock_client.invoke_agent_runtime.side_effect = ClientError(
            {"Error": {"Code": "AccessDeniedException", "Message": "Not authorized"}},
            "InvokeAgentRuntime"
        )
        with patch.object(tenant_router, "_agentcore_client", return_value=mock_client):
            with patch.dict(os.environ, {
                "AGENTCORE_RUNTIME_ARN": "arn:aws:bedrock-agentcore:us-east-1:123:runtime/rt-1",
            }):
                with self.assertRaises(RuntimeError) as ctx:
                    tenant_router._invoke_agentcore("wa__u__abc", "Hi", None)
        self.assertIn("AccessDeniedException", str(ctx.exception))


# ---------------------------------------------------------------------------
# 5. invoke_agent_runtime — routing decision (demo vs production)
# ---------------------------------------------------------------------------

class TestInvokeAgentRuntimeDispatch(unittest.TestCase):

    def test_demo_mode_uses_local_container(self):
        with patch.dict(os.environ, {"AGENT_CONTAINER_URL": "http://localhost:8080"}):
            with patch.object(tenant_router, "_invoke_local_container", return_value={"response": "ok"}) as mock_local:
                result = tenant_router.invoke_agent_runtime("wa__u__abc", "Hi")
        mock_local.assert_called_once_with("http://localhost:8080", "wa__u__abc", "Hi", None)
        self.assertEqual(result["response"], "ok")

    def test_production_mode_uses_agentcore(self):
        # RUNTIME_ID is a module-level var — patch it directly so invoke_agent_runtime sees it
        os.environ.pop("AGENT_CONTAINER_URL", None)
        with patch.object(tenant_router, "RUNTIME_ID", "rt-abc"):
            with patch.object(tenant_router, "_invoke_agentcore", return_value={"response": "prod"}) as mock_ac:
                result = tenant_router.invoke_agent_runtime("tg__u__abc", "Hello", model="nova")
        mock_ac.assert_called_once_with("tg__u__abc", "Hello", "nova")
        self.assertEqual(result["response"], "prod")

    def test_no_runtime_id_raises(self):
        orig = tenant_router.RUNTIME_ID
        tenant_router.RUNTIME_ID = ""
        try:
            os.environ.pop("AGENT_CONTAINER_URL", None)
            os.environ.pop("AGENTCORE_RUNTIME_ID", None)
            with self.assertRaises(RuntimeError) as ctx:
                tenant_router.invoke_agent_runtime("wa__u__abc", "Hi")
            self.assertIn("AGENTCORE_RUNTIME_ID not configured", str(ctx.exception))
        finally:
            tenant_router.RUNTIME_ID = orig


# ---------------------------------------------------------------------------
# 6. Full end-to-end chain: POST /route -> derive -> local container -> 200
# ---------------------------------------------------------------------------

class TestEndToEndChain(unittest.TestCase):

    def test_whatsapp_message_routed_to_local_container(self):
        """Simulate a WhatsApp message arriving at /route in demo mode."""
        handler, responses = _make_handler("POST", "/route", {
            "channel": "whatsapp",
            "user_id": "8613800138000",
            "message": "What is 2+2?",
        })

        agent_response = {"response": "2+2 is 4", "status": "success", "model": "nova-lite"}

        mock_requests_resp = MagicMock()
        mock_requests_resp.status_code = 200
        mock_requests_resp.json.return_value = agent_response

        with patch.dict(os.environ, {"AGENT_CONTAINER_URL": "http://localhost:8080"}):
            with patch("requests.post", return_value=mock_requests_resp) as mock_post:
                handler.do_POST()

        status, body = responses[0]
        self.assertEqual(status, 200)
        self.assertEqual(body["response"]["response"], "2+2 is 4")

        # Verify the POST to /invocations carried the right tenant_id
        call_kwargs = mock_post.call_args
        payload_sent = call_kwargs[1]["json"]
        self.assertTrue(payload_sent["tenant_id"].startswith("wa__8613800138000__"))
        self.assertEqual(payload_sent["message"], "What is 2+2?")

    def test_telegram_message_routed_correctly(self):
        handler, responses = _make_handler("POST", "/route", {
            "channel": "telegram",
            "user_id": "987654321",
            "message": "Hello agent",
        })

        mock_requests_resp = MagicMock()
        mock_requests_resp.status_code = 200
        mock_requests_resp.json.return_value = {"response": "Hello user", "status": "success"}

        with patch.dict(os.environ, {"AGENT_CONTAINER_URL": "http://localhost:8080"}):
            with patch("requests.post", return_value=mock_requests_resp):
                handler.do_POST()

        status, body = responses[0]
        self.assertEqual(status, 200)
        self.assertTrue(body["tenant_id"].startswith("tg__987654321__"))


# ---------------------------------------------------------------------------
# 7. EKS routing — _get_eks_endpoint + 3-tier routing chain
# ---------------------------------------------------------------------------

class TestGetEksEndpoint(unittest.TestCase):

    def setUp(self):
        # Clear EKS cache between tests
        tenant_router._eks_cache.clear()
        tenant_router._eks_cache_ts.clear()

    def test_eks_endpoint_found(self):
        mock_ssm = MagicMock()
        mock_ssm.get_parameter.return_value = {
            "Parameter": {"Value": "http://agt-carol.openclaw.svc:18789"}
        }
        with patch("boto3.client", return_value=mock_ssm):
            result = tenant_router._get_eks_endpoint("emp-carol", "whatsapp")
        self.assertEqual(result, "http://agt-carol.openclaw.svc:18789")

    def test_eks_endpoint_not_found(self):
        mock_ssm = MagicMock()
        mock_ssm.get_parameter.side_effect = Exception("ParameterNotFound")
        with patch("boto3.client", return_value=mock_ssm):
            result = tenant_router._get_eks_endpoint("emp-unknown", "telegram")
        self.assertEqual(result, "")

    def test_eks_endpoint_cached(self):
        mock_ssm = MagicMock()
        mock_ssm.get_parameter.return_value = {
            "Parameter": {"Value": "http://agt-1.openclaw.svc:18789"}
        }
        with patch("boto3.client", return_value=mock_ssm):
            r1 = tenant_router._get_eks_endpoint("emp-1", "wa")
            r2 = tenant_router._get_eks_endpoint("emp-1", "wa")
        self.assertEqual(r1, r2)
        # SSM should only be called once due to caching
        mock_ssm.get_parameter.assert_called_once()

    def test_eks_endpoint_ssm_path(self):
        """Verify the correct SSM parameter path is queried."""
        mock_ssm = MagicMock()
        mock_ssm.get_parameter.side_effect = Exception("not found")
        with patch("boto3.client", return_value=mock_ssm):
            with patch.object(tenant_router, "STACK_NAME", "my-stack"):
                tenant_router._get_eks_endpoint("emp-carol", "dc")
        call_kwargs = mock_ssm.get_parameter.call_args[1]
        self.assertEqual(call_kwargs["Name"], "/openclaw/my-stack/tenants/emp-carol/eks-endpoint")


class TestThreeTierRouting(unittest.TestCase):
    """Test the 3-tier routing chain: ECS always-on → EKS pod → AgentCore."""

    def setUp(self):
        tenant_router._always_on_cache.clear()
        tenant_router._always_on_cache_ts.clear()
        tenant_router._eks_cache.clear()
        tenant_router._eks_cache_ts.clear()

    def test_always_on_takes_priority_over_eks(self):
        """If user has both always-on and EKS assignments, always-on wins."""
        handler, responses = _make_handler("POST", "/route", {
            "channel": "whatsapp",
            "user_id": "emp-dual",
            "message": "Hello",
        })

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"response": "from ECS"}

        with patch.object(tenant_router, "_get_always_on_endpoint", return_value="http://localhost:9000"):
            with patch.object(tenant_router, "_get_eks_endpoint", return_value="http://agt.openclaw.svc:18789") as mock_eks:
                with patch("requests.post", return_value=mock_resp):
                    handler.do_POST()

        status, body = responses[0]
        self.assertEqual(status, 200)
        # EKS endpoint should NOT have been checked (short-circuit)
        mock_eks.assert_not_called()

    def test_eks_used_when_no_always_on(self):
        """If no always-on but EKS endpoint exists, route to EKS pod."""
        handler, responses = _make_handler("POST", "/route", {
            "channel": "telegram",
            "user_id": "emp-eks",
            "message": "Hello from EKS",
        })

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {"response": "from K8s pod"}

        with patch.object(tenant_router, "_get_always_on_endpoint", return_value=""):
            with patch.object(tenant_router, "_get_eks_endpoint", return_value="http://agt-eks.openclaw.svc:18789"):
                with patch("requests.post", return_value=mock_resp) as mock_post:
                    handler.do_POST()

        status, body = responses[0]
        self.assertEqual(status, 200)
        self.assertEqual(body["response"]["response"], "from K8s pod")
        # Verify the call went to the EKS endpoint
        call_url = mock_post.call_args[0][0]
        self.assertIn("agt-eks.openclaw.svc:18789", call_url)

    def test_agentcore_fallback_when_no_eks_no_always_on(self):
        """If neither always-on nor EKS, fall through to AgentCore."""
        handler, responses = _make_handler("POST", "/route", {
            "channel": "discord",
            "user_id": "emp-serverless",
            "message": "Hello serverless",
        })

        with patch.object(tenant_router, "_get_always_on_endpoint", return_value=""):
            with patch.object(tenant_router, "_get_eks_endpoint", return_value=""):
                with patch.object(tenant_router, "invoke_agent_runtime",
                                  return_value={"response": "from AgentCore"}) as mock_ac:
                    handler.do_POST()

        status, body = responses[0]
        self.assertEqual(status, 200)
        self.assertEqual(body["response"]["response"], "from AgentCore")
        mock_ac.assert_called_once()

    def test_eks_failure_returns_502(self):
        """If EKS pod is unreachable, return 502."""
        handler, responses = _make_handler("POST", "/route", {
            "channel": "whatsapp",
            "user_id": "emp-eks-fail",
            "message": "Hello",
        })

        import requests as _req
        with patch.object(tenant_router, "_get_always_on_endpoint", return_value=""):
            with patch.object(tenant_router, "_get_eks_endpoint",
                              return_value="http://agt-dead.openclaw.svc:18789"):
                with patch("requests.post",
                           side_effect=_req.exceptions.ConnectionError("connection refused")):
                    handler.do_POST()

        status, body = responses[0]
        self.assertEqual(status, 502)
        self.assertIn("not reachable", body["error"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
