from __future__ import annotations

import base64
import json
import secrets
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


def require_session(session_id: str | None) -> Session:
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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/auth/login")
def login(return_to: str = Query(...)) -> RedirectResponse:
    destination = safe_return_to(return_to)
    state = secrets.token_urlsafe(32)
    oauth_states[state] = destination
    query = urlencode({"client_id": settings.github_client_id, "state": state})
    return RedirectResponse(f"{settings.github_web_url}/login/oauth/authorize?{query}")


@app.get("/auth/callback")
async def callback(code: str, state: str) -> RedirectResponse:
    return_to = oauth_states.pop(state, None)
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
    user = user_response.json(); session_id = secrets.token_urlsafe(32)
    sessions[session_id] = Session(token=token, login=user["login"], name=user.get("name"), avatar_url=user.get("avatar_url"))
    response = RedirectResponse(return_to)
    response.set_cookie("brandmaster_session", session_id, httponly=True, secure=settings.cookie_secure, samesite="none", max_age=28800, path="/")
    return response


@app.get("/api/session")
def session_info(brandmaster_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    session = sessions.get(brandmaster_session or "")
    if not session:
        return {"authenticated": False, "repository": f"{settings.github_data_owner}/{settings.github_data_repo}"}
    return {"authenticated": True, "user": {"login": session.login, "name": session.name, "avatarUrl": session.avatar_url}, "repository": f"{settings.github_data_owner}/{settings.github_data_repo}"}


@app.post("/api/logout")
def logout(response: Response, brandmaster_session: str | None = Cookie(default=None)) -> dict[str, bool]:
    sessions.pop(brandmaster_session or "", None); response.delete_cookie("brandmaster_session", path="/", samesite="none", secure=settings.cookie_secure)
    return {"ok": True}


@app.get("/api/workspace")
async def get_workspace(brandmaster_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    session = require_session(brandmaster_session); workspace, revision, item = await read_remote(session.token)
    return {"revision": revision, "updatedAt": workspace.get("syncedAt") if workspace else None, "updatedBy": workspace.get("syncedBy") if workspace else None, "workspace": workspace}


@app.put("/api/workspace")
async def put_workspace(payload: WorkspaceWrite, brandmaster_session: str | None = Cookie(default=None)) -> dict[str, Any]:
    session = require_session(brandmaster_session); _, current_revision, _ = await read_remote(session.token)
    if current_revision != payload.baseRevision:
        raise HTTPException(status_code=409, detail="The shared workspace changed since your last pull. Pull the latest version before pushing again.")
    workspace = {**payload.workspace, "syncedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(), "syncedBy": session.login}
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
    return {"revision": revision, "updatedAt": workspace["syncedAt"], "updatedBy": session.login, "workspace": workspace}
