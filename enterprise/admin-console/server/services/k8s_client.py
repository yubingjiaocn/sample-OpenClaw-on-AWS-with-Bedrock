"""
Kubernetes client for managing OpenClawInstance CRDs on EKS.

Simplified from openclaw-saas-gcr/platform/api/services/k8s_client.py
for the enterprise admin console. Operates on a single namespace
(OPENCLAW_NAMESPACE env var) instead of per-tenant namespaces.
"""

import asyncio
import os
from typing import Optional

from kubernetes_asyncio import client, config
from kubernetes_asyncio.client import ApiClient


# CRD coordinates
CRD_GROUP = "openclaw.rocks"
CRD_VERSION = "v1alpha1"
CRD_PLURAL = "openclawinstances"
CRD_FULL_NAME = f"{CRD_PLURAL}.{CRD_GROUP}"

# Operator defaults
OPERATOR_CHART = "oci://ghcr.io/openclaw-rocks/charts/openclaw-operator"
OPERATOR_VERSION = os.environ.get("OPERATOR_VERSION", "0.22.2")
OPERATOR_NAMESPACE = os.environ.get("OPERATOR_NAMESPACE", "openclaw-operator-system")
# China ECR mirror for operator image
OPERATOR_ECR_MIRROR = "public.ecr.aws/t6v6o5d5/kube-prometheus"

# Env-based config
OPENCLAW_NAMESPACE = os.environ.get("OPENCLAW_NAMESPACE", "openclaw")
K8S_IN_CLUSTER = os.environ.get("K8S_IN_CLUSTER", "").lower() in ("true", "1", "yes")


