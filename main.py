from fastapi import FastAPI, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from openai import OpenAI
import pdfplumber
import docx
import json
import io

from database import init_db, save_profile, load_profile
import re
import os
from dotenv import load_dotenv

load_dotenv()


def desc_to_bullets(text: str) -> list:
    """把长段落描述拆成 bullet 数组"""
    if not text:
        return []
    # 先尝试按换行或连字符分割
    lines = re.split(r'\n|(?<=[.。])\s+(?=[A-Z\u4e00-\u9fa5])', text.strip())
    bullets = [l.strip().lstrip('-•·').strip() for l in lines if len(l.strip()) > 5]
    return bullets if bullets else [text.strip()]


def normalize_profile(data: dict) -> dict:
    """统一处理 AI 返回格式，把 description 转成 bullets，补充缺失字段"""
    for item in data.get("experience", []):
        if "bullets" not in item or not item["bullets"]:
            item["bullets"] = desc_to_bullets(item.pop("description", ""))
        item.setdefault("location", "")
    for item in data.get("projects", []):
        if "bullets" not in item or not item["bullets"]:
            item["bullets"] = desc_to_bullets(item.pop("description", ""))
        item.setdefault("start", "")
        item.setdefault("end", "")
    for item in data.get("activities", []):
        if "bullets" not in item or not item["bullets"]:
            item["bullets"] = desc_to_bullets(item.pop("description", ""))
        item.setdefault("location", "")
    for item in data.get("education", []):
        item.setdefault("location", "")
    return data

app = FastAPI()

API_KEY = os.getenv("SILICONFLOW_API_KEY")
BASE_URL = "https://api.siliconflow.cn/v1"
MODEL = "deepseek-ai/DeepSeek-V3"

client = OpenAI(api_key=API_KEY, base_url=BASE_URL)

init_db()


def extract_text(file_bytes: bytes, filename: str) -> str:
    if filename.endswith(".pdf"):
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            return "\n".join(page.extract_text() or "" for page in pdf.pages)
    elif filename.endswith(".docx"):
        doc = docx.Document(io.BytesIO(file_bytes))
        return "\n".join(p.text for p in doc.paragraphs)
    else:
        return file_bytes.decode("utf-8", errors="ignore")


@app.post("/analyze")
async def analyze(
    file: UploadFile = File(...),
    jd: str = Form(...)
):
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

    result = response.choices[0].message.content
    return {"result": result}


@app.post("/parse-resume")
async def parse_resume(file: UploadFile = File(...)):
    file_bytes = await file.read()
    resume_text = extract_text(file_bytes, file.filename)

    prompt = f"""你是简历解析器，只输出JSON，不要有任何其他文字。

解析以下简历，注意：
- education每条必须有location字段（学校右边的城市）
- experience每条必须有location字段（公司右边的城市）
- activities每条必须有location、start、end字段
- bullets必须是数组，每个元素是一条独立的职责或描述
- 所有字段找不到填"无"

格式：
{{
  "basic": {{"name":"","email":"","phone":"","location":"","linkedin":""}},
  "education": [{{"school":"","location":"","degree":"","major":"","gpa":"","start":"","end":"","courses":""}}],
  "experience": [{{"company":"","location":"","title":"","type":"","start":"","end":"","bullets":[]}}],
  "activities": [{{"organization":"","role":"","location":"","start":"","end":"","bullets":[]}}],
  "skills": {{
    "technical": "技术技能，逗号分隔",
    "languages": "语言能力，如英语CET-6"
  }},
  "awards": [{{"name":"","date":""}}]
}}

简历：
{resume_text}"""

    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )

    raw = response.choices[0].message.content.strip()

    # 去掉可能的 markdown 代码块
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        return {"status": "error", "message": f"JSON解析失败: {e}", "raw": raw[:300]}
    data = normalize_profile(data)
    save_profile(data)
    return {"status": "ok", "data": data}


@app.get("/profile")
async def get_profile():
    data = load_profile()
    if not data:
        return JSONResponse(status_code=404, content={"error": "暂无档案"})
    return {"data": data}


@app.post("/profile")
async def update_profile(payload: dict):
    save_profile(payload)
    return {"status": "ok"}


@app.get("/", response_class=HTMLResponse)
async def index():
    with open("index.html", "r", encoding="utf-8") as f:
        return f.read()


@app.get("/profile-page", response_class=HTMLResponse)
async def profile_page():
    with open("profile.html", "r", encoding="utf-8") as f:
        return f.read()
