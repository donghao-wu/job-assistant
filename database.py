import sqlite3
import json

DB_PATH = "profile.db"


def get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_conn()
    # 多档案表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            data TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # 投递事件表（面试、备注、状态变更时间线）
    conn.execute("""
        CREATE TABLE IF NOT EXISTS app_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            title TEXT DEFAULT '',
            content TEXT DEFAULT '',
            event_date TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
        )
    """)
    # 投递记录表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company TEXT NOT NULL,
            position TEXT NOT NULL,
            job_url TEXT DEFAULT '',
            applied_date TEXT DEFAULT '',
            status TEXT DEFAULT '已投递',
            source TEXT DEFAULT '',
            location TEXT DEFAULT '',
            salary_range TEXT DEFAULT '',
            notes TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # 面试准备会话表
    conn.execute("""
        CREATE TABLE IF NOT EXISTS interview_sessions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL,
            jd_text    TEXT NOT NULL,
            jd_snippet TEXT NOT NULL,
            questions  TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
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


def rename_profile(profile_id: int, name: str):
    conn = get_conn()
    conn.execute(
        "UPDATE profiles SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        (name, profile_id)
    )
    conn.commit()
    conn.close()


def duplicate_profile(profile_id: int) -> int | None:
    conn = get_conn()
    row = conn.execute("SELECT name, data FROM profiles WHERE id=?", (profile_id,)).fetchone()
    if not row:
        conn.close()
        return None
    cur = conn.execute(
        "INSERT INTO profiles (name, data) VALUES (?, ?)",
        (row["name"] + " (副本)", row["data"])
    )
    new_id = cur.lastrowid
    conn.commit()
    conn.close()
    return new_id


# ─── 投递记录 ─────────────────────────────────────────────

def _row_to_app(r) -> dict:
    return {
        "id": r["id"], "company": r["company"], "position": r["position"],
        "job_url": r["job_url"], "applied_date": r["applied_date"],
        "status": r["status"], "source": r["source"], "location": r["location"],
        "salary_range": r["salary_range"], "notes": r["notes"],
        "created_at": r["created_at"], "updated_at": r["updated_at"],
    }


def list_applications() -> list:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM applications ORDER BY applied_date DESC, created_at DESC"
    ).fetchall()
    conn.close()
    return [_row_to_app(r) for r in rows]


def create_application(data: dict) -> int:
    conn = get_conn()
    cur = conn.execute(
        """INSERT INTO applications
           (company, position, job_url, applied_date, status, source, location, salary_range, notes)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (data.get("company",""), data.get("position",""), data.get("job_url",""),
         data.get("applied_date",""), data.get("status","已投递"), data.get("source",""),
         data.get("location",""), data.get("salary_range",""), data.get("notes",""))
    )
    app_id = cur.lastrowid
    conn.commit()
    conn.close()
    return app_id


def update_application(app_id: int, data: dict):
    conn = get_conn()
    conn.execute(
        """UPDATE applications SET
           company=?, position=?, job_url=?, applied_date=?, status=?,
           source=?, location=?, salary_range=?, notes=?, updated_at=CURRENT_TIMESTAMP
           WHERE id=?""",
        (data.get("company",""), data.get("position",""), data.get("job_url",""),
         data.get("applied_date",""), data.get("status","已投递"), data.get("source",""),
         data.get("location",""), data.get("salary_range",""), data.get("notes",""), app_id)
    )
    conn.commit()
    conn.close()


def delete_application(app_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM applications WHERE id=?", (app_id,))
    conn.commit()
    conn.close()


def list_events(app_id: int) -> list:
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM app_events WHERE app_id=? ORDER BY event_date DESC, created_at DESC",
        (app_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_event(app_id: int, data: dict) -> int:
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO app_events (app_id, event_type, title, content, event_date) VALUES (?,?,?,?,?)",
        (app_id, data.get("event_type","note"), data.get("title",""),
         data.get("content",""), data.get("event_date",""))
    )
    event_id = cur.lastrowid
    conn.commit()
    conn.close()
    return event_id


def delete_event(event_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM app_events WHERE id=?", (event_id,))
    conn.commit()
    conn.close()


# ─── 面试准备 ─────────────────────────────────────────────

def list_interview_sessions(profile_id: int | None = None) -> list:
    conn = get_conn()
    if profile_id:
        rows = conn.execute(
            "SELECT id, profile_id, jd_snippet, created_at FROM interview_sessions WHERE profile_id=? ORDER BY created_at DESC LIMIT 30",
            (profile_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, profile_id, jd_snippet, created_at FROM interview_sessions ORDER BY created_at DESC LIMIT 30"
        ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


def create_interview_session(profile_id: int, jd_text: str, questions: list) -> int:
    conn = get_conn()
    jd_snippet = jd_text[:80].replace('\n', ' ')
    cur = conn.execute(
        "INSERT INTO interview_sessions (profile_id, jd_text, jd_snippet, questions) VALUES (?,?,?,?)",
        (profile_id, jd_text, jd_snippet, json.dumps(questions, ensure_ascii=False))
    )
    sid = cur.lastrowid
    conn.commit()
    conn.close()
    return sid


def get_interview_session(session_id: int) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM interview_sessions WHERE id=?", (session_id,)).fetchone()
    conn.close()
    if not row:
        return None
    d = dict(row)
    d['questions'] = json.loads(d['questions'])
    return d


def delete_interview_session(session_id: int):
    conn = get_conn()
    conn.execute("DELETE FROM interview_sessions WHERE id=?", (session_id,))
    conn.commit()
    conn.close()


def get_application_stats() -> dict:
    conn = get_conn()
    rows = conn.execute("SELECT status, COUNT(*) as cnt FROM applications GROUP BY status").fetchall()
    by_week = conn.execute("""
        SELECT strftime('%Y-W%W', applied_date) as week, COUNT(*) as cnt
        FROM applications WHERE applied_date != ''
        GROUP BY week ORDER BY week DESC LIMIT 12
    """).fetchall()
    conn.close()
    status_counts = {r["status"]: r["cnt"] for r in rows}
    total = sum(status_counts.values())
    in_progress_statuses = {"简历通过", "笔试/测评", "面试中"}
    in_progress = sum(v for k, v in status_counts.items() if k in in_progress_statuses)
    offers = status_counts.get("Offer", 0)
    rejected = status_counts.get("已拒绝", 0)
    return {
        "total": total,
        "in_progress": in_progress,
        "offers": offers,
        "rejected": rejected,
        "by_status": status_counts,
        "by_week": [{"week": r["week"], "count": r["cnt"]} for r in reversed(by_week)],
    }