class K8sClient:
    """Async Kubernetes client for OpenClawInstance CRD lifecycle."""

    def __init__(self):
        self._initialized = False
        self._api_client: Optional[ApiClient] = None
        self._core_v1: Optional[client.CoreV1Api] = None
        self._apps_v1: Optional[client.AppsV1Api] = None
        self._api_ext: Optional[client.ApiextensionsV1Api] = None
        self._custom_objects: Optional[client.CustomObjectsApi] = None

    async def initialize(self):
        if self._initialized:
            return
        if K8S_IN_CLUSTER:
            config.load_incluster_config()
        else:
            await config.load_kube_config()
        self._api_client = ApiClient()
        self._core_v1 = client.CoreV1Api(self._api_client)
        self._apps_v1 = client.AppsV1Api(self._api_client)
        self._api_ext = client.ApiextensionsV1Api(self._api_client)
        self._custom_objects = client.CustomObjectsApi(self._api_client)
        self._initialized = True

    async def close(self):
        if self._api_client:
            await self._api_client.close()
            self._initialized = False

    # ─── OpenClawInstance CRD ───

    async def create_openclaw_instance(
        self,
        namespace: str,
        agent_name: str,
        employee_id: str,
        position_id: str,
        model: str,
        registry: str = "",
        bedrock_role_arn: str = "",
    ) -> dict:
        """Create an OpenClawInstance CRD for an enterprise agent."""
        await self.initialize()

        stack = os.environ.get("STACK_NAME", "openclaw-multitenancy")
        s3_bucket = os.environ.get("S3_BUCKET", "")
        ddb_table = os.environ.get("DYNAMODB_TABLE", "openclaw-enterprise")
        ddb_region = os.environ.get("DYNAMODB_REGION", "us-east-2")

        raw_config = {
            "agents": {
                "defaults": {
                    "model": {"primary": model},
                },
            },
            "tools": {"exec": {"security": "full", "ask": "off"}},
        }

        body = {
            "apiVersion": f"{CRD_GROUP}/{CRD_VERSION}",
            "kind": "OpenClawInstance",
            "metadata": {
                "name": agent_name,
                "namespace": namespace,
                "labels": {
                    "app.kubernetes.io/managed-by": "admin-console",
                    "openclaw.rocks/employee": employee_id,
                    "openclaw.rocks/position": position_id,
                },
                "annotations": {
                    **({"openclaw.rocks/bedrock-role-arn": bedrock_role_arn} if bedrock_role_arn else {}),
                },
            },
            "spec": {
                **({"image": {
                    "repository": registry,
                    "tag": "latest",
                    "pullPolicy": "Always",
                }} if registry else {}),
                "env": [
                    {"name": "EMPLOYEE_ID", "value": employee_id},
                    {"name": "POSITION_ID", "value": position_id},
                    {"name": "STACK_NAME", "value": stack},
                    {"name": "S3_BUCKET", "value": s3_bucket},
                    {"name": "DYNAMODB_TABLE", "value": ddb_table},
                    {"name": "DYNAMODB_REGION", "value": ddb_region},
                ],
                "config": {
                    "mergeMode": "merge",
                    "raw": raw_config,
                },
                "storage": {"persistence": {"enabled": True, "size": "50Gi"}},
                "resources": {
                    "requests": {"cpu": "500m", "memory": "2Gi"},
                    "limits": {"cpu": "2", "memory": "4Gi"},
                },
            },
        }

        try:
            await self._custom_objects.create_namespaced_custom_object(
                group=CRD_GROUP,
                version=CRD_VERSION,
                namespace=namespace,
                plural=CRD_PLURAL,
                body=body,
            )
            return {"status": "created", "name": agent_name}
        except client.exceptions.ApiException as e:
            if e.status == 409:
                raise ValueError(f"Agent {agent_name} already exists in namespace {namespace}")
            raise

    async def delete_openclaw_instance(self, namespace: str, agent_name: str) -> dict:
        """Delete an OpenClawInstance CRD."""
        await self.initialize()
        try:
            await self._custom_objects.delete_namespaced_custom_object(
                group=CRD_GROUP,
                version=CRD_VERSION,
                namespace=namespace,
                plural=CRD_PLURAL,
                name=agent_name,
            )
            return {"status": "deleted", "name": agent_name}
        except client.exceptions.ApiException as e:
            if e.status == 404:
                return {"status": "not_found", "name": agent_name}
            raise

    async def patch_openclaw_instance(self, namespace: str, agent_name: str, patch: dict) -> dict:
        """Merge-patch an OpenClawInstance CRD (e.g. config update)."""
        await self.initialize()
        try:
            await self._custom_objects.patch_namespaced_custom_object(
                group=CRD_GROUP,
                version=CRD_VERSION,
                namespace=namespace,
                plural=CRD_PLURAL,
                name=agent_name,
                body=patch,
                _content_type="application/merge-patch+json",
            )
            return {"status": "patched", "name": agent_name}
        except client.exceptions.ApiException as e:
            if e.status == 404:
                raise ValueError(f"Agent {agent_name} not found in namespace {namespace}")
            raise

    async def get_openclaw_instance(self, namespace: str, agent_name: str) -> Optional[dict]:
        """Get an OpenClawInstance CRD."""
        await self.initialize()
        try:
            return await self._custom_objects.get_namespaced_custom_object(
                group=CRD_GROUP,
                version=CRD_VERSION,
                namespace=namespace,
                plural=CRD_PLURAL,
                name=agent_name,
            )
        except client.exceptions.ApiException as e:
            if e.status == 404:
                return None
            raise

    async def list_openclaw_instances(self, namespace: str) -> list:
        """List all OpenClawInstance CRDs in a namespace."""
        await self.initialize()
        try:
            result = await self._custom_objects.list_namespaced_custom_object(
                group=CRD_GROUP,
                version=CRD_VERSION,
                namespace=namespace,
                plural=CRD_PLURAL,
            )
            instances = []
            for item in result.get("items", []):
                meta = item.get("metadata", {})
                status = item.get("status", {})
                spec = item.get("spec", {})
                instances.append({
                    "name": meta.get("name", ""),
                    "namespace": meta.get("namespace", ""),
                    "employee": meta.get("labels", {}).get("openclaw.rocks/employee", ""),
                    "position": meta.get("labels", {}).get("openclaw.rocks/position", ""),
                    "phase": status.get("phase", "Unknown"),
                    "ready": status.get("ready", False),
                    "model": spec.get("config", {}).get("raw", {}).get("agents", {}).get("defaults", {}).get("model", {}).get("primary", ""),
                    "created": meta.get("creationTimestamp", ""),
                    "configVersion": meta.get("annotations", {}).get("openclaw.rocks/config-version", ""),
                })
            return instances
        except client.exceptions.ApiException as e:
            if e.status == 404:
                return []
            raise

    # ─── Pod Status ───

    async def get_pod_status(self, namespace: str, agent_name: str) -> dict:
        """Get pod status for an agent by label selector."""
        await self.initialize()
        try:
            pods = await self._core_v1.list_namespaced_pod(
                namespace=namespace,
                label_selector=f"app.kubernetes.io/instance={agent_name},app.kubernetes.io/name=openclaw",
            )
            if not pods.items:
                return {"status": "not_found", "phase": None}

            pod = pods.items[0]
            container_statuses = []
            for cs in pod.status.container_statuses or []:
                container_statuses.append({
                    "name": cs.name,
                    "ready": cs.ready,
                    "restart_count": cs.restart_count,
                    "state": "running" if cs.state.running else "waiting" if cs.state.waiting else "terminated",
                })

            return {
                "status": "found",
                "phase": pod.status.phase,
                "pod_name": pod.metadata.name,
                "node": pod.spec.node_name,
                "start_time": pod.status.start_time.isoformat() if pod.status.start_time else None,
                "containers": container_statuses,
                "conditions": [
                    {"type": c.type, "status": c.status}
                    for c in pod.status.conditions or []
                ],
            }
        except client.exceptions.ApiException as e:
            if e.status == 404:
                return {"status": "not_found", "phase": None}
            raise

    async def get_pod_logs(
        self,
        namespace: str,
        agent_name: str,
        container: str = "openclaw",
        tail_lines: int = 100,
    ) -> dict:
        """Get pod logs for an agent container."""
        await self.initialize()
        try:
            pods = await self._core_v1.list_namespaced_pod(
                namespace=namespace,
                label_selector=f"app.kubernetes.io/instance={agent_name},app.kubernetes.io/name=openclaw",
            )
            if not pods.items:
                return {"error": "Pod not found", "logs": ""}

            pod = pods.items[0]
            containers = [cs.name for cs in (pod.status.container_statuses or [])]

            if container not in containers:
                return {
                    "error": f"Container '{container}' not found",
                    "available_containers": containers,
                    "logs": "",
                }

            logs = await self._core_v1.read_namespaced_pod_log(
                name=pod.metadata.name,
                namespace=namespace,
                container=container,
                tail_lines=tail_lines,
            )
            return {
                "pod_name": pod.metadata.name,
                "container": container,
                "available_containers": containers,
                "tail_lines": tail_lines,
                "logs": logs,
            }
        except client.exceptions.ApiException as e:
            if e.status == 404:
                return {"error": "Pod not found", "logs": ""}
            raise

    # ─── Operator Status & Install ───

    async def check_crd_exists(self) -> bool:
        """Check if the OpenClawInstance CRD is registered in the cluster."""
        await self.initialize()
        try:
            await self._api_ext.read_custom_resource_definition(name=CRD_FULL_NAME)
            return True
        except client.exceptions.ApiException as e:
            if e.status == 404:
                return False
            raise

    async def get_operator_status(self) -> dict:
        """Check if the OpenClaw operator is installed and running.

        Returns:
            dict with keys: installed, crd_exists, namespace, pods, version
        """
        await self.initialize()

        # 1. Check CRD
        crd_exists = await self.check_crd_exists()

        # 2. Check operator pods
        operator_pods = []
        try:
            pods = await self._core_v1.list_namespaced_pod(
                namespace=OPERATOR_NAMESPACE,
                label_selector="app.kubernetes.io/name=openclaw-operator",
            )
            for pod in pods.items or []:
                operator_pods.append({
                    "name": pod.metadata.name,
                    "phase": pod.status.phase,
                    "ready": all(
                        cs.ready for cs in (pod.status.container_statuses or [])
                    ),
                    "restart_count": sum(
                        cs.restart_count for cs in (pod.status.container_statuses or [])
                    ),
                })
        except client.exceptions.ApiException as e:
            if e.status != 404:
                raise

        # 3. Check deployment
        operator_version = ""
        deployment_ready = False
        try:
            dep = await self._apps_v1.read_namespaced_deployment(
                name="openclaw-operator-controller-manager",
                namespace=OPERATOR_NAMESPACE,
            )
            deployment_ready = (
                dep.status.ready_replicas is not None
                and dep.status.ready_replicas >= 1
            )
            # Extract version from image tag
            for c in dep.spec.template.spec.containers or []:
                if "openclaw-operator" in (c.image or ""):
                    tag = (c.image or "").rsplit(":", 1)[-1]
                    operator_version = tag.lstrip("v")
                    break
        except client.exceptions.ApiException as e:
            if e.status != 404:
                raise

        installed = crd_exists and deployment_ready
        return {
            "installed": installed,
            "crd_exists": crd_exists,
            "deployment_ready": deployment_ready,
            "namespace": OPERATOR_NAMESPACE,
            "version": operator_version,
            "pods": operator_pods,
        }

    async def install_operator(
        self,
        version: str = "",
        china_region: bool = False,
    ) -> dict:
        """Install the OpenClaw operator via Helm.

        Args:
            version: Helm chart version (default: OPERATOR_VERSION env var)
            china_region: If True, use ECR mirror image for China regions
        """
        ver = version or OPERATOR_VERSION
        cmd = [
            "helm", "install", "openclaw-operator",
            OPERATOR_CHART,
            "--version", ver,
            "--namespace", OPERATOR_NAMESPACE,
            "--create-namespace",
            "--set", "crds.install=true",
            "--set", "crds.keep=true",
            "--wait",
            "--timeout", "10m",
        ]
        if china_region:
            cmd += [
                "--set", f"image.repository={OPERATOR_ECR_MIRROR}",
                "--set", f"image.tag=openclaw-operator-v{ver}",
            ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            err = stderr.decode().strip()
            # If already installed, treat as success
            if "cannot re-use a name that is still in use" in err:
                return {"status": "already_installed", "version": ver}
            raise RuntimeError(f"helm install failed (exit {proc.returncode}): {err}")

        return {
            "status": "installed",
            "version": ver,
            "namespace": OPERATOR_NAMESPACE,
            "output": stdout.decode().strip()[:500],
        }

    async def upgrade_operator(
        self,
        version: str = "",
        china_region: bool = False,
    ) -> dict:
        """Upgrade the OpenClaw operator via Helm."""
        ver = version or OPERATOR_VERSION
        cmd = [
            "helm", "upgrade", "openclaw-operator",
            OPERATOR_CHART,
            "--version", ver,
            "--namespace", OPERATOR_NAMESPACE,
            "--set", "crds.install=true",
            "--set", "crds.keep=true",
            "--wait",
            "--timeout", "10m",
        ]
        if china_region:
            cmd += [
                "--set", f"image.repository={OPERATOR_ECR_MIRROR}",
                "--set", f"image.tag=openclaw-operator-v{ver}",
            ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()

        if proc.returncode != 0:
            raise RuntimeError(
                f"helm upgrade failed (exit {proc.returncode}): {stderr.decode().strip()}")

        return {
            "status": "upgraded",
            "version": ver,
            "namespace": OPERATOR_NAMESPACE,
            "output": stdout.decode().strip()[:500],
        }


# Global singleton
k8s_client = K8sClient()
