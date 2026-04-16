# ==============================================================
# modules/email/gmail_email.py
# ==============================================================

import os
import base64
from datetime import datetime
from email.mime.text import MIMEText
from googleapiclient.discovery import build

def send_email(report: str, creds=None):
    service = build("gmail", "v1", credentials=creds)
    msg = MIMEText(report, "plain")
    msg["to"]      = os.getenv("FOUNDER_EMAIL")
    msg["from"]    = os.getenv("SENDER_EMAIL")
    msg["subject"] = f"📊 Weekly Brain Report — {datetime.now().strftime('%b %d, %Y')}"
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    try:
        service.users().messages().send(userId="me", body={"raw": raw}).execute()
        print(f"Report emailed to {os.getenv('FOUNDER_EMAIL')} ✅")
    except Exception as e:
        print(f"[Gmail] Send failed: {e}\n\n--- REPORT FALLBACK ---\n{report}")
