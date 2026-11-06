"""
数据结构学习平台 · 后端服务（Python + FastAPI）
==========================================================================
对接对象：web/ 目录下的纯前端学习站（index.html / list.html / quiz.html / ai.html）

功能模块
  §1  请求模型（响应工具与统一 ok/err 已抽到 core.response）
  §2  会话（唯一真相源，见 core.session.get_store）
  §2b 会话头别名（SessionHeader，供 §4 复用）
      —— 链表 / 栈 / 队列的 HTTP 面已整体收敛到 api/*_trace.py 的 /trace/* 路由，
         main.py 不再自带旧版兼容层（审计 P-002 删除原 §3 共 12 个端点）。
  §4  题库接口（/api/quiz/*：取题、提交答案、统计）—— data/questions.json 懒加载
  §5  AI 答疑接口（/api/ai/ask，预留大模型接入位，当前返回模拟回答）
  §6  健康检查 + 前端静态托管（可选）+ /api/* JSON 404 兜底（P-012）

★ 本次重构要点（对应 2026-11-06 审计报告 P0/P1）★
  · P-001 会话合并：main.SESSIONS / TRACE_SESSIONS / STACK_SESSIONS / QUEUE_SESSIONS
    四个 dict → core.session._STORE（TTL + LRU 双策略），所有接口共享一份数据。
  · P-004 会话不再无界增长：默认 1 小时 TTL + 10000 LRU 上限，可用
    LECTAI_SESSION_TTL / LECTAI_SESSION_MAX 覆盖。
  · P-007 巨型文件收敛：main.py 里的 LinkedList/Stack/Queue 三份重复实现全部删除，
    旧 §6 端点通过 algo/*_trace.py 的 op_* 生成最终状态；ok/err 唯一定义点
    在 core/response.py。
  · P-010 data/questions.json / data/kb.json 改为 _LazyJson 懒加载 + mtime 热更新。
  · P-011 CORS 从环境变量注入，去掉与 "*" 冲突的 allow_credentials=True。
  · P-012 X-Session-Id 走正则校验，非法 sid 归入 default 并记 warning。
  · P-003 AI 答疑 / 题库判题响应加 answer/explanation_content_type 字段，
    前端据此选择 textContent 还是 sanitize 后的 innerHTML。

启动方式（见仓库根 README.md）：
  uv sync                                # 首次或依赖变更时执行
  uv run uvicorn main:app --reload --port 8000

交互式接口文档（自动生成）：
  http://127.0.0.1:8000/docs
==========================================================================
"""

import json
import logging
import os
import threading
import time

from fastapi import FastAPI, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from api.stackqueue_trace import queue_router, stack_router
from api.trace import router as trace_router
from core.response import err, ok
from core.session import (
    get_store,
    session_count,
    session_lock,
    session_stats,
)

log = logging.getLogger("lectai")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(
        logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    )
    log.addHandler(_h)
    log.setLevel(os.getenv("LECTAI_LOG_LEVEL", "INFO").upper())

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "web"))  # 前端目录（可选托管）


# --------------------------------------------------------------------------
# §0 应用装配 + CORS（P-011）
# --------------------------------------------------------------------------
# 允许来源从环境变量 ALLOWED_ORIGINS 读取（逗号分隔），默认只放行本地 8000
# 端口。不再声明 allow_credentials：本项目走 X-Session-Id header，不用 cookie。


def _resolve_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if not raw:
        return [
            "http://127.0.0.1:8000",
            "http://localhost:8000",
            "http://127.0.0.1:5500",  # VSCode Live Server 常用端口
            "http://localhost:5500",
            "null",  # file:// 打开时浏览器的 Origin
        ]
    return [o.strip() for o in raw.split(",") if o.strip()]


app = FastAPI(
    title="数据结构学习平台后端",
    version="1.1.0",
    description="为数据结构学习站提供：链表/栈/队列操作接口、刷题题库接口、AI 答疑接口。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_resolve_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "X-Session-Id"],
    expose_headers=["X-Session-Id"],
)

