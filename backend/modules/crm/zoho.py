import os
import requests
from datetime import datetime, timedelta, timezone

ZOHO_CLIENT_ID     = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN")
ZOHO_REGION        = os.getenv("ZOHO_REGION", "com")

def get_access_token() -> str:
    resp = requests.post(
        f"https://accounts.zoho.{ZOHO_REGION}/oauth/v2/token",
        params={
            "grant_type":    "refresh_token",
            "client_id":     ZOHO_CLIENT_ID,
            "client_secret": ZOHO_CLIENT_SECRET,
            "refresh_token": ZOHO_REFRESH_TOKEN,
        }
    )
    resp.raise_for_status()
    data = resp.json()
    token = data.get("access_token")
    if not token:
        raise RuntimeError(f"Zoho token error: {data}")
    return token

def zoho_get(endpoint, token, params=None):
    url = f"https://www.zohoapis.{ZOHO_REGION}/crm/v3/{endpoint}"
    headers = {"Authorization": f"Zoho-oauthtoken {token}"}
    resp = requests.get(url, headers=headers, params=params or {})
    if resp.status_code == 204:
        return []
    resp.raise_for_status()
    return resp.json().get("data", [])

def fetch_crm() -> dict:
    try:
        token = get_access_token()
    except Exception as e:
        print(f"[Zoho] Auth failed: {e}")
        return {}

    modified_since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S+00:00")
    result = {}

    try:
        deals = zoho_get("Deals", token, params={
            "fields": "Deal_Name,Stage,Amount,Closing_Date,Account_Name,Modified_Time",
            "modified_since": modified_since, "per_page": 20,
        })
        result["deals"] = [
            {"name": d.get("Deal_Name"), "stage": d.get("Stage"),
             "amount": d.get("Amount"), "closing_date": d.get("Closing_Date"),
             "account": (d.get("Account_Name") or {}).get("name")}
            for d in deals
        ]
        print(f"  Zoho Deals: {len(result['deals'])}")
    except Exception as e:
        print(f"[Zoho] Deals failed: {e}")
        result["deals"] = []

    try:
        contacts = zoho_get("Contacts", token, params={
            "fields": "Full_Name,Email,Account_Name,Lead_Source,Modified_Time",
            "modified_since": modified_since, "per_page": 20,
        })
        result["contacts"] = [
            {"name": c.get("Full_Name"), "email": c.get("Email"),
             "account": (c.get("Account_Name") or {}).get("name"),
             "lead_source": c.get("Lead_Source")}
            for c in contacts
        ]
        print(f"  Zoho Contacts: {len(result['contacts'])}")
    except Exception as e:
        print(f"[Zoho] Contacts failed: {e}")
        result["contacts"] = []

    try:
        tasks = zoho_get("Tasks", token, params={
            "fields": "Subject,Status,Due_Date,Modified_Time", "per_page": 20,
        })
        result["tasks"] = [
            {"subject": t.get("Subject"), "status": t.get("Status"), "due_date": t.get("Due_Date")}
            for t in tasks
        ]
        print(f"  Zoho Tasks: {len(result['tasks'])}")
    except Exception as e:
        print(f"[Zoho] Tasks skipped (add ZohoCRM.modules.Tasks.READ scope): {e}")
        result["tasks"] = []

    return result