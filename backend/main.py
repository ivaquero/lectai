# -*- coding: utf-8 -*-
"""
数据结构学习平台 · 后端服务（Python + FastAPI）
==========================================================================
对接对象：web/ 目录下的纯前端学习站（index.html / visual.html / quiz.html）

功能模块
  §1  统一响应格式与工具
  §2  会话级内存存储（每个会话独立维护一份链表/栈/队列）
  §3  单链表（真实 Node 结点实现，含 增/删/查 算法逻辑）
  §4  栈（顺序栈，增/删/查 = 入栈/出栈/取栈顶）
  §5  队列（循环思想，增/删/查 = 入队/出队/取队头）
  §6  相关 REST 接口（/api/linkedlist /api/stack /api/queue）
  §7  题库接口（/api/quiz/*：取题、提交答案、统计）
  §8  AI 答疑接口（/api/ai/ask，预留大模型接入位，当前返回模拟回答）
  §9  健康检查 + 前端静态托管（可选）

启动方式（见 README.md）：
  pip install -r requirements.txt
  uvicorn main:app --reload --port 8000

交互式接口文档（自动生成）：
  http://127.0.0.1:8000/docs
==========================================================================
"""

import itertools
import json
import os
import time
from typing import Optional

from fastapi import FastAPI, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from api.trace import router as trace_router
from api.stackqueue_trace import stack_router, queue_router

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.normpath(os.path.join(BASE_DIR, "..", "web"))   # 前端目录（可选托管）

app = FastAPI(
    title="数据结构学习平台后端",
    version="1.0.0",
    description="为数据结构学习站提供：链表/栈/队列操作接口、刷题题库接口、AI 答疑接口。",
)

# --------------------------------------------------------------------------
# CORS：允许任意来源，方便前端以 file:// 或任意本地端口直接调用
# 上线时建议把 allow_origins 收敛为具体域名
# --------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 新版可视化页的「步骤轨迹」接口（algo/ + api/ 模块化结构，见 api/trace.py）
app.include_router(trace_router)
app.include_router(stack_router)
app.include_router(queue_router)


# ==========================================================================
# §1 统一响应格式与请求模型
# --------------------------------------------------------------------------
# 所有接口统一返回：{ "code": 0, "msg": "ok", "data": {...} }
#   code = 0 成功；code = 1 业务错误（如栈空、位序越界）
# 业务错误不抛 HTTP 异常、统一 200，方便前端 JS 只看 code 字段统一处理
# ==========================================================================

def ok(data=None, msg="ok"):
    """成功响应"""
    return {"code": 0, "msg": msg, "data": data}


def err(msg: str, data=None):
    """业务错误响应"""
    return {"code": 1, "msg": msg, "data": data}


class ValueIn(BaseModel):
    """数值输入（链表结点值 / 栈元素 / 队列元素）"""
    value: int = Field(ge=-9999, le=9999, description="元素数值，整数")


class PosIn(BaseModel):
    """位序输入（链表按位删除，1-based）"""
    pos: int = Field(ge=1, description="位序，从 1 开始")


class SearchIn(BaseModel):
    """查询输入（按值查找）"""
    value: int = Field(ge=-9999, le=9999)


class ValuesIn(BaseModel):
    """批量载入（前端初始化/重置时用它和后端对齐状态）"""
    values: list[int] = Field(default_factory=list)


class SubmitIn(BaseModel):
    """刷题答案提交"""
    question_id: str = Field(description="题目 id，例如 list-3")
    answer: int = Field(ge=0, le=3, description="用户选择的选项下标，0~3 对应 A~D")


class AskIn(BaseModel):
    """AI 答疑提问"""
    question: str = Field(min_length=1, max_length=500, description="用户提问文本")


# ==========================================================================
# §2 会话级内存存储
# --------------------------------------------------------------------------
# 前端每次请求可携带请求头 X-Session-Id 标识会话；不携带则共用 "default"。
# 重启服务后数据清空（纯内存，无数据库，符合"本地运行测试"的定位）。
# ==========================================================================

SESSIONS: dict = {}


def get_store(session_id: str) -> dict:
    """取（或初始化）一个会话的全部状态"""
    if session_id not in SESSIONS:
        SESSIONS[session_id] = {
            "list": LinkedList(),   # 单链表
            "stack": Stack(),       # 栈
            "queue": Queue(),       # 队列
            "quiz_stats": {},       # 刷题统计 {category: {"done": n, "right": n}}
        }
    return SESSIONS[session_id]


