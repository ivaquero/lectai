"""
algo/queue_trace.py —— 循环队列「步骤轨迹」生成器
==========================================================================
与 stack_trace.py 共用 SeqTracer，schema 完全一致：

  {
    "seq": int,
    "items": [{"id","value","label"}],   # 队头 → 队尾
    "aside": [{"id","value","label"}],   # 暂离队列的元素（待入队 / 已出队）
    "ptr":   {"front": id|"NULL", "rear": id|"NULL", "x": id|null},
    "mark":  {compare / visited / new / remove},
    "line":  int|null,
    "counters": {...},
    "info":  str,
    "ring":  {"capacity": m, "used": n, "front": i, "rear": j}   # 环形缓冲示意
  }

队列用的是**循环队列**（牺牲一个单元区分空与满）：
  队空 Q.front == Q.rear
  队满 (Q.rear + 1) % MaxSize == Q.front
==========================================================================
"""

import itertools
from collections import deque

from .stack_trace import OpError, SeqTracer

MAX_ITEMS = 10  # 数组容量（含牺牲的一个单元，最多放 9 个）
CAPACITY = MAX_ITEMS  # 数组长度


class Item:
    """队列元素：id 生成后不变"""

    __slots__ = ("id", "value")
    _seq = itertools.count(1)

    def __init__(self, value: int):
        self.id = f"q{next(Item._seq)}"
        self.value = value


OPS = {
    "build": {
        "title": "建队（逐个入队）",
        "lines": [
            "Q.front = Q.rear = 0;                     // 空队",
            "for each x in 输入序列:",
            "    Q.data[Q.rear] = x;",
            "    Q.rear = (Q.rear + 1) % MaxSize;      // 取模成环",
        ],
        "structural": [0],
    },
    "enqueue": {
        "title": "入队 enqueue",
        "lines": [
            "if ((Q.rear + 1) % MaxSize == Q.front) return ERROR;  // 队满",
            "Q.data[Q.rear] = x;                        // ① 写入队尾位置",
            "Q.rear = (Q.rear + 1) % MaxSize;           // ② 队尾指针后移（取模）",
            "return OK;",
        ],
        "structural": [],
    },
    "dequeue": {
        "title": "出队 dequeue",
        "lines": [
            "if (Q.front == Q.rear) return ERROR;       // 队空",
            "x = Q.data[Q.front];                       // ① 取队头元素",
            "Q.front = (Q.front + 1) % MaxSize;         // ② 队头指针后移",
            "return x;",
        ],
        "structural": [],
    },
    "peek": {
        "title": "读队头 peek",
        "lines": [
            "if (Q.front == Q.rear) return ERROR;       // 队空",
            "return Q.data[Q.front];                    // 只读，front 不动",
        ],
        "structural": [],
    },
    "traverse": {
        "title": "遍历（队头 → 队尾）",
        "lines": [
            "i = Q.front;",
            "while (i != Q.rear) { visit(Q.data[i]); i = (i + 1) % MaxSize; }",
        ],
        "structural": [],
    },
}


def _meta(op: str, n: int) -> dict:
    meta = OPS[op]
    return {
        "op": op,
        "title": meta["title"],
        "code": {"lines": meta["lines"], "structural": meta["structural"]},
        "length": n,
        "max_nodes": MAX_ITEMS - 1,  # 牺牲一个单元，实际最多放 9 个
        "trace": None,
    }


class TraceQueue:
    """循环队列：items[0] 是队头，items[-1] 是队尾

    底层用 collections.deque：append / popleft 均 O(1)，避免 list.pop(0) 的
    O(n) 前删。SeqTracer._flat(items) 只做一次顺序遍历，两种容器无差异。
    """

    def __init__(self, values=None):
        self.items: deque = deque()
        for v in values or []:
            self.items.append(Item(v))

    def front(self):
        return self.items[0] if self.items else None

    def rear(self):
        return self.items[-1] if self.items else None

    def length(self) -> int:
        return len(self.items)

    def values(self) -> list:
        return [it.value for it in self.items]

    def to_items(self) -> list:
        return SeqTracer._flat(self.items)

    def ring(self) -> dict:
        """环形缓冲示意：front/rear 都按「数组下标」给出，便于前端画环"""
        used = len(self.items)
        return {
            "capacity": CAPACITY,
            "used": used,
            "front": 0,
            "rear": used % CAPACITY,
            "full": used >= CAPACITY - 1,
        }


# ==========================================================================
# 操作
# ==========================================================================


def op_build(q: TraceQueue, values: list) -> dict:
    if len(values) > CAPACITY - 1:
        raise OpError(f"最多支持 {CAPACITY - 1} 个元素，收到 {len(values)} 个")

    t = SeqTracer()
    q.items = deque()
    t.ptr = {"front": "NULL", "rear": "NULL", "x": None}
    t.push(
        q.items,
        0,
        f"初始化：Q.front = Q.rear = 0，空队（容量 {CAPACITY}，牺牲一个单元）",
    )

    for x in values:
        item = Item(x)
        t._new_ids.add(item.id)
        t.ptr = {"x": item}
        t.push(q.items, 1, f"准备入队：x = {x}", aside=[item])
        q.items.append(item)
        t.moves += 1
        t.ptr = {"front": q.front(), "rear": item, "x": None}
        t.push(q.items, 2, f"Q.data[Q.rear] = {x}：写入队尾", compare=[item.id])
        t.aside = []
        t.push(
            q.items, 3, f"Q.rear = (Q.rear + 1) % {CAPACITY}；当前队列：{q.values()}"
        )

    out = _meta("build", q.length())
    out["result"] = {"values": q.values()}
    out["trace"] = t.steps
    _stamp_ring(out, q)
    return out


