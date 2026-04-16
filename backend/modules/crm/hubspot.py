# ==============================================================
# modules/crm/hubspot.py
# SETUP: Get API key from app.hubspot.com → Settings → Integrations → API Key
# ==============================================================

import os
import requests
from datetime import datetime, timedelta, timezone

HUBSPOT_API_KEY = os.getenv("HUBSPOT_API_KEY")

def fetch_crm() -> dict:
    headers = {"Authorization": f"Bearer {HUBSPOT_API_KEY}"}
    since   = int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp() * 1000)
    result  = {}

    # --- Deals ---
    try:
        resp = requests.post(
            "https://api.hubapi.com/crm/v3/objects/deals/search",
            headers=headers,
            json={
                "filterGroups": [{"filters": [
                    {"propertyName": "hs_lastmodifieddate", "operator": "GTE", "value": str(since)}
                ]}],
                "properties": ["dealname", "dealstage", "amount", "closedate"],
                "limit": 20,
            }
        )
        resp.raise_for_status()
        deals = resp.json().get("results", [])
        result["deals"] = [
            {"name":  d["properties"].get("dealname"),
             "stage": d["properties"].get("dealstage"),
             "amount": d["properties"].get("amount"),
             "close_date": d["properties"].get("closedate")}
            for d in deals
        ]
        print(f"  HubSpot Deals: {len(result['deals'])}")
    except Exception as e:
        print(f"[HubSpot] Deals failed: {e}")
        result["deals"] = []

    # --- Contacts ---
    try:
        resp = requests.post(
            "https://api.hubapi.com/crm/v3/objects/contacts/search",
            headers=headers,
            json={
                "filterGroups": [{"filters": [
                    {"propertyName": "lastmodifieddate", "operator": "GTE", "value": str(since)}
                ]}],
                "properties": ["firstname", "lastname", "email", "hs_lead_status"],
                "limit": 20,
            }
        )
        resp.raise_for_status()
        contacts = resp.json().get("results", [])
        result["contacts"] = [
            {"name":  f"{c['properties'].get('firstname','')} {c['properties'].get('lastname','')}".strip(),
             "email": c["properties"].get("email"),
             "status": c["properties"].get("hs_lead_status")}
            for c in contacts
        ]
        print(f"  HubSpot Contacts: {len(result['contacts'])}")
    except Exception as e:
        print(f"[HubSpot] Contacts failed: {e}")
        result["contacts"] = []

    return result