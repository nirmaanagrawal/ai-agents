import os
from datetime import datetime, timedelta, timezone
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request

SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/calendar.readonly",
]

def get_google_creds():
    token_file = os.getenv("GOOGLE_TOKEN_FILE", "token.json")
    creds_file = os.getenv("GOOGLE_CREDENTIALS_FILE", "credentials.json")
    creds = None
    if os.path.exists(token_file):
        creds = Credentials.from_authorized_user_file(token_file, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(creds_file, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_file, "w") as f:
            f.write(creds.to_json())
    return creds

def fetch_gmail(creds):
    service = build("gmail", "v1", credentials=creds)
    try:
        results = service.users().messages().list(
            userId="me", q="is:important newer_than:7d", maxResults=20
        ).execute()
    except Exception as e:
        print(f"[Gmail] Fetch failed: {e}")
        return []
    output = []
    for msg in results.get("messages", []):
        try:
            m = service.users().messages().get(userId="me", id=msg["id"]).execute()
            snippet = m.get("snippet", "").strip()
            if snippet:
                output.append(snippet)
        except Exception as e:
            print(f"[Gmail] Skipping message {msg['id']}: {e}")
    return output

def fetch_calendar(creds):
    service = build("calendar", "v3", credentials=creds)
    end   = datetime.now(timezone.utc)
    start = end - timedelta(days=7)
    try:
        events_result = service.events().list(
            calendarId="primary",
            timeMin=start.isoformat(),
            timeMax=end.isoformat(),
            maxResults=20,
            singleEvents=True,
            orderBy="startTime",
        ).execute()
    except Exception as e:
        print(f"[Google Calendar] Fetch failed: {e}")
        return []
    output = []
    for event in events_result.get("items", []):
        summary  = event.get("summary", "No Title")
        start_dt = event.get("start", {}).get("dateTime", event.get("start", {}).get("date", ""))
        output.append(f"{start_dt}: {summary}")
    return output