# backend/db.py
# SQLite user store — persists tokens and settings per user

import sqlite3
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), "weekly_brain.db")

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            data  TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()

def save_user(email: str, data: dict):
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO users (email, data) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET data=excluded.data",
        (email, json.dumps(data))
    )
    conn.commit()
    conn.close()

def get_user(email: str) -> dict | None:
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute("SELECT data FROM users WHERE email=?", (email,)).fetchone()
    conn.close()
    return json.loads(row[0]) if row else None

def update_user(email: str, updates: dict):
    user = get_user(email) or {"email": email}
    user.update(updates)
    save_user(email, user)