import sqlite3
import json

DB_PATH = "profile.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    # 新的多档案表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # 迁移旧数据
    try:
        old = conn.execute("SELECT data FROM profile LIMIT 1").fetchone()
        if old:
            count = conn.execute("SELECT COUNT(*) as c FROM profiles").fetchone()["c"]
            if count == 0:
                conn.execute(
                    "INSERT INTO profiles (name, data) VALUES (?, ?)",
                    ("我的简历", old["data"])
                )
    except Exception:
        pass
    conn.commit()
    conn.close()


def list_profiles():
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, name, created_at FROM profiles ORDER BY created_at DESC"
    ).fetchall()
    conn.close()
    return [{"id": r["id"], "name": r["name"], "created_at": r["created_at"]} for r in rows]


def create_profile(name: str, data: dict) -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO profiles (name, data) VALUES (?, ?)",
        (name, json.dumps(data, ensure_ascii=False))
    )
    profile_id = cur.lastrowid
    conn.commit()
    conn.close()
    return profile_id


def get_profile(profile_id: int) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT data FROM profiles WHERE id=?", (profile_id,)).fetchone()
    conn.close()
    return json.loads(row["data"]) if row else None


def update_profile_data(profile_id: int, data: dict):
    conn = get_conn()
    conn.execute(
        "UPDATE profiles SET data=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (json.dumps(data, ensure_ascii=False), profile_id)
    )
    conn.commit()
    conn.close()


def delete_profile_by_id(profile_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM profiles WHERE id=?", (profile_id,))
    conn.commit()
    conn.close()
