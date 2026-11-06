# -*- coding: utf-8 -*-
"""
algo/linkedlist_trace.py —— 单链表「步骤轨迹」生成器
==========================================================================
对应模板 p5js/js/algorithms.js 的设计：算法每执行一个有教学意义的动作，
就 push 一个步骤快照。前端拿到整条轨迹后，播放 / 暂停 / 单步 / 回退 /
跳转全部只是移动一个游标，不需要任何逆操作。

步骤快照 schema（前端渲染层唯一的数据来源）：
  {
    "seq":      int,                     # 步骤序号，从 0 开始
    "nodes":    [{"id","value","label"}],# 主链快照（顺序即逻辑顺序）
    "aside":    [{"id","value","label"}],# 暂离主链的结点（待插入 / 已摘下）
    "head":     "n1" | null,             # head 指针指向的结点 id
    "ptr":      {"p": id|null|"NULL", "prev": ..., "q": ..., "s": ...},
    "mark": {
      "compare":  [id...],               # 正在比较（琥珀）
      "visited":  [id...],               # 已访问（绿，粘性累计）
      "new":      [id...],               # 本次新建（蓝，粘性累计）
      "remove":   [id...]                # 待删除（红）
    },
    "line":     int|null,                # 高亮的代码行号（0 开始）
    "counters": {"visited":n,"moves":n,"compares":n},
    "info":     "当前操作的一句话中文解说"
  }
==========================================================================
"""

import itertools
from typing import Optional

# 为了投影可读性限制结点数（超出后文字缩得太小）
MAX_NODES = 12


class Node:
    """链表结点：value 数据域 + next 指针域；id 生成后永不变，前端靠它定位"""

    __slots__ = ("id", "value", "next")
    _seq = itertools.count(1)

    def __init__(self, value: int):
        self.id = f"n{next(Node._seq)}"
        self.value = value
        self.next: Optional["Node"] = None


class OpError(Exception):
    """业务错误：位序越界、找不到值、超过结点上限等。由路由层转成 code=1"""


# ==========================================================================
# Tracer —— 轨迹记录器
# 算法函数只调用 push()；ptr / aside / visited / new 都是「粘性」状态，
# 一步内不改就延续到下一步，减少重复样板。
# ==========================================================================

class Tracer:

    def __init__(self):
        self.steps: list = []
        self.visited = 0          # 已访问结点数
        self.moves = 0            # 指针移动次数
        self.compares = 0         # 比较次数
        self.ptr: dict = {}       # 指针名 -> Node | "NULL" | None
        self.aside: list = []     # 暂离主链的结点
        self._visited_ids: set = set()
        self._new_ids: set = set()

    # ---------- 内部工具 ----------

    @staticmethod
    def _chain(head: Optional[Node]) -> list:
        out, p, i = [], head, 1
        while p:
            out.append({"id": p.id, "value": p.value, "label": f"a{i}"})
            p = p.next
            i += 1
        return out

    @staticmethod
    def _flat(nodes: list) -> list:
        """aside 结点没有位序标签，用 s / q 之类记号由前端决定，这里给 label 留空"""
        return [{"id": n.id, "value": n.value, "label": None} for n in nodes]

    def _ptr_json(self) -> dict:
        out = {}
        for k, v in self.ptr.items():
            out[k] = v.id if isinstance(v, Node) else v
        return out

    def _mark(self, head: Optional[Node], compare, remove) -> dict:
        # visited / new 按链表顺序输出，aside 里的结点排在最后
        order, p = [], head
        while p:
            order.append(p.id)
            p = p.next
        for n in self.aside:
            order.append(n.id)

        def keep(ids):
            return [i for i in order if i in ids]

        return {
            "compare": keep(set(compare or ())),
            "visited": keep(self._visited_ids),
            "new": keep(self._new_ids),
            "remove": keep(set(remove or ())),
        }

    # ---------- 记录步骤 ----------

    def push(self, head: Optional[Node], line, info,
             compare=(), remove=(), ptr=None, aside=None) -> dict:
        """
        head    当前主链头结点（必传，快照从这里遍历）
        line    高亮代码行号（0 开始；None 表示不高亮）
        ptr     dict，与本步之前的粘性状态合并（传 None 值可显式清除）
        aside   list，替换暂离结点列表；不传则沿用上一步
        """
        if ptr:
            self.ptr.update(ptr)
        if aside is not None:
            self.aside = list(aside)

        snap = {
            "seq": len(self.steps),
            "nodes": self._chain(head),
            "aside": self._flat(self.aside),
            "head": head.id if head else None,
            "ptr": self._ptr_json(),
            "mark": self._mark(head, compare, remove),
            "line": line,
            "counters": {
                "visited": self.visited,
                "moves": self.moves,
                "compares": self.compares,
            },
            "info": info,
        }
        self.steps.append(snap)
        return snap


