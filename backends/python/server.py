# Backend Python — FastAPI
# Recebe markdowns gerados pela extensão e grava em disco.
#
# Instalar:   pip install fastapi uvicorn
# Rodar:      uvicorn server:app --reload --port 8000
# CORS: only Chrome extension origins (chrome-extension://<id>) are allowed.

import os
import re
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ROOT = Path(os.environ.get("RAG_ROOT", "./rag-store")).resolve()
TOKEN = os.environ.get("RAG_TOKEN", "")  # opcional

app = FastAPI(title="RAG Extractor · backend")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",  # Chrome extensions only
    allow_methods=["*"],
    allow_headers=["*"],
)


class IngestPayload(BaseModel):
    filename: str
    frontmatter: str | None = None
    content: str | None = None
    markdown: str  # arquivo completo


def check_auth(authorization: str | None):
    if not TOKEN:
        return
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(status_code=401, detail="invalid token")


def safe_path(filename: str) -> Path:
    # Evita path traversal — só aceita caracteres seguros
    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="invalid filename")
    if not re.match(r"^[\w\-./]+\.md$", filename):
        raise HTTPException(status_code=400, detail="filename must be safe + end with .md")
    p = (ROOT / filename).resolve()
    if not str(p).startswith(str(ROOT)):
        raise HTTPException(status_code=400, detail="path escapes ROOT")
    return p


@app.get("/")
def root():
    return {"ok": True, "service": "rag-extractor", "root": str(ROOT)}


@app.post("/rag/ingest")
def ingest(payload: IngestPayload, authorization: str | None = Header(default=None)):
    check_auth(authorization)
    path = safe_path(payload.filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(payload.markdown, encoding="utf-8")
    return {"ok": True, "path": str(path), "bytes": path.stat().st_size, "savedAt": datetime.utcnow().isoformat()}


@app.get("/rag/list")
def list_docs(authorization: str | None = Header(default=None)):
    check_auth(authorization)
    items = []
    if ROOT.exists():
        for p in ROOT.rglob("*.md"):
            items.append({
                "filename": str(p.relative_to(ROOT)),
                "size": p.stat().st_size,
                "modified": datetime.fromtimestamp(p.stat().st_mtime).isoformat(),
            })
    return {"ok": True, "items": sorted(items, key=lambda x: x["modified"], reverse=True)}


@app.delete("/rag/{filename:path}")
def delete_doc(filename: str, authorization: str | None = Header(default=None)):
    check_auth(authorization)
    path = safe_path(filename)
    if path.exists():
        path.unlink()
        return {"ok": True}
    raise HTTPException(status_code=404, detail="not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
