"""
Knowledge Base — S3-backed Markdown document management.

Endpoints: /api/v1/knowledge/*
"""

from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

import s3ops
from shared import require_role

router = APIRouter(prefix="/api/v1/knowledge", tags=["knowledge"])

# KB prefix → metadata mapping (from DynamoDB for access control, S3 for actual files)
KB_PREFIXES = {
    "kb-policies": {"prefix": "_shared/knowledge/company-policies/", "scope": "global", "scopeName": "All Employees", "accessibleBy": "All employees"},
    "kb-product": {"prefix": "_shared/knowledge/product-docs/", "scope": "global", "scopeName": "All Employees", "accessibleBy": "All employees"},
    "kb-onboarding": {"prefix": "_shared/knowledge/onboarding/", "scope": "global", "scopeName": "All Employees", "accessibleBy": "All employees"},
    "kb-arch": {"prefix": "_shared/knowledge/arch-standards/", "scope": "department", "scopeName": "Engineering", "accessibleBy": "Engineering dept"},
    "kb-runbooks": {"prefix": "_shared/knowledge/runbooks/", "scope": "department", "scopeName": "Engineering", "accessibleBy": "Engineering dept"},
    "kb-cases": {"prefix": "_shared/knowledge/case-studies/", "scope": "department", "scopeName": "Sales", "accessibleBy": "Sales + SA positions"},
    "kb-finance": {"prefix": "_shared/knowledge/financial-reports/", "scope": "department", "scopeName": "Finance", "accessibleBy": "Finance + C-level"},
    "kb-hr": {"prefix": "_shared/knowledge/hr-policies/", "scope": "department", "scopeName": "HR & Admin", "accessibleBy": "HR dept only"},
    "kb-legal": {"prefix": "_shared/knowledge/contract-templates/", "scope": "department", "scopeName": "Legal & Compliance", "accessibleBy": "Legal dept only"},
    "kb-customer": {"prefix": "_shared/knowledge/customer-playbooks/", "scope": "department", "scopeName": "Customer Success", "accessibleBy": "CS + Sales"},
    "kb-org-directory": {"prefix": "_shared/knowledge/org-directory/", "scope": "global", "scopeName": "All Employees", "accessibleBy": "All employees"},
}


@router.get("")
def get_knowledge_bases():
    """List all knowledge bases with real document counts from S3."""
    results = []
    for kb_id, meta in KB_PREFIXES.items():
        files = s3ops.list_files(meta["prefix"])
        md_files = [f for f in files if f["name"].endswith(".md")]
        total_size = sum(f["size"] for f in md_files)
        last_modified = max((f["lastModified"] for f in md_files), default="") if md_files else ""
        name_map = {"kb-hr": "HR Policies", "kb-cases": "Case Studies", "kb-customer": "Customer Playbooks"}
        results.append({
            "id": kb_id,
            "name": name_map.get(kb_id, kb_id.replace("kb-", "").replace("-", " ").title()),
            "scope": meta["scope"],
            "scopeName": meta["scopeName"],
            "docCount": len(md_files),
            "sizeMB": round(total_size / 1024 / 1024, 2) if total_size > 0 else 0,
            "sizeBytes": total_size,
            "status": "indexed" if md_files else "empty",
            "lastUpdated": last_modified,
            "accessibleBy": meta["accessibleBy"],
            "s3Prefix": meta["prefix"],
            "files": [{"name": f["name"], "size": f["size"], "key": f["key"]} for f in md_files],
        })
    return results


# IMPORTANT: /search must be defined BEFORE /{kb_id} to avoid route conflict
@router.get("/search")
def search_knowledge(query: str = "", kb_id: str = ""):
    """Search across knowledge documents by reading file contents from S3."""
    if not query:
        return []
    query_lower = query.lower()
    results = []
    for kid, meta in KB_PREFIXES.items():
        if kb_id and kid != kb_id:
            continue
        files = s3ops.list_files(meta["prefix"])
        for f in files:
            if not f["name"].endswith(".md"):
                continue
            content = s3ops.read_file(f["key"])
            if not content:
                continue
            content_lower = content.lower()
            if query_lower in content_lower:
                count = content_lower.count(query_lower)
                score = min(0.99, 0.7 + count * 0.05)
                idx = content_lower.find(query_lower)
                start = max(0, idx - 80)
                end = min(len(content), idx + len(query) + 120)
                snippet = content[start:end].replace("\n", " ").strip()
                if start > 0:
                    snippet = "..." + snippet
                if end < len(content):
                    snippet += "..."
                results.append({
                    "doc": f["name"],
                    "kb": kid,
                    "kbName": kid.replace("kb-", "").replace("-", " ").title(),
                    "score": round(score, 2),
                    "snippet": snippet,
                    "key": f["key"],
                })
    results.sort(key=lambda x: x["score"], reverse=True)
    return results[:10]


@router.get("/{kb_id}")
def get_knowledge_base(kb_id: str):
    meta = KB_PREFIXES.get(kb_id)
    if not meta:
        raise HTTPException(404, "Knowledge base not found")
    files = s3ops.list_files(meta["prefix"])
    md_files = [f for f in files if f["name"].endswith(".md")]
    return {
        "id": kb_id,
        "name": kb_id.replace("kb-", "").replace("-", " ").title(),
        **meta,
        "docCount": len(md_files),
        "files": [{"name": f["name"], "size": f["size"], "key": f["key"], "lastModified": f["lastModified"]} for f in md_files],
    }


@router.get("/{kb_id}/file")
def get_knowledge_file(kb_id: str, filename: str):
    """Read a specific knowledge document."""
    meta = KB_PREFIXES.get(kb_id)
    if not meta:
        raise HTTPException(404, "Knowledge base not found")
    content = s3ops.read_file(f"{meta['prefix']}{filename}")
    if content is None:
        raise HTTPException(404, f"File not found: {filename}")
    return {"filename": filename, "content": content, "size": len(content)}


class KBUploadRequest(BaseModel):
    kbId: str
    filename: str
    content: str


@router.post("/upload")
def upload_knowledge_doc(body: KBUploadRequest, authorization: str = Header(default="")):
    """Upload a Markdown document to a knowledge base."""
    require_role(authorization, roles=["admin", "manager"])
    meta = KB_PREFIXES.get(body.kbId)
    if not meta:
        raise HTTPException(404, "Knowledge base not found")
    if not body.filename.endswith(".md"):
        body.filename += ".md"
    key = f"{meta['prefix']}{body.filename}"
    success = s3ops.write_file(key, body.content)
    if not success:
        raise HTTPException(500, "Failed to upload")
    return {"key": key, "saved": True, "size": len(body.content)}


@router.delete("/{kb_id}/file")
def delete_knowledge_file(kb_id: str, filename: str, authorization: str = Header(default="")):
    """Delete a knowledge document."""
    require_role(authorization, roles=["admin"])
    meta = KB_PREFIXES.get(kb_id)
    if not meta:
        raise HTTPException(404, "Knowledge base not found")
    key = f"{meta['prefix']}{filename}"
    try:
        s3ops._client().delete_object(Bucket=s3ops.bucket(), Key=key)
        return {"deleted": True, "key": key}
    except Exception as e:
        raise HTTPException(500, str(e))
