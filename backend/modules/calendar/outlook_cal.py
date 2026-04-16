import os
import requests
from datetime import datetime, timedelta, timezone

# ----------------------------------------------------------------
# Outlook Calendar via Microsoft Graph API
#
# SETUP:
# 1. Go to portal.azure.com → Azure Active Directory → App registrations
# 2. New registration → note the Application (client) ID and Directory (tenant) ID
# 3. Certificates & secrets → New client secret → copy value
# 4. API permissions → Add → Microsoft Graph → Delegated:
#      Calendars.Read, Mail.Read, Mail.Send
# 5. Fill in .env:
#      OUTLOOK_CLIENT_ID, OUTLOOK_CLIENT_SECRET, OUTLOOK_TENANT_ID
# ----------------------------------------------------------------

CLIENT_ID     = os.getenv("OUTLOOK_CLIENT_ID")
CLIENT_SECRET = os.getenv("OUTLOOK_CLIENT_SECRET")
TENANT_ID     = os.getenv("OUTLOOK_TENANT_ID")

def get_outlook_token() -> str:
    # TODO: For production, implement refresh token flow and cache the token
    resp = requests.post(
        f"https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token",
        data={
            "grant_type":    "client_credentials",
            "client_id":     CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "scope":         "https://graph.microsoft.com/.default",
        }
    )
    resp.raise_for_status()
    return resp.json()["access_token"]

def fetch_calendar(creds=None):
    # creds param unused for Outlook — kept for interface consistency
    try:
        token = get_outlook_token()
    except Exception as e:
        print(f"[Outlook Calendar] Auth failed: {e}")
        return []

    end   = datetime.now(timezone.utc)
    start = end - timedelta(days=7)

    headers = {"Authorization": f"Bearer {token}"}
    params  = {
        "startDateTime": start.isoformat(),
        "endDateTime":   end.isoformat(),
        "$top":          20,
        "$select":       "subject,start,end",
        "$orderby":      "start/dateTime",
    }

    try:
        resp = requests.get(
            "https://graph.microsoft.com/v1.0/me/calendarView",
            headers=headers, params=params
        )
        resp.raise_for_status()
        events = resp.json().get("value", [])
    except Exception as e:
        print(f"[Outlook Calendar] Fetch failed: {e}")
        return []

    return [
        f"{e.get('start', {}).get('dateTime', '')}: {e.get('subject', 'No Title')}"
        for e in events
    ]