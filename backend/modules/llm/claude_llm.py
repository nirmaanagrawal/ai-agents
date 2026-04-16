# ==============================================================
# modules/llm/claude_llm.py
# ==============================================================

# import os
# import json
# from datetime import datetime
# import anthropic
#
# def generate_report(data: dict) -> str:
#     client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
#
#     message = client.messages.create(
#         model="claude-sonnet-4-6",
#         max_tokens=1024,
#         messages=[{"role": "user", "content": _build_prompt(data)}]
#     )
#     return message.content[0].text

# ==============================================================
# Shared prompt builder (used by both LLMs)
# ==============================================================

def _build_prompt(data: dict) -> str:
    return f"""You are Weekly Brain, an autonomous startup intelligence agent.

Analyze the following data collected from Gmail, Google Calendar, and CRM over the past 7 days.
Generate a sharp, actionable weekly report for the founder.

DATA:
{json.dumps(data, indent=2, default=str)}

OUTPUT FORMAT (plain text, no markdown):

WEEKLY BRAIN REPORT — {datetime.now().strftime("%B %d, %Y")}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. TOP 3 WINS
2. TOP 3 RISKS
3. PIPELINE SNAPSHOT
4. PRIORITY ACTIONS (Next 7 days)
5. CASHFLOW SNAPSHOT
6. ONE-LINE SUMMARY

Style: Concise. Honest. Slightly optimistic. Zero fluff.
"""