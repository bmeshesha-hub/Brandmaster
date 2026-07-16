from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import Cookie, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    github_web_url: str = "https://github.corp.ebay.com"
    github_api_url: str = "https://github.corp.ebay.com/api/v3"
    github_client_id: str
    github_client_secret: str
    github_data_owner: str = "bmeshesha"
    github_data_repo: str = "Brandmaster-data"
    github_data_branch: str = "main"
    github_data_path: str = "brandmaster/workspace.json"
    allowed_origins: str = "https://pages.github.corp.ebay.com,https://bmeshesha-hub.github.io,http://localhost:3000"
    cookie_secure: bool = True
    storage_backend: str = "github"
    nukv_gateway_url: str = ""
    nukv_gateway_secret: str = ""
    session_secret: str = ""

    @property
    def origins(self) -> list[str]:
        return [item.strip().rstrip("/") for item in self.allowed_origins.split(",") if item.strip()]


settings = Settings()  # type: ignore[call-arg]
app = FastAPI(title="Brandmaster Sync", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_credentials=True, allow_methods=["GET", "PUT", "POST"], allow_headers=["Content-Type"])


@dataclass
class Session:
    token: str
    login: str
    name: str | None
    avatar_url: str | None


sessions: dict[str, Session] = {}
oauth_states: dict[str, str] = {}


class WorkspaceWrite(BaseModel):
    baseRevision: str | None = None
    workspace: dict[str, Any]


def safe_return_to(value: str) -> str:
    parsed = urlparse(value)
    origin = f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    if origin not in settings.origins:
        raise HTTPException(status_code=400, detail="Return URL is not an allowed Brandmaster origin")
    return value


def signing_secret() -> bytes:
    value = settings.session_secret or settings.github_client_secret
    if not value:
        raise HTTPException(status_code=503, detail="The Sync API session secret is not configured")
    return value.encode()


def encode_signed(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode()
    encoded = base64.urlsafe_b64encode(raw).decode().rstrip("=")
    signature = hmac.new(signing_secret(), encoded.encode(), hashlib.sha256).digest()
    return f"v1.{encoded}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def decode_signed(value: str | None) -> dict[str, Any] | None:
    try:
        version, encoded, supplied = (value or "").split(".", 2)
        if version != "v1": return None
        expected = hmac.new(signing_secret(), encoded.encode(), hashlib.sha256).digest()
        signature = base64.urlsafe_b64decode(supplied + "=" * (-len(supplied) % 4))
        if not hmac.compare_digest(expected, signature): return None
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        return payload if float(payload.get("exp", 0)) > time.time() else None
    except (ValueError, TypeError, json.JSONDecodeError):
        return None


def require_session(session_id: str | None) -> Session:
    if settings.storage_backend.lower() == "nukv":
        payload = decode_signed(session_id)
        if payload:
            return Session(token="", login=str(payload["login"]), name=payload.get("name"), avatar_url=payload.get("avatarUrl"))
    session = sessions.get(session_id or "")
    if not session:
        raise HTTPException(status_code=401, detail="Sign in with Corporate GitHub to use the shared workspace")
    return session


def api_headers(token: str) -> dict[str, str]:
    return {"Accept": "application/vnd.github+json", "Authorization": f"Bearer {token}", "X-GitHub-Api-Version": "2022-11-28"}


async def read_remote(token: str) -> tuple[dict[str, Any] | None, str | None, dict[str, Any]]:
    url = f"{settings.github_api_url}/repos/{settings.github_data_owner}/{settings.github_data_repo}/contents/{settings.github_data_path}"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.get(url, headers=api_headers(token), params={"ref": settings.github_data_branch})
    if response.status_code == 404:
        return None, None, {}
    if response.status_code in (401, 403):
        raise HTTPException(status_code=403, detail="Your GitHub account does not have access to the private Brandmaster data repository")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"GitHub could not read the shared workspace ({response.status_code})")
    item = response.json()
    try:
        if item.get("content"):
            raw = base64.b64decode(item["content"].replace("\n", "")).decode("utf-8")
        else:
            async with httpx.AsyncClient(timeout=45) as client:
                raw_response = await client.get(url, headers={**api_headers(token), "Accept": "application/vnd.github.raw+json"}, params={"ref": settings.github_data_branch})
            if raw_response.status_code >= 400:
                raise ValueError("raw workspace unavailable")
            raw = raw_response.text
        workspace = json.loads(raw)
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail="The shared workspace file is invalid") from exc
    return workspace, item.get("sha"), item


