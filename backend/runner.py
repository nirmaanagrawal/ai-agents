# backend/runner.py

import os
import json
import asyncio
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleRequest

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
]

def build_google_creds(token_data: dict) -> Credentials:
    creds = Credentials(
        token=token_data.get("access_token"),
        refresh_token=token_data.get("refresh_token"),
        token_uri="https://oauth2.googleapis.com/token",
        client_id=os.getenv("GOOGLE_CLIENT_ID"),
        client_secret=os.getenv("GOOGLE_CLIENT_SECRET"),
        scopes=SCOPES,
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(GoogleRequest())
    return creds

def get_zoho_access_token(zoho_tokens: dict) -> str:
    import requests
    region = os.getenv("ZOHO_REGION", "in")
    resp = requests.post(
        f"https://accounts.zoho.{region}/oauth/v2/token",
        params={
            "grant_type":    "refresh_token",
            "client_id":     os.getenv("ZOHO_CLIENT_ID"),
            "client_secret": os.getenv("ZOHO_CLIENT_SECRET"),
            "refresh_token": zoho_tokens.get("refresh_token"),
        }
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"Zoho token refresh failed: {data}")
    return token


async def run_agent(user: dict):
    llm           = user.get("llm", "openai")
    crm           = user.get("crm", "zoho")
    founder_email = user.get("founder_email", "")
    openai_key    = user.get("openai_api_key", "")
    anthropic_key = user.get("anthropic_api_key", "")

    # Inject keys into env for modules
    if openai_key:    os.environ["OPENAI_API_KEY"]    = openai_key
    if anthropic_key: os.environ["ANTHROPIC_API_KEY"] = anthropic_key
    os.environ["FOUNDER_EMAIL"] = founder_email
    os.environ["SENDER_EMAIL"]  = user.get("email", "")

    data = {}

    # --- Google Auth ---
    yield {"type": "progress", "message": "Authenticating with Google..."}
    await asyncio.sleep(0)
    try:
        google_tokens = json.loads(user.get("google_tokens", "{}"))
        creds = build_google_creds(google_tokens)
    except Exception as e:
        yield {"type": "error", "message": f"Google auth failed: {e}"}
        return

    # --- Gmail ---
    yield {"type": "progress", "message": "Fetching Gmail..."}
    await asyncio.sleep(0)
    try:
        from modules.calendar.google_cal import fetch_gmail
        gmail_data = fetch_gmail(creds)
        data["gmail_snippets"] = gmail_data
        yield {"type": "progress", "message": f"Gmail: {len(gmail_data)} messages"}
    except Exception as e:
        yield {"type": "warning", "message": f"Gmail skipped: {e}"}
        data["gmail_snippets"] = []

    # --- Calendar ---
    yield {"type": "progress", "message": "Fetching Google Calendar..."}
    await asyncio.sleep(0)
    try:
        from modules.calendar.google_cal import fetch_calendar
        cal_data = fetch_calendar(creds)
        data["calendar_events"] = cal_data
        yield {"type": "progress", "message": f"Calendar: {len(cal_data)} events"}
    except Exception as e:
        yield {"type": "warning", "message": f"Calendar skipped: {e}"}
        data["calendar_events"] = []

    # --- CRM ---
    if crm == "zoho":
        yield {"type": "progress", "message": "Fetching Zoho CRM..."}
        await asyncio.sleep(0)
        try:
            zoho_tokens = json.loads(user.get("zoho_tokens", "{}"))
            access_token = get_zoho_access_token(zoho_tokens)
            os.environ["ZOHO_ACCESS_TOKEN"] = access_token
            from modules.crm.zoho import fetch_crm
            crm_data = fetch_crm()
            data["crm"] = crm_data
            yield {"type": "progress", "message": "Zoho CRM: data fetched"}
        except Exception as e:
            yield {"type": "warning", "message": f"Zoho skipped: {e}"}
            data["crm"] = {}
    elif crm == "hubspot":
        yield {"type": "progress", "message": "Fetching HubSpot CRM..."}
        await asyncio.sleep(0)
        try:
            from modules.crm.hubspot import fetch_crm
            data["crm"] = fetch_crm()
            yield {"type": "progress", "message": "HubSpot CRM: data fetched"}
        except Exception as e:
            yield {"type": "warning", "message": f"HubSpot skipped: {e}"}
            data["crm"] = {}

    # --- Generate Report ---
    yield {"type": "progress", "message": f"Generating report with {llm.title()}..."}
    await asyncio.sleep(0)
    try:
        if llm == "openai":
            from modules.llm.openai_llm import generate_report
        else:
            from modules.llm.claude_llm import generate_report
        report = generate_report(data)
    except Exception as e:
        yield {"type": "error", "message": f"Report generation failed: {e}"}
        return

    # --- Send Email ---
    yield {"type": "progress", "message": "Sending report via Gmail..."}
    await asyncio.sleep(0)
    try:
        from modules.email.gmail_email import send_email
        send_email(report, creds=creds)
        yield {"type": "progress", "message": f"Report emailed to {founder_email} ✅"}
    except Exception as e:
        yield {"type": "warning", "message": f"Email failed: {e}"}

    yield {"type": "done", "report": report}