# ==========================================================================
# 操作元数据：代码行 + 结构性行 + 标题（前端伪代码面板直接渲染）
# ==========================================================================

OPS = {
    "build": {
        "title": "尾插法建表",
        "lines": [
            "head = NULL;",
            "s = malloc(...); s->data = x; s->next = NULL;",
            "tail->next = s;   // 空表时: head = s",
            "tail = s;",
        ],
        "structural": [0],
    },
    "insert-head": {
        "title": "头插法插入",
        "lines": [
            "s = (Node *)malloc(sizeof(Node));",
            "s->data = x;",
            "s->next = head;",
            "head = s;",
        ],
        "structural": [],
    },
    "insert-tail": {
        "title": "尾插法插入",
        "lines": [
            "s = (Node *)malloc(sizeof(Node));",
            "s->data = x;  s->next = NULL;",
            "if (head == NULL) { head = s; return; }",
            "p = head;",
            "while (p->next != NULL) p = p->next;",
            "p->next = s;",
        ],
        "structural": [],
    },
    "delete-pos": {
        "title": "按位序删除",
        "lines": [
            "if (pos < 1 || pos > n) error;",
            "if (pos == 1) { q = head; head = head->next; free(q); return; }",
            "p = head;",
            "for (i = 1; i < pos - 1; i++) p = p->next;   // 走到前驱",
            "q = p->next;",
            "p->next = q->next;      // 摘链：先接后，再释放",
            "free(q);",
        ],
        "structural": [],
    },
    "delete-value": {
        "title": "按值删除",
        "lines": [
            "prev = NULL;  p = head;",
            "while (p != NULL && p->data != x) {",
            "    prev = p;  p = p->next;",
            "}",
            "if (p == NULL) return NOT_FOUND;",
            "if (prev == NULL) head = p->next;",
            "else prev->next = p->next;",
            "free(p);",
        ],
        "structural": [],
    },
    "search": {
        "title": "按值查找",
        "lines": [
            "p = head;  pos = 1;",
            "while (p != NULL) {",
            "    if (p->data == x) return pos;",
            "    p = p->next;  pos++;",
            "}",
            "return -1;   // 未找到",
        ],
        "structural": [],
    },
    "traverse": {
        "title": "遍历链表",
        "lines": [
            "p = head;",
            "while (p != NULL) {",
            "    visit(p->data);",
            "    p = p->next;",
            "}",
        ],
        "structural": [],
    },
}


def _meta(op: str, head: Optional[Node]) -> dict:
    """组一条完整的返回体：元数据 + 轨迹 + 最终长度"""
    n, p = 0, head
    while p:
        n += 1
        p = p.next
    meta = OPS[op]
    return {
        "op": op,
        "title": meta["title"],
        "code": {"lines": meta["lines"], "structural": meta["structural"]},
        "length": n,
        "max_nodes": MAX_NODES,
        "trace": None,  # 由调用方填入 tracer.steps
    }


def _check_capacity(head: Optional[Node]):
    n, p = 0, head
    while p:
        n += 1
        p = p.next
    if n >= MAX_NODES:
        raise OpError(f"结点数已达上限 {MAX_NODES}，请先删除一些结点")


# ==========================================================================
# 六个操作。lst 是一个带 .head 属性的对象（见下方 TraceList）
# ==========================================================================

