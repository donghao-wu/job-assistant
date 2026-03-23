import sqlite3
import json

DB_PATH = "profile.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS profile (
            id INTEGER PRIMARY KEY,
            data TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    conn.close()


def save_profile(data: dict):
    conn = get_conn()
    existing = conn.execute("SELECT id FROM profile LIMIT 1").fetchone()
    if existing:
        conn.execute(
            "UPDATE profile SET data=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
            (json.dumps(data, ensure_ascii=False), existing["id"])
        )
    else:
        conn.execute(
            "INSERT INTO profile (data) VALUES (?)",
            (json.dumps(data, ensure_ascii=False),)
        )
    conn.commit()
    conn.close()


def load_profile() -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT data FROM profile LIMIT 1").fetchone()
    conn.close()
    return json.loads(row["data"]) if row else None