async def read_nukv() -> tuple[dict[str, Any] | None, str | None, dict[str, Any]]:
    if not settings.nukv_gateway_url or not settings.nukv_gateway_secret:
        raise HTTPException(status_code=503, detail="NuKV workspace storage is not configured")
    url = f"{settings.nukv_gateway_url.rstrip('/')}/brandmaster-sync/v1/workspace"
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(url, headers={"X-Brandmaster-Service-Secret": settings.nukv_gateway_secret})
    if response.status_code == 401:
        raise HTTPException(status_code=502, detail="The Sync API is not authorized to use the NuKV gateway")
    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail="The shared NuKV workspace is temporarily unavailable")
    body = response.json()
    return body.get("workspace"), body.get("revision"), body


async def read_workspace(token: str) -> tuple[dict[str, Any] | None, str | None, dict[str, Any]]:
    if settings.storage_backend.lower() == "nukv":
        return await read_nukv()
    return await read_remote(token)


async def write_nukv(workspace: dict[str, Any], base_revision: str | None, login: str) -> tuple[dict[str, Any], str | None, dict[str, Any]]:
    if not settings.nukv_gateway_url or not settings.nukv_gateway_secret:
        raise HTTPException(status_code=503, detail="NuKV workspace storage is not configured")
    url = f"{settings.nukv_gateway_url.rstrip('/')}/brandmaster-sync/v1/workspace"
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.put(
            url,
            headers={"X-Brandmaster-Service-Secret": settings.nukv_gateway_secret},
            json={"baseRevision": base_revision, "workspace": workspace, "syncedBy": login},
        )
    if response.status_code == 409:
        raise HTTPException(status_code=409, detail="A collaborator updated the workspace first. Pull and merge their changes before saving.")
    if response.status_code == 401:
        raise HTTPException(status_code=502, detail="The Sync API is not authorized to use the NuKV gateway")
    if response.status_code >= 400:
        raise HTTPException(status_code=503, detail="NuKV could not save the shared workspace")
    body = response.json()
    return body.get("workspace") or workspace, body.get("revision"), body


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "storage": settings.storage_backend.lower()}


@app.get("/auth/login")
def login(return_to: str = Query(...)) -> RedirectResponse:
    destination = safe_return_to(return_to)
    if settings.storage_backend.lower() == "nukv":
        state = encode_signed({"returnTo": destination, "exp": time.time() + 600, "nonce": secrets.token_urlsafe(16)})
    else:
        state = secrets.token_urlsafe(32); oauth_states[state] = destination
    query = urlencode({"client_id": settings.github_client_id, "state": state})
    return RedirectResponse(f"{settings.github_web_url}/login/oauth/authorize?{query}")


@app.get("/auth/callback")
async def callback(code: str, state: str) -> RedirectResponse:
    signed_state = decode_signed(state) if settings.storage_backend.lower() == "nukv" else None
    return_to = signed_state.get("returnTo") if signed_state else oauth_states.pop(state, None)
    if not return_to:
        raise HTTPException(status_code=400, detail="The sign-in request expired or is invalid")
    async with httpx.AsyncClient(timeout=30) as client:
        token_response = await client.post(f"{settings.github_web_url}/login/oauth/access_token", headers={"Accept": "application/json"}, data={"client_id": settings.github_client_id, "client_secret": settings.github_client_secret, "code": code, "state": state})
        token = token_response.json().get("access_token") if token_response.status_code < 400 else None
        if not token:
            raise HTTPException(status_code=401, detail="Corporate GitHub sign-in failed")
        user_response = await client.get(f"{settings.github_api_url}/user", headers=api_headers(token))
    if user_response.status_code >= 400:
        raise HTTPException(status_code=401, detail="GitHub identity could not be verified")
    user = user_response.json()
    if settings.storage_backend.lower() == "nukv":
        session_id = encode_signed({"login": user["login"], "name": user.get("name"), "avatarUrl": user.get("avatar_url"), "exp": time.time() + 28800})
    else:
        session_id = secrets.token_urlsafe(32); sessions[session_id] = Session(token=token, login=user["login"], name=user.get("name"), avatar_url=user.get("avatar_url"))
    response = RedirectResponse(return_to)
    response.set_cookie("brandmaster_session", session_id, httponly=True, secure=settings.cookie_secure, samesite="none", max_age=28800, path="/")
    return response