def op_build(lst, values: list) -> dict:
    """尾插法建表：head 从 NULL 开始，逐个接到尾部"""
    if len(values) > MAX_NODES:
        raise OpError(f"最多支持 {MAX_NODES} 个结点，收到 {len(values)} 个")

    t = Tracer()
    lst.head = None
    t.ptr = {"head": None}
    t.push(None, 0, "从空表开始：head = NULL")

    tail = None
    for x in values:
        s = Node(x)
        t._new_ids.add(s.id)
        t.aside = [s]
        t.ptr = {"s": s}
        t.push(lst.head, 1, f"申请新结点 s，写入数据 {x}，next 置为 NULL")

        if lst.head is None:
            lst.head = s
            t.aside = []
            t.ptr = {"head": s, "s": None}
            t.push(lst.head, 2, "链表为空：head 直接指向 s", compare=[s.id])
        else:
            tail.next = s
            t.aside = []
            t.ptr = {"s": None}
            t.push(lst.head, 2, f"尾结点的 next 接上 s（{tail.value} → {x}）", compare=[s.id])
        tail = s
        t.push(lst.head, 3, f"{x} 已入链，tail 后移", ptr={"tail": s})

    t.ptr = {"tail": None}
    t.push(lst.head, None, f"建表完成，共 {len(values)} 个结点")
    out = _meta("build", lst.head)
    out["trace"] = t.steps
    return out


def op_insert_head(lst, value: int) -> dict:
    """头插：s->next = head; head = s —— 顺序不能颠倒"""
    _check_capacity(lst.head)
    t = Tracer()
    old_head = lst.head

    s = Node(value)
    t._new_ids.add(s.id)
    t.aside = [s]
    t.ptr = {"s": s}
    t.push(lst.head, 0, "申请新结点 s（还没接入链表）")

    t.push(lst.head, 1, f"s->data = {value}")

    # 接链：s 进入主链，但 head 还没动 —— 这是本操作的教学重点
    s.next = old_head
    t.ptr = {"s": s}
    t.push(lst.head, 2,
           "s->next = head：s 已接上原链，但 head 还指着旧首元结点",
           compare=[s.id])

    lst.head = s
    t.aside = []
    t.ptr = {"s": None, "head": s}
    t.push(lst.head, 3, "head = s：头插完成，s 成为新的首元结点", compare=[s.id])

    t.push(lst.head, None, f"头插 {value} 完成，当前表长 {len(t.steps[-1]['nodes'])}")
    out = _meta("insert-head", lst.head)
    out["trace"] = t.steps
    return out


def op_insert_tail(lst, value: int) -> dict:
    """尾插：先沿 next 走到最后一个结点，再接上"""
    _check_capacity(lst.head)
    t = Tracer()

    s = Node(value)
    t._new_ids.add(s.id)
    t.aside = [s]
    t.ptr = {"s": s}
    t.push(lst.head, 0, "申请新结点 s，data 与 next 都已就绪")

    if lst.head is None:
        lst.head = s
        t.aside = []
        t.ptr = {"head": s, "s": None}
        t.push(lst.head, 2, "链表为空：head 直接指向 s", compare=[s.id])
    else:
        t.push(lst.head, 3, "p = head，从头开始找尾结点", ptr={"p": lst.head})
        p = lst.head
        while p.next is not None:
            nxt = p.next
            t.moves += 1
            t._visited_ids.add(p.id)
            t.ptr = {"p": nxt}
            t.push(lst.head, 4,
                   f"p->next 不为空，p 后移到第 {_pos_of(lst.head, nxt)} 个结点",
                   compare=[p.id], ptr={"p": nxt})
            p = nxt
        # p 已是尾结点：p->next 为 NULL
        t.push(lst.head, 4, "p->next == NULL：p 就是尾结点", compare=[p.id])

        p.next = s
        t.aside = []
        t.ptr = {"p": p, "s": None}
        t.push(lst.head, 5, f"p->next = s：{p.value} 接上 {value}", compare=[p.id, s.id])

    t.push(lst.head, None, f"尾插 {value} 完成，当前表长 {len(t.steps[-1]['nodes'])}")
    out = _meta("insert-tail", lst.head)
    out["trace"] = t.steps
    return out


