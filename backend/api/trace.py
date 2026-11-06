"""
api/trace.py —— 单链表「步骤轨迹」接口
==========================================================================
与 main.py §3 兼容层共用同一份会话 store（core.session._STORE），
不再维护独立的 TRACE_SESSIONS 字典（P-001 会话合并）。

  - main.py 的 /api/linkedlist*              返回最终状态（旧版前端 / curl 自检用）
  - 本文件的 /api/linkedlist/trace/*         返回整条步骤轨迹（新版可视化页用）
  - 两者读的是同一条 TraceList，切换接口不再出现"状态漂移"
==========================================================================
"""

from algo import linkedlist_trace as LL
from algo.linkedlist_trace import OpError
from core.response import err, ok
from core.session import get_container
from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

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


@router.get("/trace/state", summary="当前链表状态（无轨迹）")
def trace_state(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    return ok(LL.state_payload(_lst(session_id)))


@router.post("/trace/build", summary="尾插法建表（返回建表轨迹）")
def trace_build(
    body: BuildIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    lst = _lst(session_id)
    try:
        return ok(LL.op_build(lst, body.values))
    except OpError as e:
        return err(str(e))


@router.post("/trace/insert-head", summary="头插（返回轨迹）")
def trace_insert_head(
    body: ValueIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    try:
        return ok(LL.op_insert_head(_lst(session_id), body.value))
    except OpError as e:
        return err(str(e))


@router.post("/trace/insert-tail", summary="尾插（返回轨迹）")
def trace_insert_tail(
    body: ValueIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    try:
        return ok(LL.op_insert_tail(_lst(session_id), body.value))
    except OpError as e:
        return err(str(e))


@router.post("/trace/delete-pos", summary="按位序删除（返回轨迹）")
def trace_delete_pos(
    body: PosIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    try:
        return ok(LL.op_delete_pos(_lst(session_id), body.pos))
    except OpError as e:
        return err(str(e))


@router.post("/trace/delete-value", summary="按值删除（返回轨迹）")
def trace_delete_value(
    body: SearchIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    try:
        return ok(LL.op_delete_value(_lst(session_id), body.value))
    except OpError as e:
        return err(str(e))


@router.post("/trace/search", summary="按值查找（返回轨迹，不修改链表）")
def trace_search(
    body: SearchIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    try:
        return ok(LL.op_search(_lst(session_id), body.value))
    except OpError as e:
        return err(str(e))


@router.post("/trace/traverse", summary="遍历（返回轨迹，不修改链表）")
def trace_traverse(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    return ok(LL.op_traverse(_lst(session_id)))
