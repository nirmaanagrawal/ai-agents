# ==============================================================
# modules/crm/pipedrive.py
# SETUP: Get API token from Pipedrive → Settings → Personal preferences → API
# ==============================================================

# import os
# import requests
# from datetime import datetime, timedelta, timezone
#
# PIPEDRIVE_TOKEN  = os.getenv("PIPEDRIVE_API_TOKEN")
# PIPEDRIVE_DOMAIN = os.getenv("PIPEDRIVE_COMPANY_DOMAIN")  # e.g. "yourcompany"
#
# def fetch_crm() -> dict:
#     base    = f"https://{PIPEDRIVE_DOMAIN}.pipedrive.com/api/v1"
#     since   = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
#     params  = {"api_token": PIPEDRIVE_TOKEN, "start": 0, "limit": 20}
#     result  = {}
#
#     try:
#         resp = requests.get(f"{base}/deals", params={**params, "filter_id": None})
#         resp.raise_for_status()
#         deals = resp.json().get("data") or []
#         result["deals"] = [
#             {"name": d.get("title"), "stage": d.get("stage_id"),
#              "value": d.get("value"), "currency": d.get("currency"),
#              "status": d.get("status")}
#             for d in deals
#         ]
#         print(f"  Pipedrive Deals: {len(result['deals'])}")
#     except Exception as e:
#         print(f"[Pipedrive] Deals failed: {e}")
#         result["deals"] = []
#
#     return result