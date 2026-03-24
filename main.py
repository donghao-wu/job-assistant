from fastapi import FastAPI, UploadFile, File, Form
from fastapi.responses import HTMLResponse, JSONResponse
from openai import OpenAI
import pdfplumber
import docx
import json
import io
import re
import os
from dotenv import load_dotenv

from database import (
    init_db, list_profiles, create_profile,
    get_profile, update_profile_data, delete_profile_by_id
)

load_dotenv()

app = FastAPI()

API_KEY = os.getenv("SILICONFLOW_API_KEY")
BASE_URL = "https://api.siliconflow.cn/v1"
MODEL = "deepseek-ai/DeepSeek-V3"

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

init_db()


# ─── 工具函数 ────────────────────────────────────────────

def extract_text(file_bytes: bytes, filename: str) -> str:
    if filename.endswith(".pdf"):
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            return "\n".join(page.extract_text() or "" for page in pdf.pages)
    elif filename.endswith(".docx"):
        doc = docx.Document(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs)
    else:
        return file_bytes.decode("utf-8", errors="ignore")


def desc_to_bullets(text: str) -> list:
    if not text:
        return []
    lines = re.split(r'\n|(?<=[.。])\s+(?=[A-Z\u4e00-\u9fa5])', text.strip())
    bullets = [l.strip().lstrip('-•·').strip() for l in lines if len(l.strip()) > 5]
    return bullets if bullets else [text.strip()]


def normalize_profile(data: dict) -> dict:
    for item in data.get("experience", []):
        if "bullets" not in item or not item["bullets"]:
            item["bullets"] = desc_to_bullets(item.pop("description", ""))
        item.setdefault("location", "无")
    for item in data.get("projects", []):
        if "bullets" not in item or not item["bullets"]:
            item["bullets"] = desc_to_bullets(item.pop("description", ""))
        item.setdefault("start", "无")
        item.setdefault("end", "无")
        item.setdefault("location", "无")
    for item in data.get("activities", []):
        if "bullets" not in item or not item["bullets"]:
            item["bullets"] = desc_to_bullets(item.pop("description", ""))
        item.setdefault("location", "无")
        item.setdefault("start", "无")
        item.setdefault("end", "无")
    for item in data.get("education", []):
        item.setdefault("location", "无")
    return data


# ─── 简历解析（只解析，不保存）────────────────────────────

@app.post("/parse-resume")
async def parse_resume(file: UploadFile = File(...)):
    file_bytes = await file.read()
    resume_text = extract_text(file_bytes, file.filename)

    prompt = f"""你是简历解析器，只输出JSON，不要有任何其他文字。

解析以下简历，严格按照格式输出，所有字段找不到填"无"：

{{
  "basic": {{"name":"","email":"","phone":"","location":"","linkedin":""}},
  "education": [{{"school":"","location":"学校所在城市","degree":"","major":"","gpa":"","start":"","end":"","courses":""}}],
  "experience": [{{"company":"","location":"公司所在城市","title":"","type":"实习或全职","start":"","end":"","bullets":["职责1","职责2"]}}],
  "projects": [{{"name":"","location":"无","tech":"","start":"","end":"","bullets":["描述1","描述2"]}}],
  "activities": [{{"organization":"","role":"","location":"","start":"","end":"","bullets":["描述1"]}}],
  "skills": {{"technical":"技能1,技能2","languages":"语言能力"}},
  "awards": [{{"name":"","date":""}}]
}}

简历内容：
{resume_text}"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )

    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return {"status": "error", "message": f"JSON解析失败: {e}", "raw": raw[:300]}

    data = normalize_profile(data)
    return {"status": "ok", "data": data}


# ─── 简历优化 ────────────────────────────────────────────

@app.post("/analyze")
async def analyze(file: UploadFile = File(...), jd: str = Form(...)):
    file_bytes = await file.read()
    resume_text = extract_text(file_bytes, file.filename)

    prompt = f"""你是一位专业的求职顾问，帮助应届生优化简历。

【我的简历】
{resume_text}

【目标岗位JD】
{jd}

请按以下格式输出分析结果：

## 命中关键词
列出简历中已经匹配JD要求的技能/经历（每条一行，用✅开头）

## 优化建议
针对JD要求，指出简历中可以强化表达的地方（每条一行，用📝开头）

## 缺口分析
列出JD要求但简历中明显缺失的内容（每条一行，用⚠️开头）

## 优化后的简历摘要
根据JD重新撰写一段个人简介（100-150字），突出与该岗位最相关的经历和能力。
"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.7,
    )

    return {"result": response.choices[0].message.content}


# ─── 档案 CRUD ───────────────────────────────────────────

@app.get("/profiles")
async def api_list_profiles():
    return list_profiles()


@app.post("/profiles")
async def api_create_profile(payload: dict):
    name = payload.get("name", "未命名档案")
    data = payload.get("data", {})
    profile_id = create_profile(name, data)
    return {"id": profile_id, "name": name}


@app.get("/profiles/{profile_id}")
async def api_get_profile(profile_id: int):
    data = get_profile(profile_id)
    if not data:
        return JSONResponse(status_code=404, content={"error": "档案不存在"})
    return data


@app.put("/profiles/{profile_id}")
async def api_update_profile(profile_id: int, payload: dict):
    update_profile_data(profile_id, payload)
    return {"status": "ok"}


@app.delete("/profiles/{profile_id}")
async def api_delete_profile(profile_id: int):
    delete_profile_by_id(profile_id)
    return {"status": "ok"}


# ─── 页面路由 ────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    with open("index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.get("/profile-page", response_class=HTMLResponse)
async def profile_page():
    with open("profile.html", "r", encoding="utf-8") as f:
        return f.read()
