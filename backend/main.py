# backend/main.py

import os
import json
import secrets
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse, HTMLResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import httpx

from db import init_db, save_user, get_user, update_user
from runner import run_agent

load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)

app = FastAPI()
init_db()

FRONTEND_URL      = os.getenv("FRONTEND_URL", "https://precious-mousse-ea37cf.netlify.app")
BACKEND_URL       = os.getenv("BACKEND_URL",  "https://ai-agents-production-aa99.up.railway.app")

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_SCOPES        = " ".join([
    "openid", "email", "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
])

ZOHO_CLIENT_ID     = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_REGION        = os.getenv("ZOHO_REGION", "in")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

# ==============================
# SESSION HELPERS
# ==============================

def get_session_email(request: Request) -> str | None:
    return request.cookies.get("session_email")

def set_session(response: Response, email: str):
    response.set_cookie(
        "session_email", email,
        httponly=True,
        samesite="lax",
        secure=True,
        max_age=60*60*24*30,
        domain=None
    )


# ==============================
# HEALTH
# ==============================

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/debug")
def debug():
    client_id = os.getenv("GOOGLE_CLIENT_ID", "NOT SET")
    return {
        "google_client_id": client_id[:20] + "..." if client_id != "NOT SET" else "NOT SET",
        "google_client_id_length": len(client_id),
        "backend_url": os.getenv("BACKEND_URL", "NOT SET"),
        "frontend_url": os.getenv("FRONTEND_URL", "NOT SET"),
    }


# ==============================
# GOOGLE OAUTH
# ==============================

@app.get("/auth/google")
def google_auth():
    params = {
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  f"{BACKEND_URL}/auth/google/callback",
        "response_type": "code",
        "scope":         GOOGLE_SCOPES,
        "access_type":   "offline",
        "prompt":        "consent",
    }
    url = "https://accounts.google.com/o/oauth2/v2/auth?" + "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(url)


@app.get("/auth/google/callback")
async def google_callback(code: str, request: Request):
    async with httpx.AsyncClient() as client:
        # Exchange code for tokens
        token_resp = await client.post("https://oauth2.googleapis.com/token", data={
            "code":          code,
            "client_id":     GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri":  f"{BACKEND_URL}/auth/google/callback",
            "grant_type":    "authorization_code",
        })
        tokens = token_resp.json()

        # Get user email
        userinfo_resp = await client.get(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {tokens['access_token']}"}
        )
        userinfo = userinfo_resp.json()
        email = userinfo["email"]

    # Save tokens to DB
    user = get_user(email) or {}
    user["google_tokens"] = json.dumps(tokens)
    user["email"]         = email
    user["name"]          = userinfo.get("name", "")
    save_user(email, user)

    # Set session cookie and redirect to frontend
    response = RedirectResponse(f"{FRONTEND_URL}?connected=google")
    set_session(response, email)
    return response


# ==============================
# ZOHO OAUTH
# ==============================

@app.get("/auth/zoho")
def zoho_auth(request: Request):
    email = get_session_email(request)
    if not email:
        raise HTTPException(status_code=401, detail="Not logged in")
    params = {
        "client_id":     ZOHO_CLIENT_ID,
        "redirect_uri":  f"{BACKEND_URL}/auth/zoho/callback",
        "response_type": "code",
        "scope":         "ZohoCRM.modules.deals.READ,ZohoCRM.modules.contacts.READ,ZohoCRM.modules.Tasks.READ",
        "access_type":   "offline",
        "state":         email,
    }
    url = f"https://accounts.zoho.{ZOHO_REGION}/oauth/v2/auth?" + "&".join(f"{k}={v}" for k, v in params.items())
    return RedirectResponse(url)


@app.get("/auth/zoho/callback")
async def zoho_callback(code: str, state: str):
    import urllib.parse
    email = state
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            f"https://accounts.zoho.{ZOHO_REGION}/oauth/v2/token",
            params={
                "code":          code,
                "client_id":     ZOHO_CLIENT_ID,
                "client_secret": ZOHO_CLIENT_SECRET,
                "redirect_uri":  f"{BACKEND_URL}/auth/zoho/callback",
                "grant_type":    "authorization_code",
            }
        )
        tokens = token_resp.json()

    user = get_user(email) or {"email": email}
    user["zoho_tokens"] = json.dumps(tokens)
    save_user(email, user)

    import urllib.parse
    html = f"""
    <html><body><script>
      localStorage.setItem('session_email', '{email}');
      window.location.href = '{FRONTEND_URL}?connected=zoho';
    </script></body></html>
    """
    return HTMLResponse(content=html)


# ==============================
# SAVE SETTINGS (OpenAI key, emails, CRM choice)
# ==============================

class Settings(BaseModel):
    openai_api_key: str | None        = None
    anthropic_api_key: str | None     = None
    llm: str                          = "openai"
    crm: str                          = "zoho"
    founder_email: str
    zoho_region: str                  = "in"
    hubspot_api_key: str | None       = None
    salesforce_username: str | None   = None
    salesforce_password: str | None   = None
    salesforce_security_token: str | None = None
    pipedrive_api_token: str | None   = None
    pipedrive_domain: str | None      = None

@app.post("/settings")
def save_settings(settings: Settings, request: Request):
    email = get_session_email(request)
    if not email:
        raise HTTPException(status_code=401, detail="Not logged in")
    user = get_user(email) or {"email": email}
    user.update(settings.dict())
    save_user(email, user)
    return {"status": "saved"}


# ==============================
# GET STATUS (for UI to check what's connected)
# ==============================

@app.get("/status")
def status(request: Request):
    email = get_session_email(request)
    if not email:
        return {"logged_in": False}
    user = get_user(email)
    if not user:
        return {"logged_in": False}
    return {
        "logged_in":       True,
        "email":           user.get("email"),
        "name":            user.get("name"),
        "google_connected": bool(user.get("google_tokens")),
        "zoho_connected":   bool(user.get("zoho_tokens")),
        "llm":             user.get("llm", "openai"),
        "crm":             user.get("crm", "zoho"),
        "founder_email":   user.get("founder_email", ""),
        "has_openai_key":  bool(user.get("openai_api_key")),
        "has_anthropic_key": bool(user.get("anthropic_api_key")),
    }


# ==============================
# RUN AGENT
# ==============================

@app.post("/run")
def run(request: Request):
    email = get_session_email(request)
    if not email:
        raise HTTPException(status_code=401, detail="Not logged in")
    user = get_user(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    async def event_stream():
        async for event in run_agent(user):
            import json as _json
            yield f"data: {_json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ==============================
# LOGOUT
# ==============================

@app.post("/logout")
def logout(response: Response):
    response.delete_cookie("session_email")
    return {"status": "logged out"}