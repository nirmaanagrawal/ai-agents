# 🧠 Weekly Brain

An autonomous startup intelligence agent that pulls data from Gmail, Google Calendar, and your CRM — then generates a sharp weekly report and emails it to you.

---

## What it does

Every week, Weekly Brain:
1. Fetches your important emails from Gmail
2. Pulls your calendar events from the past 7 days
3. Grabs deals, contacts, and tasks from your CRM
4. Sends everything to an LLM (OpenAI or Claude) to generate a structured report
5. Emails the report to your inbox

---

## Supported integrations

| Category | Options |
|---|---|
| LLM | OpenAI (gpt-4.1), Claude (Anthropic) |
| Calendar | Google Calendar, Outlook |
| CRM | Zoho, HubSpot, Salesforce, Pipedrive, None |
| Email delivery | Gmail, Outlook, SMTP |

---

## Report format

Every report includes:
1. Top 3 Wins
2. Top 3 Risks
3. Pipeline Snapshot
4. Priority Actions (next 7 days)
5. Cashflow Snapshot
6. One-line Summary

---

## Project structure

```
weekly-brain-app/
├── backend/
│   ├── main.py              ← FastAPI app
│   ├── runner.py            ← Agent orchestrator
│   ├── requirements.txt
│   └── modules/
│       ├── calendar/
│       │   ├── google_cal.py
│       │   └── outlook_cal.py
│       ├── crm/
│       │   ├── zoho.py
│       │   ├── hubspot.py
│       │   ├── salesforce.py
│       │   └── pipedrive.py
│       ├── llm/
│       │   ├── openai_llm.py
│       │   └── claude_llm.py
│       └── email/
│           ├── gmail_email.py
│           ├── outlook_email.py
│           └── smtp_email.py
├── frontend/
│   └── index.html           ← Web UI
└── README.md
```

---

## Running locally

### 1. Install dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Create your `.env` file

Copy `.env.template` to `.env` and fill in the keys you need based on your stack.

```bash
cp .env.template .env
```

### 3. Run the backend

```bash
uvicorn main:app --reload
```

### 4. Open the frontend

Open `frontend/index.html` in your browser. Set `BACKEND = "http://localhost:8000"` in the script block.

---

## Deploying to production

### Backend → Railway

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select the `/backend` folder as root
4. Set start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Generate a domain under Settings → Domains

### Frontend → Netlify

1. Go to [netlify.com](https://netlify.com)
2. Drag and drop the `/frontend` folder
3. Update `const BACKEND = "https://your-backend.up.railway.app"` in `index.html`

---

## Setting up integrations

### Google (Gmail + Calendar)
1. Enable Gmail and Calendar APIs at [console.cloud.google.com](https://console.cloud.google.com)
2. Create an OAuth 2.0 client (Desktop App)
3. Download `credentials.json`
4. Paste the file contents into the UI under API Keys → Google

### Zoho CRM
1. Go to [api-console.zoho.in](https://api-console.zoho.in) → Self Client
2. Generate a code with scopes:
   ```
   ZohoCRM.modules.deals.READ,ZohoCRM.modules.contacts.READ,ZohoCRM.modules.Tasks.READ
   ```
3. Exchange the code for a refresh token:
   ```
   curl -X POST "https://accounts.zoho.in/oauth/v2/token" -d "grant_type=authorization_code&client_id=YOUR_ID&client_secret=YOUR_SECRET&code=YOUR_CODE&redirect_uri=http://localhost"
   ```
4. Copy `refresh_token` into the UI

### HubSpot
1. Go to app.hubspot.com → Settings → Integrations → API Key
2. Copy the key into the UI

### Salesforce
1. Install: `pip install simple-salesforce`
2. Get your security token: Salesforce → Settings → Reset My Security Token
3. Fill in username, password, and security token in the UI

### OpenAI
1. Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
2. Create a new key and paste it into the UI

### Anthropic (Claude)
1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key and paste it into the UI

---

## Scheduling (run automatically every Monday)

### Mac / Linux
```bash
crontab -e
# Add:
0 8 * * 1 cd /path/to/backend && python -c "from runner import run_agent; ..."
```

### Windows
Use Task Scheduler → point to `python weekly_brain.py` in your backend folder.

### Railway (recommended for deployed version)
Use Railway's built-in cron jobs under your project settings:
```
0 8 * * 1
```

---

## Adding a new CRM

1. Create `backend/modules/crm/yourcrm.py`
2. Implement a single function: `def fetch_crm() -> dict`
3. Return a dict with keys: `deals`, `contacts`, `tasks`
4. Add it to the `get_crm_module()` function in `runner.py`
5. Add the option to the CRM dropdown in `frontend/index.html`

---

## License

MIT