def sid_header(session_id: Optional[str]) -> str:
    """从请求头取会话 id，缺省 default"""
    return session_id or "default"


# ==========================================================================
# §3 单链表（带头结点写法的裸链实现，便于阅读算法逻辑）
# ==========================================================================

class Node:
    """链表结点：数据域 value + 指针域 next（id 用于前端渲染时做稳定标识）"""
    __slots__ = ("id", "value", "next")
    _seq = itertools.count(1)

    def __init__(self, value: int):
        self.id = f"n{next(Node._seq)}"   # 创建时分配，之后不再变化
        self.value = value
        self.next: Optional["Node"] = None


class LinkedList:
    """
    单链表。为了和教材一致，算法均手写指针操作（不借用 Python list）：
      - insert_head / insert_tail：O(1) / O(n)
      - delete_at(pos)：先找前驱，再 p.next = q.next
      - search(value)：沿 next 逐个比较，返回首个命中位序
    """

    def __init__(self):
        self.head: Optional[Node] = None       # 头指针（指向首元结点）

    # ---------- 查询 ----------
    def length(self) -> int:
        n, p = 0, self.head
        while p:
            n += 1
            p = p.next
        return n

    def to_nodes(self) -> list:
        """导出为 [{id, value}]，顺序即链表逻辑顺序，供前端渲染"""
        out, p = [], self.head
        while p:
            out.append({"id": p.id, "value": p.value})
            p = p.next
        return out

    def load(self, values: list) -> str:
        """按给定序列重建整条链表（供前端初始化/重置与会话对齐）"""
        self.head = None
        for v in values:
            self.insert_tail(v)
        return f"已载入 {len(values)} 个结点"

    def search(self, value: int) -> dict:
        """按值查找：返回首个命中的位序（1-based），找不到返回 -1"""
        pos, p = 1, self.head
        while p:
            if p.value == value:
                return {"found": True, "pos": pos, "length": self.length()}
            p = p.next
            pos += 1
        return {"found": False, "pos": -1, "length": self.length()}

    # ---------- 增加 ----------
    def insert_head(self, value: int) -> str:
        """头插：s.next = head; head = s —— 两步顺序不可颠倒"""
        node = Node(value)
        node.next = self.head          # ① 新结点接上原链
        self.head = node               # ② 头指针指向新结点
        return f"头插结点 {value} 完成，当前表长 {self.length()}"

    def insert_tail(self, value: int) -> str:
        """尾插：沿 next 找到尾结点（next 为空），令 tail.next = 新结点"""
        node = Node(value)
        if self.head is None:                       # 空表：直接作首元结点
            self.head = node
            return f"链表原为空，{value} 成为首元结点，当前表长 1"
        p = self.head
        while p.next:                               # 走到最后一个结点
            p = p.next
        p.next = node
        return f"尾插结点 {value} 完成，当前表长 {self.length()}"

    # ---------- 删除 ----------
    def delete_at(self, pos: int) -> str:
        """按位序删除（1-based）：找第 pos-1 个结点作前驱，再摘链"""
        n = self.length()
        if pos < 1 or pos > n:
            raise ValueError(f"位序 {pos} 越界，当前链表长度为 {n}")
        if pos == 1:                                # 删首元：head 直接后移
            v = self.head.value
            self.head = self.head.next
            return f"删除第 1 个结点（{v}）完成，当前表长 {n - 1}"
        p = self.head
        for _ in range(pos - 2):                    # p 移到前驱（第 pos-1 个）
            p = p.next
        q = p.next                                  # 待删结点
        p.next = q.next                             # 摘链
        return f"删除第 {pos} 个结点（{q.value}）完成，当前表长 {n - 1}"

    def delete_value(self, value: int) -> str:
        """按值删除第一个匹配结点；找不到抛业务异常"""
        prev, p = None, self.head
        while p:
            if p.value == value:
                if prev is None:
                    self.head = p.next
                else:
                    prev.next = p.next
                return f"删除值为 {value} 的结点完成，当前表长 {self.length()}"
            prev, p = p, p.next
        raise ValueError(f"链表中不存在值为 {value} 的结点")

    def clear(self) -> str:
        self.head = None
        return "链表已清空（head 置为 NULL）"


# ==========================================================================
# §4 栈（顺序栈）
# ==========================================================================

