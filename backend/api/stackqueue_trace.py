"""
api/stackqueue_trace.py —— 栈 / 队列「步骤轨迹」接口
==========================================================================
与 api/trace.py（链表）同一套约定：
  - 会话隔离走 core.session（不再维护 STACK_SESSIONS / QUEUE_SESSIONS 独立字典）
  - 返回 {code, msg, data}，业务错误用 code=1
  - 每个操作返回整条步骤轨迹，前端只做回放

路由：
  /api/stack/trace/{state,build,push,pop,peek,traverse}
  /api/queue/trace/{state,build,enqueue,dequeue,peek,traverse}
==========================================================================
"""

from algo import queue_trace as Q
from algo import stack_trace as S
from algo.stack_trace import OpError
from core.response import err, ok
from core.session import get_container
from fastapi import APIRouter, Header
from pydantic import BaseModel, Field

# ------------------------------ 请求模型 ------------------------------


class ValuesIn(BaseModel):
    values: list[int] = Field(
        default_factory=list,
        max_length=S.MAX_ITEMS,
        description=f"初始序列，最多 {S.MAX_ITEMS} 个",
    )


class ValueIn(BaseModel):
    value: int = Field(ge=-9999, le=9999, description="元素值")


# ------------------------------ 容器访问 ------------------------------


def _stack(sid: str | None) -> S.TraceStack:
    return get_container(sid, "stack")


def _queue(sid: str | None) -> Q.TraceQueue:
    return get_container(sid, "queue")


# ------------------------------ 栈 ------------------------------

stack_router = APIRouter(prefix="/api/stack", tags=["栈·轨迹"])


@stack_router.get("/trace/state", summary="当前栈状态（无轨迹）")
def stack_state(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    return ok(S.state_payload(_stack(session_id)))


@stack_router.post("/trace/build", summary="建栈（返回轨迹）")
def stack_build(
    body: ValuesIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    try:
        return ok(S.op_build(_stack(session_id), body.values))
    except OpError as e:
        return err(str(e))


@stack_router.post("/trace/push", summary="入栈（返回轨迹）")
def stack_push(
    body: ValueIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    try:
        return ok(S.op_push(_stack(session_id), body.value))
    except OpError as e:
        return err(str(e))


@stack_router.post("/trace/pop", summary="出栈（返回轨迹）")
def stack_pop(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    try:
        return ok(S.op_pop(_stack(session_id)))
    except OpError as e:
        return err(str(e))


@stack_router.post("/trace/peek", summary="读栈顶（返回轨迹，不修改栈）")
def stack_peek(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    try:
        return ok(S.op_peek(_stack(session_id)))
    except OpError as e:
        return err(str(e))


@stack_router.post("/trace/traverse", summary="遍历栈（返回轨迹，不修改栈）")
def stack_traverse(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    return ok(S.op_traverse(_stack(session_id)))


# ------------------------------ 队列 ------------------------------

queue_router = APIRouter(prefix="/api/queue", tags=["队列·轨迹"])


@queue_router.get("/trace/state", summary="当前队列状态（无轨迹）")
def queue_state(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    return ok(Q.state_payload(_queue(session_id)))


@queue_router.post("/trace/build", summary="建队（返回轨迹）")
def queue_build(
    body: ValuesIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    try:
        return ok(Q.op_build(_queue(session_id), body.values))
    except OpError as e:
        return err(str(e))


@queue_router.post("/trace/enqueue", summary="入队（返回轨迹）")
def queue_enqueue(
    body: ValueIn, session_id: str | None = Header(default=None, alias="X-Session-Id")
):
    try:
        return ok(Q.op_enqueue(_queue(session_id), body.value))
    except OpError as e:
        return err(str(e))


@queue_router.post("/trace/dequeue", summary="出队（返回轨迹）")
def queue_dequeue(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    try:
        return ok(Q.op_dequeue(_queue(session_id)))
    except OpError as e:
        return err(str(e))


@queue_router.post("/trace/peek", summary="读队头（返回轨迹，不修改队列）")
def queue_peek(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    try:
        return ok(Q.op_peek(_queue(session_id)))
    except OpError as e:
        return err(str(e))


@queue_router.post("/trace/traverse", summary="遍历队列（返回轨迹，不修改队列）")
def queue_traverse(session_id: str | None = Header(default=None, alias="X-Session-Id")):
    return ok(Q.op_traverse(_queue(session_id)))