def op_enqueue(q: TraceQueue, value: int) -> dict:
    if q.length() >= CAPACITY - 1:
        raise OpError(
            f"队满：循环队列最多放 {CAPACITY - 1} 个元素（容量 {CAPACITY}，牺牲一个单元）"
        )

    t = SeqTracer()
    item = Item(value)
    t._new_ids.add(item.id)

    t.ptr = {"front": q.front(), "rear": q.rear(), "x": item}
    t.push(q.items, 0, f"准备入队：x = {value}", aside=[item])
    t.compares += 1
    t.push(
        q.items,
        0,
        f"检查队满：(rear+1) % {CAPACITY} != front，可入队（已用 {q.length()}/{CAPACITY - 1}）",
        compare=[item.id],
    )

    # ① 写入队尾
    q.items.append(item)
    t.ptr = {"front": q.front(), "rear": item, "x": item}
    t.push(q.items, 1, f"Q.data[Q.rear] = {value}：写到队尾位置", compare=[item.id])

    # ② rear 后移
    t.moves += 1
    t.aside = []
    t.ptr = {"front": q.front(), "rear": item, "x": None}
    t.push(
        q.items,
        2,
        f"Q.rear = (Q.rear + 1) % {CAPACITY}：队尾指针后移一格",
        compare=[item.id],
    )
    t.push(q.items, 3, f"入队完成，当前队列：{q.values()}（左端为队头）")

    out = _meta("enqueue", q.length())
    out["result"] = {"value": value, "values": q.values()}
    out["trace"] = t.steps
    _stamp_ring(out, q)
    return out


def op_dequeue(q: TraceQueue) -> dict:
    if not q.items:
        raise OpError("队空，无法出队")

    t = SeqTracer()
    head = q.front()
    t.ptr = {"front": head, "rear": q.rear(), "x": None}
    t.push(q.items, 0, f"准备出队：当前队头 = {head.value}")
    t.compares += 1
    t.push(q.items, 0, "检查队空：front != rear，队非空", compare=[head.id])

    # ① 取队头
    t.ptr = {"front": head, "rear": q.rear(), "x": head}
    t.push(
        q.items, 1, f"x = Q.data[Q.front]：取到队头元素 {head.value}", remove=[head.id]
    )

    # ② front 后移
    q.items.popleft()
    t.moves += 1
    new_head = q.front()
    t.ptr = {
        "front": new_head if new_head else "NULL",
        "rear": q.rear() if q.rear() else "NULL",
        "x": head,
    }
    t.push(
        q.items,
        2,
        f"Q.front = (Q.front + 1) % {CAPACITY}："
        + (
            "队已空，front = rear" if new_head is None else f"新队头为 {new_head.value}"
        ),
        aside=[head],
        remove=[head.id],
    )

    t.aside = []
    t.ptr = {
        "front": new_head if new_head else "NULL",
        "rear": q.rear() if q.rear() else "NULL",
        "x": None,
    }
    t.push(q.items, 3, f"出队完成，返回 {head.value}；当前队列：{q.values()}")

    out = _meta("dequeue", q.length())
    out["result"] = {"value": head.value, "values": q.values()}
    out["trace"] = t.steps
    _stamp_ring(out, q)
    return out


def op_peek(q: TraceQueue) -> dict:
    if not q.items:
        raise OpError("队空，读不到队头")

    t = SeqTracer()
    head = q.front()
    t.ptr = {"front": head, "rear": q.rear(), "x": None}
    t.push(q.items, 0, "检查队空：front != rear，队非空", compare=[head.id])
    t.compares += 1
    t.push(
        q.items,
        1,
        f"return Q.data[Q.front]：队头是 {head.value}；front 不动",
        compare=[head.id],
    )

    out = _meta("peek", q.length())
    out["result"] = {"value": head.value}
    out["trace"] = t.steps
    _stamp_ring(out, q)
    return out


def op_traverse(q: TraceQueue) -> dict:
    t = SeqTracer()
    if not q.items:
        t.ptr = {"front": "NULL", "rear": "NULL"}
        t.push(q.items, None, "空队，没有可访问的元素")
        out = _meta("traverse", 0)
        out["result"] = {"values": []}
        out["trace"] = t.steps
        _stamp_ring(out, q)
        return out

    seen = []
    for i, it in enumerate(q.items):
        t.visited += 1
        t._visited_ids.add(it.id)
        t.ptr = {"front": q.front(), "rear": q.rear(), "x": it}
        t.push(q.items, 0, f"i = {i}：从队头数第 {i + 1} 个", compare=[it.id])
        seen.append(it.value)
        t.moves += 1
        t.push(q.items, 1, f"visit(Q.data[{i}])：访问到 {it.value}", compare=[it.id])

    t.ptr = {"front": q.front(), "rear": q.rear(), "x": None}
    t.push(
        q.items, None, f"遍历完成（队头 → 队尾）：{' → '.join(str(v) for v in seen)}"
    )
    out = _meta("traverse", q.length())
    out["result"] = {"values": seen}
    out["trace"] = t.steps
    _stamp_ring(out, q)
    return out


def _stamp_ring(out: dict, q: TraceQueue):
    """给轨迹每一步补上环形缓冲信息（前端可选使用）"""
    ring = q.ring()
    out["ring"] = ring
    for s in out["trace"]:
        s["ring"] = ring
    return out


def state_payload(q: TraceQueue) -> dict:
    return {
        "op": "state",
        "length": q.length(),
        "max_nodes": CAPACITY - 1,
        "items": q.to_items(),
        "ring": q.ring(),
        "trace": [],
    }
