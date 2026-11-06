"""core/session.py —— 全站唯一的会话状态存储（P-001 + P-004 + P-012）

设计要点
  1. 一份 store 打通链表 / 栈 / 队列 / 刷题统计，替代此前散落在
     main.py §2 SESSIONS、api/trace.py TRACE_SESSIONS、
     api/stackqueue_trace.py STACK_SESSIONS / QUEUE_SESSIONS 的 4 个模块级字典。
  2. 底层用标准库 OrderedDict 做 LRU + TTL 双策略，无第三方依赖。
  3. X-Session-Id 强校验：字符集 [A-Za-z0-9_-]、长度 1~64，非法 sid 归入
     "default"（不抛错，避免第三方探测把服务打崩），并写 warning 日志。
  4. 底层数据结构统一采用 algo/*_trace.py 的 TraceList / TraceStack / TraceQueue，
     新接口与旧接口读写同一份对象；main.py §3-§5 的重复实现因此可以整段删除。
  5. 环境变量：
       LECTAI_SESSION_TTL   单位秒，默认 3600
       LECTAI_SESSION_MAX   最多保留会话数，默认 10000
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from collections import OrderedDict

from algo import linkedlist_trace as _LL
from algo import queue_trace as _Q
from algo import stack_trace as _S

log = logging.getLogger("lectai.session")

SID_TTL = float(os.getenv("LECTAI_SESSION_TTL", "3600"))
SID_MAX = int(os.getenv("LECTAI_SESSION_MAX", "10000"))
SID_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")

# 会话容器一律以空表起步：前端页面在挂载时会显式调 `/trace/build`（见
# web/assets/js/pages/list/index.js 里 `defaults: '3,1,4,1,5'`）载入教学初始值；
# 服务端再预填一遍反而会让 test_api.py 的 "insert 后 search pos 应为 3" 断言翻车
# （旧 main.py 里的 LinkedList/Stack/Queue __init__ 也是空的，保持向后兼容）。


def normalize_sid(raw: str | None) -> str:
    """把请求头里的原始 session id 规整成合法值；非法/缺失回退 default。"""
    if not raw:
        return "default"
    raw = raw.strip()
    if not SID_RE.match(raw):
        log.warning("rejected invalid X-Session-Id %r -> 'default'", raw[:80])
        return "default"
    return raw


class _TTLStore:
    """线程安全的 LRU + TTL 会话容器；命中即 touch 到队尾，未命中懒淘汰。"""

    __slots__ = ("_data", "_exp", "_lock", "_max", "_ttl")

    def __init__(self, maxsize: int, ttl: float):
        self._data: OrderedDict[str, dict] = OrderedDict()
        self._exp: dict = {}
        self._lock = threading.RLock()
        self._max = maxsize
        self._ttl = ttl

    def get_or_create(self, key: str, factory) -> dict:
        now = time.monotonic()
        with self._lock:
            self._evict_expired(now)
            if key in self._data:
                self._data.move_to_end(key)
                self._exp[key] = now + self._ttl
                return self._data[key]
            value = factory()
            self._data[key] = value
            self._exp[key] = now + self._ttl
            while len(self._data) > self._max:
                old_key, _ = self._data.popitem(last=False)
                self._exp.pop(old_key, None)
            return value

    def _evict_expired(self, now: float) -> None:
        # 队首逐个检查即可：LRU + 相同 TTL 时，越靠前越早过期
        while self._data:
            oldest = next(iter(self._data))
            if self._exp.get(oldest, 0) > now:
                break
            self._data.pop(oldest, None)
            self._exp.pop(oldest, None)

    def __len__(self) -> int:
        with self._lock:
            return len(self._data)

    def stats(self) -> dict:
        with self._lock:
            return {"active": len(self._data), "max": self._max, "ttl_sec": self._ttl}


_STORE = _TTLStore(SID_MAX, SID_TTL)


def _make_default_store() -> dict:
    return {
        "list": _LL.TraceList(),
        "stack": _S.TraceStack(),
        "queue": _Q.TraceQueue(),
        "quiz_stats": {},
    }


def get_store(session_id: str | None) -> dict:
    """按（已规整的）session id 取会话 store；不存在则用默认序列初始化。"""
    sid = normalize_sid(session_id)
    return _STORE.get_or_create(sid, _make_default_store)


def get_container(session_id: str | None, kind: str):
    """kind ∈ {"list","stack","queue"}；直接返回对应的容器对象。"""
    if kind not in ("list", "stack", "queue"):
        raise ValueError(f"unknown container kind: {kind}")
    return get_store(session_id)[kind]


def session_count() -> int:
    return len(_STORE)


def session_stats() -> dict:
    return _STORE.stats()