def op_delete_pos(lst, pos: int) -> dict:
    """按位序删除：走到前驱（或直接动 head），摘链，再释放"""
    n, p = 0, lst.head
    while p:
        n += 1
        p = p.next
    if pos < 1 or pos > n:
        raise OpError(f"位序 {pos} 越界，当前链表长度为 {n}")

    t = Tracer()
    t.push(lst.head, None, f"删除第 {pos} 个结点：先找到它（或它的前驱）")

    if pos == 1:
        q = lst.head
        t.ptr = {"q": q, "head": lst.head}
        t.push(lst.head, 1, "pos = 1：删的是首元结点，q = head", compare=[q.id], remove=[q.id])

        lst.head = q.next
        t.ptr = {"q": q, "head": q.next}
        t.aside = [q]
        t.push(lst.head, 1, "head = head->next：head 越过 q，q 已离开主链",
               remove=[q.id])

        t.ptr = {"q": None}
        t.aside = []
        t.push(lst.head, 1, "free(q)：结点占用的内存归还系统")
    else:
        p = lst.head
        t.ptr = {"p": p}
        t.push(lst.head, 2, "p = head，准备走到前驱（第 pos-1 个结点）")
        for i in range(1, pos - 1):
            nxt = p.next
            t.moves += 1
            t._visited_ids.add(p.id)
            t.ptr = {"p": nxt}
            t.push(lst.head, 3, f"p 后移到第 {i + 1} 个结点", compare=[p.id])
            p = nxt
        t.push(lst.head, 3, f"p 停在前驱（第 {pos - 1} 个结点）", compare=[p.id])

        q = p.next
        t.ptr = {"p": p, "q": q}
        t.push(lst.head, 4, f"q = p->next：q 指向待删除的第 {pos} 个结点",
               compare=[p.id, q.id], remove=[q.id])

        p.next = q.next
        t.ptr = {"p": p, "q": q}
        t.aside = [q]
        t.push(lst.head, 5, "p->next = q->next：摘链完成，q 已离开主链",
               remove=[q.id])

        t.ptr = {"q": None}
        t.aside = []
        t.push(lst.head, 6, "free(q)：先摘链，再释放——顺序反了会丢掉后面的链")

    t.push(lst.head, None, f"删除完成，当前表长 {len(t.steps[-1]['nodes'])}")
    out = _meta("delete-pos", lst.head)
    out["trace"] = t.steps
    return out


def op_delete_value(lst, value: int) -> dict:
    """按值删除：prev / p 双指针同行，找到即摘链"""
    t = Tracer()

    prev, p = None, lst.head
    t.ptr = {"prev": None, "p": p}
    t.push(lst.head, 0, "prev = NULL，p = head，双指针开始找值")

    found = None
    pos = 1
    while p is not None:
        t.compares += 1
        if p.value == value:
            t.push(lst.head, 2, f"p->data == {value}：命中，是第 {pos} 个结点",
                   compare=[p.id], remove=[p.id])
            found = p
            break
        t._visited_ids.add(p.id)
        t.push(lst.head, 2, f"第 {pos} 个结点是 {p.value} ≠ {value}，继续",
               compare=[p.id])
        prev, p = p, p.next
        pos += 1
        t.moves += 1
        t.ptr = {"prev": prev, "p": p if p else "NULL"}
        t.push(lst.head, 3,
               "prev = p，p = p->next：双指针同步后移" if p else "p 已走到 NULL，链里没有这个值",
               ptr={"prev": prev, "p": p if p else "NULL"})

    if found is None:
        t.push(lst.head, 4, f"链表中不存在值为 {value} 的结点，删除失败")
        raise OpError(f"链表中不存在值为 {value} 的结点")

    if prev is None:
        lst.head = found.next
        t.ptr = {"prev": None, "p": found}
        t.aside = [found]
        t.push(lst.head, 5, "prev 为空：删的是首元结点，head = p->next",
               remove=[found.id])
    else:
        prev.next = found.next
        t.ptr = {"prev": prev, "p": found}
        t.aside = [found]
        t.push(lst.head, 6, "prev->next = p->next：摘链，p 离开主链",
               remove=[found.id])

    t.ptr = {"p": None}
    t.aside = []
    t.push(lst.head, 7, "free(p)：释放已摘下的结点")

    t.push(lst.head, None, f"删除值 {value} 完成，当前表长 {len(t.steps[-1]['nodes'])}")
    out = _meta("delete-value", lst.head)
    out["trace"] = t.steps
    return out


