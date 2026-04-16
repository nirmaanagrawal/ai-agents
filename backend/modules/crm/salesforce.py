# ==============================================================
# modules/crm/salesforce.py
# SETUP: pip install simple-salesforce
#        Get security token: Salesforce → Settings → Reset My Security Token
# ==============================================================

# import os
# from simple_salesforce import Salesforce
# from datetime import datetime, timedelta, timezone
#
# def fetch_crm() -> dict:
#     sf = Salesforce(
#         username=os.getenv("SALESFORCE_USERNAME"),
#         password=os.getenv("SALESFORCE_PASSWORD"),
#         security_token=os.getenv("SALESFORCE_SECURITY_TOKEN"),
#         domain=os.getenv("SALESFORCE_DOMAIN", "login"),
#     )
#     since = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%SZ")
#     result = {}
#
#     try:
#         opps = sf.query(f"""
#             SELECT Name, StageName, Amount, CloseDate, AccountId
#             FROM Opportunity
#             WHERE LastModifiedDate >= {since}
#             LIMIT 20
#         """)
#         result["deals"] = [
#             {"name": o["Name"], "stage": o["StageName"],
#              "amount": o["Amount"], "close_date": o["CloseDate"]}
#             for o in opps["records"]
#         ]
#         print(f"  Salesforce Opps: {len(result['deals'])}")
#     except Exception as e:
#         print(f"[Salesforce] Opps failed: {e}")
#         result["deals"] = []
#
#     return result