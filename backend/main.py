import os
import json
import urllib.parse
import httpx

from dotenv import load_dotenv
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"), override=True)

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel
from starlette.middleware.base import BaseHTTPMiddleware

from db import init_db, save_user, get_user
from runner import run_agent

# ==============================
# APP SETUP
# ==============================

app = FastAPI()
init_db()

FRONTEND_URL       = os.getenv("FRONTEND_URL")
BACKEND_URL        = os.getenv("BACKEND_URL")
GOOGLE_CLIENT_ID   = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
ZOHO_CLIENT_ID     = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_REGION        = os.getenv("ZOHO_REGION", "in")

GOOGLE_SCOPES = " ".join([
    "openid", "email", "profile",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
])

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


# ==============================
# HEALTH + DEBUG
# ==============================

@app.get("/health")
def health():
    return {"status": "ok", "version": "3"}

@app.get("/debug")
def debug():
    cid = os.getenv("GOOGLE_CLIENT_ID", "NOT SET")
    return {
        "google_client_id":        cid[:20] + "..." if cid != "NOT SET" else "NOT SET",
        "google_client_id_length": len(cid),
        "backend_url":             BACKEND_URL,
        "frontend_url":            FRONTEND_URL,
    }


# ==============================
# GOOGLE OAUTH
# ==============================

@app.get("/auth/google")
def google_auth():
    params = "&".join([
        f"client_id={GOOGLE_CLIENT_ID}",
        f"redirect_uri={BACKEND_URL}/auth/google/callback",
        "response_type=code",
        f"scope={urllib.parse.quote(GOOGLE_SCOPES)}",
        "access_type=offline",
        "prompt=consent",
    ])
    return HTMLResponse(f"""
        <html><body><script>
          window.location.replace('https://accounts.google.com/o/oauth2/v2/auth?{params}');
        </script></body></html>
    """)


@app.get("/auth/google/callback")
async def google_callback(code: str = None, error: str = None):
    if error or not code:
        return HTMLResponse(f"<pre>OAuth error: {error}</pre>")
    try:
        async with httpx.AsyncClient() as client:
            token_resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code":          code,
                    "client_id":     GOOGLE_CLIENT_ID,
                    "client_secret": GOOGLE_CLIENT_SECRET,
                    "redirect_uri":  f"{BACKEND_URL}/auth/google/callback",
                    "grant_type":    "authorization_code",
                }
            )
            tokens = token_resp.json()
            if "error" in tokens:
                return HTMLResponse(f"<pre>Token error: {tokens}</pre>")

            userinfo_resp = await client.get(
                "https://www.googleapis.com/oauth2/v3/userinfo",
                headers={"Authorization": f"Bearer {tokens['access_token']}"}
            )
            userinfo = userinfo_resp.json()

        email = userinfo.get("email")
        if not email:
            return HTMLResponse(f"<pre>No email in userinfo: {userinfo}</pre>")

        user = get_user(email) or {}
        user["google_tokens"] = json.dumps(tokens)
        user["email"]         = email
        user["name"]          = userinfo.get("name", "")
        save_user(email, user)

        encoded = urllib.parse.quote(email)
        return HTMLResponse(f"""
            <html><body><script>
              window.location.replace('{FRONTEND_URL}?connected=google&session={encoded}');
            </script></body></html>
        """)
    except Exception as e:
        return HTMLResponse(f"<pre>Callback exception: {str(e)}</pre>")


# ==============================
# ZOHO OAUTH
# ==============================

@app.get("/auth/zoho")
def zoho_auth(email: str):
    params = "&".join([
        f"client_id={ZOHO_CLIENT_ID}",
        f"redirect_uri={BACKEND_URL}/auth/zoho/callback",
        "response_type=code",
        "scope=ZohoCRM.modules.deals.READ,ZohoCRM.modules.contacts.READ,ZohoCRM.modules.Tasks.READ",
        "access_type=offline",
        f"state={urllib.parse.quote(email)}",
    ])
    return HTMLResponse(f"""
        <html><body><script>
          window.location.replace('https://accounts.zoho.{ZOHO_REGION}/oauth/v2/auth?{params}');
        </script></body></html>
    """)


@app.get("/auth/zoho/callback")
async def zoho_callback(code: str = None, state: str = None, error: str = None):
    if error or not code:
        return HTMLResponse(f"<pre>Zoho OAuth error: {error}</pre>")
    try:
        email = urllib.parse.unquote(state)
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

        encoded = urllib.parse.quote(email)
        return HTMLResponse(f"""
            <html><body><script>
              window.location.replace('{FRONTEND_URL}?connected=zoho&session={encoded}');
            </script></body></html>
        """)
    except Exception as e:
        return HTMLResponse(f"<pre>Zoho callback exception: {str(e)}</pre>")


# ==============================
# STATUS
# ==============================

@app.get("/status")
def status(email: str = None):
    if not email:
        return {"logged_in": False}
    user = get_user(email)
    if not user:
        return {"logged_in": False}
    return {
        "logged_in":         True,
        "email":             user.get("email"),
        "name":              user.get("name"),
        "google_connected":  bool(user.get("google_tokens")),
        "zoho_connected":    bool(user.get("zoho_tokens")),
        "llm":               user.get("llm", "openai"),
        "crm":               user.get("crm", "zoho"),
        "founder_email":     user.get("founder_email", ""),
        "has_openai_key":    bool(user.get("openai_api_key")),
        "has_anthropic_key": bool(user.get("anthropic_api_key")),
    }


# ==============================
# SETTINGS
# ==============================

class Settings(BaseModel):
    openai_api_key:            str | None = None
    anthropic_api_key:         str | None = None
    llm:                       str        = "openai"
    crm:                       str        = "zoho"
    founder_email:             str
    zoho_region:               str        = "in"
    hubspot_api_key:           str | None = None
    salesforce_username:       str | None = None
    salesforce_password:       str | None = None
    salesforce_security_token: str | None = None
    pipedrive_api_token:       str | None = None
    pipedrive_domain:          str | None = None

@app.post("/settings")
def save_settings(settings: Settings, email: str = None):
    if not email:
        raise HTTPException(status_code=401, detail="Not logged in")
    user = get_user(email) or {"email": email}
    user.update(settings.dict())
    save_user(email, user)
    return {"status": "saved"}


# ==============================
# RUN AGENT
# ==============================

@app.post("/run")
def run(email: str = None):
    if not email:
        raise HTTPException(status_code=401, detail="Not logged in")
    user = get_user(email)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    async def event_stream():
        async for event in run_agent(user):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ==============================
# LOGOUT
# ==============================

@app.post("/logout")
def logout(email: str = None):
    return {"status": "logged out"}