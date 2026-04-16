# ==============================================================
# modules/email/smtp_email.py
# Works with any SMTP server: Gmail, Zoho Mail, SendGrid, Mailgun etc.
# SETUP: Fill SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD in .env
# ==============================================================

# import os
# import smtplib
# from datetime import datetime
# from email.mime.text import MIMEText
#
# def send_email(report: str, creds=None):
#     msg = MIMEText(report, "plain")
#     msg["to"]      = os.getenv("FOUNDER_EMAIL")
#     msg["from"]    = os.getenv("SMTP_USERNAME")
#     msg["subject"] = f"📊 Weekly Brain Report — {datetime.now().strftime('%b %d, %Y')}"
#
#     try:
#         with smtplib.SMTP(os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT", 587))) as s:
#             s.starttls()
#             s.login(os.getenv("SMTP_USERNAME"), os.getenv("SMTP_PASSWORD"))
#             s.send_message(msg)
#         print(f"Report emailed to {os.getenv('FOUNDER_EMAIL')} ✅")
#     except Exception as e:
#         print(f"[SMTP] Send failed: {e}\n\n--- REPORT FALLBACK ---\n{report}")