class Stack:
    """栈：只能在栈顶插入/删除（LIFO）。list 尾部即栈顶。"""

    def __init__(self):
        self.items: list = []

    def push(self, value: int) -> str:
        self.items.append(value)                    # 栈顶指针 +1 后写入
        return f"{value} 入栈成功，成为新栈顶，栈内 {len(self.items)} 个元素"

    def pop(self) -> dict:
        if not self.items:
            raise ValueError("栈已空，无法出栈（下溢）")
        top = self.items.pop()                      # 取出栈顶并指针 -1
        return {"popped": top, "remain": len(self.items),
                "msg": f"栈顶 {top} 出栈成功，栈内剩 {len(self.items)} 个元素"}

    def peek(self) -> dict:
        if not self.items:
            raise ValueError("栈为空，没有栈顶元素")
        return {"top": self.items[-1], "size": len(self.items)}

    def clear(self) -> str:
        n = len(self.items)
        self.items = []
        return f"已清空栈（释放 {n} 个元素，top 重置）"

    def load(self, values: list) -> str:
        self.items = list(values)
        return f"已载入 {len(values)} 个元素（栈底 → 栈顶）"


# ==========================================================================
# §5 队列
# ==========================================================================

class Queue:
    """
    队列：队尾入队、队头出队（FIFO）。
    用 list 模拟：append 入队尾、pop(0) 出队头（教学实现，足够清晰；
    生产高并发场景应换成 collections.deque 以获得 O(1) 出队）。
    """

    def __init__(self):
        self.items: list = []

    def enqueue(self, value: int) -> str:
        self.items.append(value)                    # rear 指针后移后写入
        return f"{value} 入队成功（队尾），队内 {len(self.items)} 个元素"

    def dequeue(self) -> dict:
        if not self.items:
            raise ValueError("队列已空，无法出队（下溢）")
        front = self.items.pop(0)                   # front 指针后移
        return {"dequeued": front, "remain": len(self.items),
                "msg": f"队头 {front} 出队成功，队内剩 {len(self.items)} 个元素"}

    def peek(self) -> dict:
        if not self.items:
            raise ValueError("队列为空，没有队头元素")
        return {"front": self.items[0], "rear": self.items[-1], "size": len(self.items)}

    def clear(self) -> str:
        n = len(self.items)
        self.items = []
        return f"已清空队列（释放 {n} 个元素，front/rear 重置）"

    def load(self, values: list) -> str:
        self.items = list(values)
        return f"已载入 {len(values)} 个元素（队头 → 队尾）"


# ==========================================================================
# §6 链表 / 栈 / 队列 REST 接口
# --------------------------------------------------------------------------
# 约定：
#   - 会话标识放在请求头 X-Session-Id（可省略，省略则共用 default 会话）
#   - GET  = 查询状态；POST = 增/操作；DELETE = 清空
# ==========================================================================

def _biz(fn):
    """把业务异常（ValueError）转成 code=1 的统一响应"""
    try:
        return ok(data=fn())
    except ValueError as e:
        return err(str(e))


# ---------------------------- 单链表 ----------------------------

