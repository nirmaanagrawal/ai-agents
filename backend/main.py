# backend/main.py
# FastAPI backend for Weekly Brain UI

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import asyncio
import json
import os

from runner import run_agent, save_config

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==============================
# MODELS
# ==============================

class Config(BaseModel):
    llm: str
    calendar: str
    crm: str
    email_delivery: str

class Keys(BaseModel):
    openai_api_key: str | None = None
    anthropic_api_key: str | None = None
    zoho_client_id: str | None = None
    zoho_client_secret: str | None = None
    zoho_refresh_token: str | None = None
    zoho_region: str | None = "in"
    hubspot_api_key: str | None = None
    salesforce_username: str | None = None
    salesforce_password: str | None = None
    salesforce_security_token: str | None = None
    outlook_client_id: str | None = None
    outlook_client_secret: str | None = None
    outlook_tenant_id: str | None = None
    google_credentials_json: str | None = None   # base64 encoded credentials.json
    founder_email: str
    sender_email: str | None = None
    smtp_host: str | None = None
    smtp_port: str | None = None
    smtp_username: str | None = None
    smtp_password: str | None = None

class RunRequest(BaseModel):
    config: Config
    keys: Keys


# ==============================
# ROUTES
# ==============================

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/save-config")
def save(req: RunRequest):
    """Persist config + keys to server .env"""
    try:
        save_config(req.config.dict(), req.keys.dict())
        return {"status": "saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/run")
def run(req: RunRequest):
    """Run the agent and stream progress + report back"""

    async def event_stream():
        try:
            async for event in run_agent(req.config.dict(), req.keys.dict()):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/load-config")
def load_config():
    """Return saved config (not keys) for pre-filling the UI"""
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(env_path):
        return {}
    cfg = {}
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                cfg[k] = v
    return {
        "llm":            cfg.get("LLM", "openai"),
        "calendar":       cfg.get("CALENDAR", "google"),
        "crm":            cfg.get("CRM", "zoho"),
        "email_delivery": cfg.get("EMAIL_DELIVERY", "gmail"),
        "founder_email":  cfg.get("FOUNDER_EMAIL", ""),
        "zoho_region":    cfg.get("ZOHO_REGION", "in"),
    }