def op_search(lst, value: int) -> dict:
    """按值查找：p 沿 next 逐个比较；p 走到 NULL 即未找到"""
    t = Tracer()
    p = lst.head
    t.ptr = {"p": p}
    pos = 1
    t.push(lst.head, 0, f"p = head，从第 1 个结点开始找 {value}")

    while p is not None:
        t.compares += 1
        if p.value == value:
            t.push(lst.head, 2,
                   f"p->data == {value}：在第 {pos} 个结点找到，返回 {pos}",
                   compare=[p.id])
            t.push(lst.head, 2, f"查找成功：{value} 位于第 {pos} 个结点", compare=[p.id])
            out = _meta("search", lst.head)
            out["result"] = {"found": True, "pos": pos}
            out["trace"] = t.steps
            return out
        t._visited_ids.add(p.id)
        t.push(lst.head, 2, f"第 {pos} 个结点是 {p.value} ≠ {value}，继续",
               compare=[p.id])
        p = p.next
        pos += 1
        t.moves += 1
        t.ptr = {"p": p if p else "NULL"}
        t.push(lst.head, 3,
               f"p = p->next，走到第 {pos} 个" if p else "p = p->next，p 变成 NULL",
               ptr={"p": p if p else "NULL"})

    t.push(lst.head, 5, f"p 走到 NULL 仍未命中：返回 -1，链表中没有 {value}")
    out = _meta("search", lst.head)
    out["result"] = {"found": False, "pos": -1}
    out["trace"] = t.steps
    return out


def op_traverse(lst) -> dict:
    """遍历：逐个访问并收集"""
    t = Tracer()
    p = lst.head
    t.ptr = {"p": p}
    t.push(lst.head, 0, "p = head，从头开始遍历")

    seen = []
    while p is not None:
        seen.append(p.value)
        t._visited_ids.add(p.id)
        t.push(lst.head, 2, f"visit(p->data)：访问第 {len(seen)} 个结点，值 {p.value}",
               compare=[p.id])
        p = p.next
        t.moves += 1
        t.ptr = {"p": p if p else "NULL"}
        t.push(lst.head, 3,
               f"p = p->next" if p else "p = p->next，p 为 NULL，遍历结束",
               ptr={"p": p if p else "NULL"})

    if seen:
        done = "遍历完成：" + " → ".join(str(v) for v in seen) + " → NULL"
    else:
        done = "空表，无结点可访问"
    t.push(lst.head, None, done)
    out = _meta("traverse", lst.head)
    out["result"] = {"values": seen}
    out["trace"] = t.steps
    return out


# ==========================================================================
# 会话里的链表容器 + 工具
# ==========================================================================

class TraceList:
    """只带一个 head 指针的链表（轨迹由各 op_* 函数生成）"""

    def __init__(self, values=None):
        self.head: Optional[Node] = None
        for v in (values or []):
            self._append_raw(v)

    def _append_raw(self, value: int):
        node = Node(value)
        if self.head is None:
            self.head = node
            return
        p = self.head
        while p.next:
            p = p.next
        p.next = node

    def to_nodes(self) -> list:
        return Tracer._chain(self.head)

    def length(self) -> int:
        n, p = 0, self.head
        while p:
            n += 1
            p = p.next
        return n


def state_payload(lst: TraceList) -> dict:
    """无轨迹的当前状态（供前端对齐 / 快速自检）"""
    return {
        "op": "state",
        "length": lst.length(),
        "max_nodes": MAX_NODES,
        "nodes": lst.to_nodes(),
        "trace": [],
    }


def _pos_of(head: Optional[Node], target: Node) -> int:
    i, p = 1, head
    while p:
        if p is target:
            return i
        p = p.next
        i += 1
    return -1