@app.get("/api/session")
def session_info(brandmaster_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    try: session = require_session(brandmaster_session)
    except HTTPException: session = None
    repository = "NuKV team workspace" if settings.storage_backend.lower() == "nukv" else f"{settings.github_data_owner}/{settings.github_data_repo}"
    if not session:
        return {"authenticated": False, "repository": repository}
    return {"authenticated": True, "user": {"login": session.login, "name": session.name, "avatarUrl": session.avatar_url}, "repository": repository}


@app.post("/api/logout")
def logout(response: Response, brandmaster_session: str | None = Cookie(default=None)) -> dict[str, bool]:
    sessions.pop(brandmaster_session or "", None); response.delete_cookie("brandmaster_session", path="/", samesite="none", secure=settings.cookie_secure)
    return {"ok": True}


@app.get("/api/workspace")
async def get_workspace(brandmaster_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    session = require_session(brandmaster_session); workspace, revision, item = await read_workspace(session.token)
    sync = workspace.get("sync", {}) if workspace else {}
    return {"revision": revision, "updatedAt": item.get("updatedAt") or sync.get("lastSyncedAt"), "updatedBy": item.get("updatedBy") or sync.get("lastSyncedBy"), "workspace": workspace}


@app.put("/api/workspace")
async def put_workspace(payload: WorkspaceWrite, brandmaster_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    session = require_session(brandmaster_session); _, current_revision, _ = await read_workspace(session.token)
    if current_revision != payload.baseRevision:
        raise HTTPException(status_code=409, detail="The shared workspace changed since your last pull. Pull the latest version before pushing again.")
    synced_at = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    old_history = payload.workspace.get("sync", {}).get("history", [])
    workspace = {**payload.workspace, "sync": {"lastSyncedAt": synced_at, "lastSyncedBy": session.login, "history": [{"syncedAt": synced_at, "syncedBy": session.login, "changeCount": 1}, *old_history][:25]}}
    if settings.storage_backend.lower() == "nukv":
        saved_workspace, revision, item = await write_nukv(workspace, current_revision, session.login)
        return {"revision": revision, "updatedAt": item.get("updatedAt") or synced_at, "updatedBy": session.login, "workspace": saved_workspace}
    body: dict[str, Any] = {"message": f"Sync Brandmaster workspace ({session.login})", "content": base64.b64encode(json.dumps(workspace, separators=(",", ":")).encode()).decode(), "branch": settings.github_data_branch}
    if current_revision: body["sha"] = current_revision
    url = f"{settings.github_api_url}/repos/{settings.github_data_owner}/{settings.github_data_repo}/contents/{settings.github_data_path}"
    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.put(url, headers=api_headers(session.token), json=body)
    if response.status_code == 409:
        raise HTTPException(status_code=409, detail="A collaborator updated the workspace first. Pull and review their revision before pushing.")
    if response.status_code in (401, 403):
        raise HTTPException(status_code=403, detail="Your GitHub account does not have write access to the private data repository")
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"GitHub could not save the shared workspace ({response.status_code})")
    revision = response.json().get("content", {}).get("sha")
    return {"revision": revision, "updatedAt": synced_at, "updatedBy": session.login, "workspace": workspace}
