"""
api/trace.py —— 单链表「步骤轨迹」接口
==========================================================================
唯一数据源是会话 store（core.session.get_store / get_container）；本文件不再
维护独立 TRACE_SESSIONS 字典（P-001 会话合并），也不再有 main.py §3 兼容层
（P-002 已删除），/api/linkedlist/trace/* 是可视化页唯一入口。

并发（P-011）：FastAPI 同步 def 跑在线程池，同一 sid 的并发请求会读写同一份
TraceList。每个接口都在 session_lock(sid) 下取容器并执行，串行化同会话变更，
不同会话互不影响。

注册表（P-004）：GET /api/linkedlist/ops 直接吐后端 OPS 字典的 key/title/code，
作为「有哪些操作」的单一真相源，前端据此校验本地配置、免漂移。
==========================================================================
"""

from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

from algo import linkedlist_trace as LL
from algo.linkedlist_trace import OpError
from core.response import err, ok
from core.session import get_container, session_lock

router = APIRouter(prefix="/api/linkedlist", tags=["链表·轨迹"])


def _lst(session_id: str | None) -> LL.TraceList:
    return get_container(session_id, "list")


# ------------------------------ 请求模型 ------------------------------


class BuildIn(BaseModel):
    values: list[int] = Field(
        default_factory=list,
        max_length=LL.MAX_NODES,
        description=f"初始序列，最多 {LL.MAX_NODES} 个",
    )


class ValueIn(BaseModel):
    value: int = Field(ge=-9999, le=9999, description="结点数值")


class PosIn(BaseModel):
    pos: int = Field(ge=1, description="位序，从 1 开始")


class SearchIn(BaseModel):
    value: int = Field(ge=-9999, le=9999)


# ------------------------------ 接口 ------------------------------


@router.get("/ops", summary="操作注册表：key/title/C 代码（单一真相源）")
def ops():
    """把后端 OPS 字典摊平成 [{key,title,lines,structural}]。

    前端 list/index.js 会拉这个校验本地 tab 的 key 集合是否一致（漂移即告警），
    并可用 title 覆盖本地文案——新增操作时后端 OPS 就是权威清单。
    """
    data = [
        {
            "key": key,
            "title": meta["title"],
            "lines": meta["lines"],
            "structural": meta["structural"],
        }
        for key, meta in LL.OPS.items()
    ]
    return ok({"module": "linkedlist", "max_nodes": LL.MAX_NODES, "ops": data})


@router.get("/trace/state", summary="当前链表状态（无轨迹）")
def trace_state(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    with session_lock(session_id):
        return ok(LL.state_payload(_lst(session_id)))


@router.post("/trace/build", summary="尾插法建表（返回建表轨迹）")
def trace_build(
    body: BuildIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    with session_lock(session_id):
        try:
            return ok(LL.op_build(_lst(session_id), body.values))
        except OpError as e:
            return err(str(e))


@router.post("/trace/insert-head", summary="头插（返回轨迹）")
def trace_insert_head(
    body: ValueIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    with session_lock(session_id):
        try:
            return ok(LL.op_insert_head(_lst(session_id), body.value))
        except OpError as e:
            return err(str(e))


@router.post("/trace/insert-tail", summary="尾插（返回轨迹）")
def trace_insert_tail(
    body: ValueIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    with session_lock(session_id):
        try:
            return ok(LL.op_insert_tail(_lst(session_id), body.value))
        except OpError as e:
            return err(str(e))


@router.post("/trace/delete-pos", summary="按位序删除（返回轨迹）")
def trace_delete_pos(
    body: PosIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    with session_lock(session_id):
        try:
            return ok(LL.op_delete_pos(_lst(session_id), body.pos))
        except OpError as e:
            return err(str(e))


@router.post("/trace/delete-value", summary="按值删除（返回轨迹）")
def trace_delete_value(
    body: SearchIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    with session_lock(session_id):
        try:
            return ok(LL.op_delete_value(_lst(session_id), body.value))
        except OpError as e:
            return err(str(e))


@router.post("/trace/search", summary="按值查找（返回轨迹，不修改链表）")
def trace_search(
    body: SearchIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    with session_lock(session_id):
        try:
            return ok(LL.op_search(_lst(session_id), body.value))
        except OpError as e:
            return err(str(e))


@router.post("/trace/traverse", summary="遍历（返回轨迹，不修改链表）")
def trace_traverse(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    with session_lock(session_id):
        return ok(LL.op_traverse(_lst(session_id)))
