# ==============================================================
# modules/email/outlook_email.py
# SETUP: Uses same Microsoft Graph credentials as outlook_cal.py
# ==============================================================

# import os
# import requests
# from datetime import datetime
# from modules.calendar.outlook_cal import get_outlook_token
#
# def send_email(report: str, creds=None):
#     token   = get_outlook_token()
#     headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
#     payload = {
#         "message": {
#             "subject": f"📊 Weekly Brain Report — {datetime.now().strftime('%b %d, %Y')}",
#             "body": {"contentType": "Text", "content": report},
#             "toRecipients": [{"emailAddress": {"address": os.getenv("FOUNDER_EMAIL")}}],
#         },
#         "saveToSentItems": True
#     }
#     try:
#         resp = requests.post(
#             "https://graph.microsoft.com/v1.0/me/sendMail",
#             headers=headers, json=payload
#         )
#         resp.raise_for_status()
#         print(f"Report emailed to {os.getenv('FOUNDER_EMAIL')} ✅")
#     except Exception as e:
#         print(f"[Outlook Email] Send failed: {e}\n\n--- REPORT FALLBACK ---\n{report}")