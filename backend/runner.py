# backend/runner.py
# Bridges the FastAPI layer with the agent modules

import os
import base64
import json
import asyncio
from dotenv import dotenv_values

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")


# ==============================
# SAVE CONFIG TO .ENV
# ==============================

def save_config(config: dict, keys: dict):
    existing = dotenv_values(ENV_PATH) if os.path.exists(ENV_PATH) else {}

    updates = {
        "LLM":            config.get("llm", ""),
        "CALENDAR":       config.get("calendar", ""),
        "CRM":            config.get("crm", ""),
        "EMAIL_DELIVERY": config.get("email_delivery", ""),
    }

    key_map = {
        "openai_api_key":           "OPENAI_API_KEY",
        "anthropic_api_key":        "ANTHROPIC_API_KEY",
        "zoho_client_id":           "ZOHO_CLIENT_ID",
        "zoho_client_secret":       "ZOHO_CLIENT_SECRET",
        "zoho_refresh_token":       "ZOHO_REFRESH_TOKEN",
        "zoho_region":              "ZOHO_REGION",
        "hubspot_api_key":          "HUBSPOT_API_KEY",
        "salesforce_username":      "SALESFORCE_USERNAME",
        "salesforce_password":      "SALESFORCE_PASSWORD",
        "salesforce_security_token":"SALESFORCE_SECURITY_TOKEN",
        "outlook_client_id":        "OUTLOOK_CLIENT_ID",
        "outlook_client_secret":    "OUTLOOK_CLIENT_SECRET",
        "outlook_tenant_id":        "OUTLOOK_TENANT_ID",
        "founder_email":            "FOUNDER_EMAIL",
        "sender_email":             "SENDER_EMAIL",
        "smtp_host":                "SMTP_HOST",
        "smtp_port":                "SMTP_PORT",
        "smtp_username":            "SMTP_USERNAME",
        "smtp_password":            "SMTP_PASSWORD",
    }

    for py_key, env_key in key_map.items():
        val = keys.get(py_key)
        if val:
            updates[env_key] = val

    # Write Google credentials.json if provided
    if keys.get("google_credentials_json"):
        creds_path = os.path.join(os.path.dirname(__file__), "credentials.json")
        decoded = base64.b64decode(keys["google_credentials_json"])
        with open(creds_path, "wb") as f:
            f.write(decoded)
        updates["GOOGLE_CREDENTIALS_FILE"] = "credentials.json"
        updates["GOOGLE_TOKEN_FILE"]        = "token.json"

    merged = {**existing, **updates}
    with open(ENV_PATH, "w") as f:
        for k, v in merged.items():
            f.write(f"{k}={v}\n")

    # Reload into os.environ immediately
    for k, v in merged.items():
        os.environ[k] = v


# ==============================
# INJECT KEYS INTO ENV
# ==============================

def inject_keys(config: dict, keys: dict):
    """Set env vars for this request without writing to disk"""
    os.environ["LLM"]            = config.get("llm", "")
    os.environ["CALENDAR"]       = config.get("calendar", "")
    os.environ["CRM"]            = config.get("crm", "")
    os.environ["EMAIL_DELIVERY"] = config.get("email_delivery", "")

    key_map = {
        "openai_api_key":           "OPENAI_API_KEY",
        "anthropic_api_key":        "ANTHROPIC_API_KEY",
        "zoho_client_id":           "ZOHO_CLIENT_ID",
        "zoho_client_secret":       "ZOHO_CLIENT_SECRET",
        "zoho_refresh_token":       "ZOHO_REFRESH_TOKEN",
        "zoho_region":              "ZOHO_REGION",
        "hubspot_api_key":          "HUBSPOT_API_KEY",
        "founder_email":            "FOUNDER_EMAIL",
        "sender_email":             "SENDER_EMAIL",
        "outlook_client_id":        "OUTLOOK_CLIENT_ID",
        "outlook_client_secret":    "OUTLOOK_CLIENT_SECRET",
        "outlook_tenant_id":        "OUTLOOK_TENANT_ID",
        "smtp_host":                "SMTP_HOST",
        "smtp_port":                "SMTP_PORT",
        "smtp_username":            "SMTP_USERNAME",
        "smtp_password":            "SMTP_PASSWORD",
    }
    for py_key, env_key in key_map.items():
        val = keys.get(py_key)
        if val:
            os.environ[env_key] = val


# ==============================
# AGENT RUNNER (async generator)
# ==============================

async def run_agent(config: dict, keys: dict):
    inject_keys(config, keys)

    llm      = config["llm"]
    calendar = config["calendar"]
    crm      = config["crm"]

    data = {}
    creds = None

    # --- Google Auth ---
    if calendar == "google":
        yield {"type": "progress", "message": "Authenticating with Google..."}
        await asyncio.sleep(0)
        try:
            from modules.calendar.google_cal import get_google_creds
            creds = get_google_creds()
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
    yield {"type": "progress", "message": f"Fetching {calendar.title()} Calendar..."}
    await asyncio.sleep(0)
    try:
        if calendar == "google":
            from modules.calendar.google_cal import fetch_calendar
            cal_data = fetch_calendar(creds)
        else:
            from modules.calendar.outlook_cal import fetch_calendar
            cal_data = fetch_calendar()
        data["calendar_events"] = cal_data
        yield {"type": "progress", "message": f"Calendar: {len(cal_data)} events"}
    except Exception as e:
        yield {"type": "warning", "message": f"Calendar skipped: {e}"}
        data["calendar_events"] = []

    # --- CRM ---
    if crm != "none":
        yield {"type": "progress", "message": f"Fetching {crm.title()} CRM..."}
        await asyncio.sleep(0)
        try:
            if crm == "zoho":
                from modules.crm.zoho import fetch_crm
            elif crm == "hubspot":
                from modules.crm.hubspot import fetch_crm
            elif crm == "salesforce":
                from modules.crm.salesforce import fetch_crm
            elif crm == "pipedrive":
                from modules.crm.pipedrive import fetch_crm
            crm_data = fetch_crm()
            data["crm"] = crm_data
            yield {"type": "progress", "message": f"CRM: data fetched"}
        except Exception as e:
            yield {"type": "warning", "message": f"CRM skipped: {e}"}
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
    yield {"type": "progress", "message": "Sending report via email..."}
    await asyncio.sleep(0)
    try:
        email_delivery = config["email_delivery"]
        if email_delivery == "gmail":
            from modules.email.gmail_email import send_email
            send_email(report, creds=creds)
        elif email_delivery == "outlook":
            from modules.email.outlook_email import send_email
            send_email(report)
        else:
            from modules.email.smtp_email import send_email
            send_email(report)
        yield {"type": "progress", "message": f"Report emailed to {os.getenv('FOUNDER_EMAIL')} ✅"}
    except Exception as e:
        yield {"type": "warning", "message": f"Email failed: {e}"}

    yield {"type": "done", "report": report}