# 轨迹接口（新可视化页使用）
app.include_router(trace_router)
app.include_router(stack_router)
app.include_router(queue_router)


# --------------------------------------------------------------------------
# §1 请求模型
# --------------------------------------------------------------------------
# 所有接口统一返回：{ "code": 0, "msg": "ok", "data": {...} }
#   code = 0 成功；code = 1 业务错误（栈空、位序越界等）
# 业务错误不抛 HTTP 异常、统一 200，方便前端 JS 只看 code 字段统一处理。
# 链表/栈/队列的请求模型定义在各自的 api/*_trace.py 路由里；本模块只保留
# §4 刷题、§5 答疑两个业务接口用到的模型。


class SubmitIn(BaseModel):
    """刷题答案提交"""

    question_id: str = Field(
        min_length=1, max_length=64, description="题目 id，例如 list-3"
    )
    answer: int = Field(ge=0, le=3, description="用户选择的选项下标，0~3 对应 A~D")


class AskIn(BaseModel):
    """AI 答疑提问"""

    question: str = Field(min_length=1, max_length=500, description="用户提问文本")


# --------------------------------------------------------------------------
# §2b 会话头别名（§4 刷题接口复用）
# --------------------------------------------------------------------------
SessionHeader = Header(default=None, alias="X-Session-Id")


# ==========================================================================
# §4 题库（P-010 懒加载 + mtime 热更新）
# --------------------------------------------------------------------------
# 题库数据在 data/questions.json（前端 quiz 页通过 /api/quiz/questions 拉取，
# 不返回 ans/exp/key，防止前端作弊；判题一律走 /api/quiz/submit）。
# ==========================================================================


class _LazyJson:
    """按 mtime 热更新的 JSON 加载器；文件缺失时抛 RuntimeError 而不是 ImportError。"""

    def __init__(self, path: str, loader=None):
        self._path = path
        self._loader = loader or (lambda raw: raw)
        self._lock = threading.Lock()
        self._mtime = -1.0
        self._data = None

    def get(self):
        try:
            mtime = os.path.getmtime(self._path)
        except FileNotFoundError as e:
            raise RuntimeError(
                f"required data file missing: {self._path}. "
                f"请检查仓库是否完整 clone，或设置正确的相对路径。"
            ) from e
        with self._lock:
            if self._data is None or mtime != self._mtime:
                with open(self._path, encoding="utf-8") as f:
                    self._data = self._loader(json.load(f))
                self._mtime = mtime
            return self._data


QUIZ_PATH = os.path.join(BASE_DIR, "data", "questions.json")
KB_PATH = os.path.join(BASE_DIR, "data", "kb.json")


def _build_index(raw: dict) -> dict:
    """把 {cat: {questions: [...]}} 摊平成 {qid: {..., id, category}}"""
    index = {}
    for cat_key, cat in raw.items():
        for i, q in enumerate(cat.get("questions", []), 1):
            qid = f"{cat_key}-{i}"
            index[qid] = {**q, "id": qid, "category": cat_key}
    return {"bank": raw, "index": index}


_QUIZ = _LazyJson(QUIZ_PATH, loader=_build_index)
_KB = _LazyJson(KB_PATH)


def quiz_bank() -> dict:
    return _QUIZ.get()["bank"]


def question_index() -> dict:
    return _QUIZ.get()["index"]


def ai_kb() -> list:
    return _KB.get()


@app.get("/api/quiz/categories", summary="获取题库分类列表")
def quiz_categories():
    bank = quiz_bank()
    cats = [
        {"key": k, "name": v.get("name", k), "count": len(v.get("questions", []))}
        for k, v in bank.items()
    ]
    return ok(data={"categories": cats, "total": sum(c["count"] for c in cats)})