@app.get("/api/linkedlist", summary="查询单链表当前状态")
def ll_state(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    ll: LinkedList = get_store(sid_header(session_id))["list"]
    nodes = ll.to_nodes()
    return ok(data={
        "nodes": nodes,
        "length": len(nodes),
        "empty": len(nodes) == 0,
        "msg": f"当前链表共 {len(nodes)} 个结点" + ("（空表 head->next == NULL）" if not nodes else ""),
    })


@app.post("/api/linkedlist/insert-head", summary="头插结点")
def ll_insert_head(body: ValueIn,
                   session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    ll: LinkedList = get_store(sid_header(session_id))["list"]
    msg = ll.insert_head(body.value)
    return ok(data={"nodes": ll.to_nodes(), "length": ll.length(), "msg": msg})


@app.post("/api/linkedlist/insert-tail", summary="尾插结点")
def ll_insert_tail(body: ValueIn,
                   session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    ll: LinkedList = get_store(sid_header(session_id))["list"]
    msg = ll.insert_tail(body.value)
    return ok(data={"nodes": ll.to_nodes(), "length": ll.length(), "msg": msg})


@app.post("/api/linkedlist/delete", summary="按位序删除结点")
def ll_delete(body: PosIn,
              session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    ll: LinkedList = get_store(sid_header(session_id))["list"]

    def run():
        msg = ll.delete_at(body.pos)
        return {"nodes": ll.to_nodes(), "length": ll.length(), "msg": msg}
    return _biz(run)


@app.post("/api/linkedlist/delete-value", summary="按值删除第一个匹配结点")
def ll_delete_value(body: SearchIn,
                    session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    ll: LinkedList = get_store(sid_header(session_id))["list"]

    def run():
        msg = ll.delete_value(body.value)
        return {"nodes": ll.to_nodes(), "length": ll.length(), "msg": msg}
    return _biz(run)


@app.post("/api/linkedlist/search", summary="按值查找（返回首个命中位序）")
def ll_search(body: SearchIn,
              session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    ll: LinkedList = get_store(sid_header(session_id))["list"]
    r = ll.search(body.value)
    msg = (f"找到 {body.value}：位于第 {r['pos']} 个结点"
           if r["found"] else f"{body.value} 不在链表中")
    return ok(data={**r, "nodes": ll.to_nodes(), "msg": msg})


@app.delete("/api/linkedlist", summary="清空链表")
def ll_clear(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    ll: LinkedList = get_store(sid_header(session_id))["list"]
    return ok(data={"nodes": [], "length": 0, "msg": ll.clear()})


@app.post("/api/linkedlist/reset", summary="按给定序列重建链表（前端初始化/重置用）")
def ll_reset(body: ValuesIn,
             session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    ll: LinkedList = get_store(sid_header(session_id))["list"]
    msg = ll.load(body.values)
    return ok(data={"nodes": ll.to_nodes(), "length": ll.length(), "msg": msg})


# ------------------------------- 栈 -------------------------------

@app.get("/api/stack", summary="查询栈当前状态")
def stack_state(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    st: Stack = get_store(sid_header(session_id))["stack"]
    items = st.items
    return ok(data={
        "items": items, "size": len(items), "top": items[-1] if items else None,
        "empty": not items,
        "msg": f"栈内 {len(items)} 个元素" + (f"，栈顶 {items[-1]}" if items else "（空栈）"),
    })


@app.post("/api/stack/push", summary="入栈")
def stack_push(body: ValueIn,
               session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    st: Stack = get_store(sid_header(session_id))["stack"]
    msg = st.push(body.value)
    return ok(data={"items": st.items, "size": len(st.items), "top": body.value, "msg": msg})


@app.post("/api/stack/pop", summary="出栈")
def stack_pop(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    st: Stack = get_store(sid_header(session_id))["stack"]

    def run():
        r = st.pop()
        r["items"] = st.items
        return r
    return _biz(run)


@app.get("/api/stack/peek", summary="查看栈顶（不出栈）")
def stack_peek(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    st: Stack = get_store(sid_header(session_id))["stack"]
    return _biz(lambda: {**st.peek(), "msg": f"栈顶元素为 {st.peek()['top']}（仅查看，未弹出）"})


@app.delete("/api/stack", summary="清空栈")
def stack_clear(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    st: Stack = get_store(sid_header(session_id))["stack"]
    return ok(data={"items": [], "size": 0, "msg": st.clear()})


@app.post("/api/stack/reset", summary="按给定序列重建栈（前端初始化/重置用）")
def stack_reset(body: ValuesIn,
                session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    st: Stack = get_store(sid_header(session_id))["stack"]
    msg = st.load(body.values)
    return ok(data={"items": st.items, "size": len(st.items),
                    "top": st.items[-1] if st.items else None, "msg": msg})


# ------------------------------ 队列 ------------------------------

@app.get("/api/queue", summary="查询队列当前状态")
def queue_state(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    q: Queue = get_store(sid_header(session_id))["queue"]
    items = q.items
    return ok(data={
        "items": items, "size": len(items),
        "front": items[0] if items else None, "rear": items[-1] if items else None,
        "empty": not items,
        "msg": f"队内 {len(items)} 个元素" + (f"，队头 {items[0]} 队尾 {items[-1]}" if items else "（空队列 front == rear）"),
    })


@app.post("/api/queue/enqueue", summary="入队（队尾）")
def queue_enqueue(body: ValueIn,
                  session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    q: Queue = get_store(sid_header(session_id))["queue"]
    msg = q.enqueue(body.value)
    return ok(data={"items": q.items, "size": len(q.items), "rear": body.value, "msg": msg})


@app.post("/api/queue/dequeue", summary="出队（队头）")
def queue_dequeue(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    q: Queue = get_store(sid_header(session_id))["queue"]

    def run():
        r = q.dequeue()
        r["items"] = q.items
        return r
    return _biz(run)


@app.get("/api/queue/peek", summary="查看队头（不出队）")
def queue_peek(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    q: Queue = get_store(sid_header(session_id))["queue"]
    return _biz(lambda: {**q.peek(),
                         "msg": f"队头 {q.peek()['front']}、队尾 {q.peek()['rear']}（仅查看，未出队）"})


@app.delete("/api/queue", summary="清空队列")
def queue_clear(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    q: Queue = get_store(sid_header(session_id))["queue"]
    return ok(data={"items": [], "size": 0, "msg": q.clear()})


@app.post("/api/queue/reset", summary="按给定序列重建队列（前端初始化/重置用）")
def queue_reset(body: ValuesIn,
                session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    q: Queue = get_store(sid_header(session_id))["queue"]
    msg = q.load(body.values)
    return ok(data={"items": q.items, "size": len(q.items),
                    "front": q.items[0] if q.items else None,
                    "rear": q.items[-1] if q.items else None, "msg": msg})


# ==========================================================================
# §7 题库接口
# --------------------------------------------------------------------------
# 题库数据在 questions.json（与前端 script.js 的 QUIZ_BANK 完全同源，32 题）。
# 取题接口不返回 ans/exp/key，防止前端作弊；判题一律走提交接口。
# ==========================================================================

with open(os.path.join(BASE_DIR, "questions.json"), encoding="utf-8") as f:
    QUIZ_BANK: dict = json.load(f)

# 摊平成 {qid: 题目} 索引，qid 形如 "list-3"（分类-序号）
QUESTION_INDEX: dict = {}
for _cat_key, _cat in QUIZ_BANK.items():
    for _i, _q in enumerate(_cat["questions"], 1):
        QUESTION_INDEX[f"{_cat_key}-{_i}"] = {**_q, "id": f"{_cat_key}-{_i}", "category": _cat_key}


@app.get("/api/quiz/categories", summary="获取题库分类列表")
def quiz_categories():
    cats = [{"key": k, "name": v["name"], "count": len(v["questions"])}
            for k, v in QUIZ_BANK.items()]
    return ok(data={"categories": cats, "total": sum(c["count"] for c in cats)})


@app.get("/api/quiz/questions", summary="获取某分类的全部题目（不含答案与解析）")
def quiz_questions(category: str = Query(description="分类 key：list / stackqueue / tree / sort")):
    if category not in QUIZ_BANK:
        return err(f"未知分类 {category}，可用：{', '.join(QUIZ_BANK)}")
    questions = [{
        "id": f"{category}-{i}",
        "tag": q.get("tag", ""),
        "question": q["q"],
        "options": q["opts"],           # 4 个选项，下标 0~3 对应 A~D
    } for i, q in enumerate(QUIZ_BANK[category]["questions"], 1)]
    return ok(data={
        "category": category,
        "name": QUIZ_BANK[category]["name"],
        "total": len(questions),
        "questions": questions,
    })


@app.post("/api/quiz/submit", summary="提交答案（返回判题结果 + 解析）")
def quiz_submit(body: SubmitIn,
                session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    q = QUESTION_INDEX.get(body.question_id)
    if q is None:
        return err(f"题目不存在：{body.question_id}")

    correct = (body.answer == q["ans"])
    letters = "ABCD"

    # 记录会话统计
    store = get_store(sid_header(session_id))
    stat = store["quiz_stats"].setdefault(q["category"], {"done": 0, "right": 0})
    stat["done"] += 1
    if correct:
        stat["right"] += 1

    return ok(data={
        "question_id": q["id"],
        "correct": correct,
        "answer_index": q["ans"],                       # 正确选项下标
        "answer_letter": letters[q["ans"]],             # 正确选项字母
        "answer_text": q["opts"][q["ans"]],             # 正确选项内容
        "explanation": q["exp"],                        # 解析（含少量 HTML 标签，前端直接渲染）
        "key_point": q["key"],                          # 关键记忆点
        "msg": "✅ 回答正确！" if correct else f"❌ 回答错误，正确答案是 {letters[q['ans']]}",
    })


@app.get("/api/quiz/stats", summary="查询当前会话的刷题统计")
def quiz_stats(session_id: Optional[str] = Header(None, alias="X-Session-Id")):
    stats = get_store(sid_header(session_id))["quiz_stats"]
    return ok(data={
        "categories": {k: {**v, "accuracy": round(v["right"] / v["done"] * 100, 1) if v["done"] else 0.0}
                       for k, v in stats.items()},
        "total_done": sum(v["done"] for v in stats.values()),
        "total_right": sum(v["right"] for v in stats.values()),
    })


# ==========================================================================
# §8 AI 答疑接口（预留大模型接入位）
# --------------------------------------------------------------------------
# 当前策略：
#   ① 命中本地知识库 kb.json（与前端 AI_KB 同源，21 条）→ 返回高质量答案
#   ② 未命中 → 返回模拟回答，并标注 source="mock"
# 接入大模型时，只需要实现 call_llm() 并在 ask_ai() 中取消注释即可，
# 接口出入参格式保持不变，前端零改动。
# ==========================================================================

with open(os.path.join(BASE_DIR, "kb.json"), encoding="utf-8") as f:
    AI_KB: list = json.load(f)


def kb_match(question: str) -> Optional[dict]:
    """本地知识库匹配：命中关键词最多的一条胜出"""
    q = question.lower()
    best, best_score = None, 0
    for item in AI_KB:
        score = sum(1 for k in item["keywords"] if k.lower() in q)
        if score > best_score:
            best, best_score = item, score
    return best


def call_llm(question: str) -> str:
    """
    ★ 大模型接入位（预留）★

    接入示例（以 OpenAI 兼容接口为例）：
        from openai import OpenAI
        client = OpenAI(api_key="sk-...", base_url="https://api.xxx.com/v1")
        resp = client.chat.completions.create(
            model="your-model",
            messages=[
                {"role": "system", "content": "你是一名数据结构老师，用中文简洁解答，侧重 408 考点。"},
                {"role": "user", "content": question},
            ],
        )
        return resp.choices[0].message.content

    接入后把 ask_ai() 中 call_llm 分支的注释打开即可。
    """
    raise NotImplementedError("大模型尚未接入")


@app.post("/api/ai/ask", summary="AI 答疑（当前为模拟回答，预留大模型接入位）")
def ask_ai(body: AskIn):
    question = body.question.strip()

    # ---------- ① 本地知识库匹配 ----------
    hit = kb_match(question)
    if hit:
        return ok(data={
            "answer": hit["answer"],            # HTML 片段，前端可直接 innerHTML
            "title": hit["title"],
            "source": "local_kb",               # 来源标记：本地知识库
            "model": None,
        })

    # ---------- ② 大模型（预留，接入后取消注释） ----------
    # try:
    #     answer = call_llm(question)
    #     return ok(data={"answer": answer, "title": None, "source": "llm", "model": "your-model"})
    # except Exception as e:
    #     return err(f"大模型调用失败：{e}")

    # ---------- ③ 模拟回答 ----------
    mock = (
        f"<p>【模拟回答】已收到你的提问：「{question}」。</p>"
        "<p>大模型接口尚未接入。当前后端内置了 21 条高频考点知识库，"
        "你可以换个包含<b>数据结构术语</b>的问法（例如「KMP 的 next 数组怎么求」"
        "「快速排序为什么最坏 O(n²)」「循环队列怎么判满」），就能命中真实答案。</p>"
        "<p class='text-muted'>接入大模型后，本接口将返回真实解答，前端无需改动。</p>"
    )
    return ok(data={"answer": mock, "title": None, "source": "mock", "model": None})


# ==========================================================================
# §9 健康检查 + 前端静态托管（可选）
# ==========================================================================

START_TIME = time.time()


@app.get("/api/health", summary="健康检查")
def health():
    return ok(data={
        "service": "数据结构学习平台后端",
        "version": "1.0.0",
        "uptime_sec": round(time.time() - START_TIME, 1),
        "sessions": len(SESSIONS),
        "quiz_total": len(QUESTION_INDEX),
        "kb_entries": len(AI_KB),
    })


# 若 web/ 目录存在，则把前端站点一并托管：直接访问 http://127.0.0.1:8000 即可打开首页，
# 且前端页面与接口同源，连 CORS 都不需要。（API 路由优先于静态文件匹配）
if os.path.isdir(WEB_DIR):
    # 旧地址 /visual.html 已归档到 /legacy/visual.html，这里做一次跳转，
    # 避免以前收藏的链接直接 404。（必须注册在 mount 之前，否则会被静态文件吃掉）
    @app.get("/visual.html", include_in_schema=False)
    def legacy_visual():
        from fastapi.responses import RedirectResponse
        return RedirectResponse(url="/legacy/visual.html", status_code=307)

    app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")


# 直接 `python main.py` 也能启动（等价于 uvicorn main:app --port 8000）
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