@app.get("/api/quiz/questions", summary="获取某分类的全部题目（不含答案与解析）")
def quiz_questions(category: str):
    bank = quiz_bank()
    if category not in bank:
        return err(f"未知分类 {category}，可用：{', '.join(bank)}")
    questions = [
        {
            "id": f"{category}-{i}",
            "tag": q.get("tag", ""),
            "question": q["q"],
            "options": q["opts"],  # 4 个选项，下标 0~3 对应 A~D
            "difficulty": q.get("diff", "mid"),  # basic / mid / hard
        }
        for i, q in enumerate(bank[category]["questions"], 1)
    ]
    return ok(
        data={
            "category": category,
            "name": bank[category].get("name", category),
            "total": len(questions),
            "questions": questions,
        }
    )


@app.post("/api/quiz/submit", summary="提交答案（返回判题结果 + 解析）")
def quiz_submit(body: SubmitIn, session_id: str | None = SessionHeader):
    q = question_index().get(body.question_id)
    if q is None:
        return err(f"题目不存在：{body.question_id}")

    correct = body.answer == q["ans"]
    letters = "ABCD"

    with session_lock(session_id):
        store = get_store(session_id)
        stat = store["quiz_stats"].setdefault(q["category"], {"done": 0, "right": 0})
        stat["done"] += 1
        if correct:
            stat["right"] += 1

    return ok(
        data={
            "question_id": q["id"],
            "difficulty": q.get("diff", "mid"),
            "correct": correct,
            "answer_index": q["ans"],
            "answer_letter": letters[q["ans"]],
            "answer_text": q["opts"][q["ans"]],
            "explanation": q["exp"],
            # 内容类型标注（P-003 前端据此选择 textContent 还是 sanitize 后的 innerHTML）
            "explanation_content_type": "trusted_html",
            "key_point": q["key"],
            "key_point_content_type": "trusted_html",
            "msg": "✅ 回答正确！"
            if correct
            else f"❌ 回答错误，正确答案是 {letters[q['ans']]}",
        }
    )


@app.get("/api/quiz/stats", summary="查询当前会话的刷题统计")
def quiz_stats(session_id: str | None = SessionHeader):
    stats = get_store(session_id)["quiz_stats"]
    return ok(
        data={
            "categories": {
                k: {
                    **v,
                    "accuracy": round(v["right"] / v["done"] * 100, 1)
                    if v["done"]
                    else 0.0,
                }
                for k, v in stats.items()
            },
            "total_done": sum(v["done"] for v in stats.values()),
            "total_right": sum(v["right"] for v in stats.values()),
        }
    )


# ==========================================================================
# §5 AI 答疑（P-003：响应带 answer_content_type 让前端区分富文本 / 纯文本）
# ==========================================================================


def kb_match(question: str) -> dict | None:
    """本地知识库匹配：命中关键词最多的一条胜出"""
    q = question.lower()
    best, best_score = None, 0
    for item in ai_kb():
        score = sum(1 for k in item.get("keywords", []) if k.lower() in q)
        if score > best_score:
            best, best_score = item, score
    return best


def call_llm(question: str) -> str:
    """
    ★ 大模型接入位（预留）★

    接入后请把 ask_ai() 中的注释打开，并把 answer_content_type 改成 "plain_text"，
    前端会走 textContent 路径避免 XSS。

    示例（OpenAI 兼容接口）：
        from openai import OpenAI
        client = OpenAI(api_key=os.environ["LLM_API_KEY"], base_url=os.environ["LLM_BASE_URL"])
        resp = client.chat.completions.create(
            model=os.environ.get("LLM_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "你是一名数据结构老师，用中文简洁解答，侧重 408 考点。"},
                {"role": "user", "content": question},
            ],
        )
        return resp.choices[0].message.content
    """
    raise NotImplementedError("大模型尚未接入")


@app.post("/api/ai/ask", summary="AI 答疑（当前为模拟回答，预留大模型接入位）")
def ask_ai(body: AskIn):
    question = body.question.strip()

    # ① 本地知识库命中
    hit = kb_match(question)
    if hit:
        return ok(
            data={
                "answer": hit["answer"],
                "answer_content_type": "trusted_html",  # 来自仓库内置 kb.json
                "title": hit.get("title"),
                "source": "local_kb",
                "model": None,
            }
        )

    # ② 大模型（预留 · 打开注释即接入；接入后 content_type 必须改为 plain_text）
    # try:
    #     answer = call_llm(question)
    #     return ok(data={
    #         "answer": answer,
    #         "answer_content_type": "plain_text",
    #         "title": None,
    #         "source": "llm",
    #         "model": os.environ.get("LLM_MODEL", "unknown"),
    #     })
    # except Exception as e:
    #     log.exception("llm call failed")
    #     return err(f"大模型调用失败：{e}")

    # ③ 模拟回答
    mock = (
        f"<p>【模拟回答】已收到你的提问：「{question}」。</p>"
        "<p>大模型接口尚未接入。当前后端内置了本地知识库，"
        "你可以换个包含<b>数据结构术语</b>的问法（例如「KMP 的 next 数组怎么求」"
        "「快速排序为什么最坏 O(n²)」「循环队列怎么判满」），就能命中真实答案。</p>"
        "<p class='text-muted'>接入大模型后，本接口将返回真实解答，前端无需改动。</p>"
    )
    return ok(
        data={
            "answer": mock,
            "answer_content_type": "trusted_html",  # 本函数硬编码生成，可信
            "title": None,
            "source": "mock",
            "model": None,
        }
    )


# ==========================================================================
# §6 健康检查 + 前端静态托管（可选）
# ==========================================================================

START_TIME = time.time()


@app.get("/api/health", summary="健康检查")
def health():
    try:
        quiz_total = len(question_index())
        quiz_categories = len(_QUIZ.get()["bank"])
        kb_entries = len(ai_kb())
        data_ok = True
    except RuntimeError as e:
        quiz_total = 0
        quiz_categories = 0
        kb_entries = 0
        data_ok = False
        log.warning("health: data file issue -> %s", e)
    return ok(
        data={
            "service": "数据结构学习平台后端",
            "version": "1.1.0",
            "uptime_sec": round(time.time() - START_TIME, 1),
            "sessions": session_count(),
            "session_policy": session_stats(),
            "quiz_total": quiz_total,
            "quiz_categories": quiz_categories,
            "kb_entries": kb_entries,
            "data_ok": data_ok,
        }
    )


# --------------------------------------------------------------------------
# §6b 未匹配 /api/* 的 JSON 兜底（P-012）
# --------------------------------------------------------------------------
# 注册在全部真实 /api 路由之后、StaticFiles("/") 挂载之前：否则拼错的 /api/xxx
# 会掉进 SPA 静态兜底、返回首页 HTML(200)，前端 request() 把 JSON 解析失败误判成
# "后端离线"。这里显式回 404 + 统一 {code:1} JSON，前端据此报"接口不存在"而非离线。
@app.api_route(
    "/api/{full_path:path}",
    methods=["GET", "POST", "DELETE", "PUT", "PATCH"],
    include_in_schema=False,
)
def api_not_found(full_path: str):
    from fastapi.responses import JSONResponse

    return JSONResponse(
        status_code=404,
        content={"code": 1, "msg": f"接口不存在：/api/{full_path}", "data": None},
    )


# 若 web/ 目录存在，则把前端站点一并托管：直接访问 http://127.0.0.1:8000 即可打开首页，
# 且前端页面与接口同源，连 CORS 都不需要。（API 路由优先于静态文件匹配）
if os.path.isdir(WEB_DIR):

    @app.get("/visual.html", include_in_schema=False)
    def legacy_visual():
        from fastapi.responses import RedirectResponse

        return RedirectResponse(url="/list.html", status_code=302)

    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")


# 启动阶段主动 warm 一次题库 / 知识库：如果磁盘缺文件，容器一启动就抛错，
# 而不是等到第一个用户请求命中 /api/quiz/* 才 500。
try:
    _QUIZ.get()
    _KB.get()
except RuntimeError as e:
    log.error("startup warm failed: %s", e)
    raise


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
