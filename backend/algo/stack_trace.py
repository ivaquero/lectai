"""
algo/stack_trace.py —— 顺序栈「步骤轨迹」生成器
==========================================================================
与 linkedlist_trace.py 同构：算法跑完，产出一串步骤快照；前端只负责按游标
回放，因此暂停 / 单步 / 回退都不需要逆操作。

差异点：栈是"受限的线性表"，主结构用 items（栈底 → 栈顶）而不是 nodes/head，
指针只有 top。

步骤快照 schema（前端渲染层唯一的数据来源）：
  {
    "seq":      int,                      # 步骤序号，从 0 开始
    "items":    [{"id","value","label"}], # 栈内元素，顺序为「栈底 → 栈顶」
    "aside":    [{"id","value","label"}], # 暂离栈的元素（待入栈的 x / 已弹出的 x）
    "ptr":      {"top": id|"NULL", "x": id|null},
    "mark": {"compare":[id], "visited":[id], "new":[id], "remove":[id]},
    "line":     int|null,                 # 高亮代码行（0 开始）
    "counters": {"visited":n,"moves":n,"compares":n},
    "info":     "一句话中文解说"
  }
==========================================================================
"""

import itertools

from ._seq_base import OpError, SeqTracer, seq_meta, seq_state_payload

# 教学演示容量：太大了画布装不下
MAX_ITEMS = 10

# 栈只有 top 一个结构指针，交给 SeqTracer 做粘性保持（P-003）
_ANCHORS = ("top",)


class Item:
    """栈内元素：id 生成后不变，前端靠它做高亮定位"""

    __slots__ = ("id", "value")
    _seq = itertools.count(1)

    def __init__(self, value: int):
        self.id = f"k{next(Item._seq)}"
        self.value = value


# ==========================================================================
# 操作元数据：C 代码行 + 结构性行
# ==========================================================================

OPS = {
    "build": {
        "title": "建栈（逐个入栈）",
        "lines": [
            "S.top = -1;                               // 空栈",
            "for each x in 输入序列:",
            "    if (S.top == MaxSize - 1) return ERROR;",
            "    S.data[++S.top] = x;                  // 指针先加一再写入",
        ],
        "structural": [0],
    },
    "push": {
        "title": "入栈 push",
        "lines": [
            "if (S.top == MaxSize - 1) return ERROR;   // 栈满，无法入栈",
            "S.top++;                                  // ① 栈顶指针先上移",
            "S.data[S.top] = x;                        // ② 再写入元素",
            "return OK;",
        ],
        "structural": [],
    },
    "pop": {
        "title": "出栈 pop",
        "lines": [
            "if (S.top == -1) return ERROR;            // 栈空，无法出栈",
            "x = S.data[S.top];                        // ① 先取栈顶元素",
            "S.top--;                                  // ② 指针再下移",
            "return x;",
        ],
        "structural": [],
    },
    "peek": {
        "title": "读栈顶 peek",
        "lines": [
            "if (S.top == -1) return ERROR;            // 栈空",
            "return S.data[S.top];                     // 只读，top 不动",
        ],
        "structural": [],
    },
    "traverse": {
        "title": "遍历（自栈顶向下）",
        "lines": [
            "for (i = S.top; i >= 0; i--)",
            "    visit(S.data[i]);                     // 从栈顶往栈底",
        ],
        "structural": [],
    },
}


def _meta(op: str, n: int) -> dict:
    """薄封装：绑定栈的 OPS 表与容量，实际组装在 _seq_base.seq_meta"""
    return seq_meta(OPS, op, n, MAX_ITEMS)


# ==========================================================================
# 容器
# ==========================================================================


class TraceStack:
    """顺序栈：items[0] 是栈底，items[-1] 是栈顶"""

    def __init__(self, values=None):
        self.items: list = []
        for v in values or []:
            self.items.append(Item(v))

    def top(self):
        return self.items[-1] if self.items else None

    def length(self) -> int:
        return len(self.items)

    def values(self) -> list:
        return [it.value for it in self.items]

    def to_items(self) -> list:
        return SeqTracer._flat(self.items)


# ==========================================================================
# 操作：每个函数跑完算法并返回 {meta + trace}
# ==========================================================================


def op_build(st: TraceStack, values: list) -> dict:
    if len(values) > MAX_ITEMS:
        raise OpError(f"最多支持 {MAX_ITEMS} 个元素，收到 {len(values)} 个")

    t = SeqTracer(anchor_keys=_ANCHORS)
    st.items = []
    t.ptr = {"top": "NULL", "x": None}
    t.push(st.items, 0, "初始化：S.top = -1，空栈")

    for x in values:
        item = Item(x)
        t._new_ids.add(item.id)
        t.ptr = {"x": item}
        t.push(st.items, 1, f"准备入栈：x = {x}", aside=[item])
        t.compares += 1
        t.push(
            st.items,
            2,
            f"栈未满（top = {len(st.items) - 1}，容量 {MAX_ITEMS}）",
            compare=[item.id],
        )
        st.items.append(item)
        t.moves += 1
        t.ptr = {"top": item, "x": None}
        t.push(st.items, 3, f"S.data[++S.top] = {x}：{x} 成为新栈顶", compare=[item.id])
        t.aside = []
        t.push(
            st.items,
            3,
            f"入栈完成，当前栈：{st.values()}（右端为栈顶）",
            ptr={"x": None},
        )

    out = _meta("build", st.length())
    out["result"] = {"values": st.values()}
    out["trace"] = t.steps
    return out


def op_push(st: TraceStack, value: int) -> dict:
    if st.length() >= MAX_ITEMS:
        raise OpError(f"栈满：已达上限 {MAX_ITEMS} 个元素，请先出栈")

    t = SeqTracer(anchor_keys=_ANCHORS)
    item = Item(value)
    t._new_ids.add(item.id)

    t.ptr = {"top": st.top(), "x": item}
    t.push(st.items, 0, f"准备入栈：x = {value}", aside=[item])
    t.compares += 1
    t.push(
        st.items,
        0,
        f"检查栈满：top = {st.length() - 1} < {MAX_ITEMS - 1}，未满",
        compare=[item.id],
    )

    # ① 指针上移
    t.moves += 1
    t.ptr = {"top": item, "x": item}
    t.push(st.items, 1, "S.top++：栈顶指针先上移一格", compare=[item.id])

    # ② 写入
    st.items.append(item)
    t.ptr = {"top": item, "x": None}
    t.push(st.items, 2, f"S.data[S.top] = {value}：写入新栈顶", compare=[item.id])
    t.aside = []
    t.push(st.items, 3, f"入栈完成，当前栈：{st.values()}（右端为栈顶）")

    out = _meta("push", st.length())
    out["result"] = {"value": value, "values": st.values()}
    out["trace"] = t.steps
    return out


def op_pop(st: TraceStack) -> dict:
    if not st.items:
        raise OpError("栈空，无法出栈")

    t = SeqTracer(anchor_keys=_ANCHORS)
    top = st.top()
    t.ptr = {"top": top, "x": None}
    t.push(st.items, 0, f"准备出栈：当前栈顶 = {top.value}")
    t.compares += 1
    t.push(st.items, 0, "检查栈空：top != -1，栈非空", compare=[top.id])

    # ① 取出
    t.ptr = {"top": top, "x": top}
    t.push(st.items, 1, f"x = S.data[S.top]：取到栈顶元素 {top.value}", remove=[top.id])

    # ② 指针下移（元素仍在数组里，但已不在栈内 —— 这是"假删除"）
    st.items.pop()
    t.moves += 1
    new_top = st.top()
    t.ptr = {"top": new_top if new_top else "NULL", "x": top}
    t.push(
        st.items,
        2,
        f"S.top--：{'栈已空，top = -1' if new_top is None else f'新栈顶为 {new_top.value}'}",
        aside=[top],
        remove=[top.id],
    )

    t.aside = []
    t.ptr = {"top": new_top if new_top else "NULL", "x": None}
    t.push(st.items, 3, f"出栈完成，返回 {top.value}；当前栈：{st.values()}")

    out = _meta("pop", st.length())
    out["result"] = {"value": top.value, "values": st.values()}
    out["trace"] = t.steps
    return out


def op_peek(st: TraceStack) -> dict:
    if not st.items:
        raise OpError("栈空，读不到栈顶")

    t = SeqTracer(anchor_keys=_ANCHORS)
    top = st.top()
    t.ptr = {"top": top, "x": None}
    t.push(st.items, 0, "检查栈空：top != -1，栈非空", compare=[top.id])
    t.compares += 1
    t.push(
        st.items,
        1,
        f"return S.data[S.top]：栈顶是 {top.value}；top 指针不动",
        compare=[top.id],
    )

    out = _meta("peek", st.length())
    out["result"] = {"value": top.value}
    out["trace"] = t.steps
    return out


def op_traverse(st: TraceStack) -> dict:
    t = SeqTracer(anchor_keys=_ANCHORS)
    if not st.items:
        t.ptr = {"top": "NULL"}
        t.push(st.items, None, "空栈，没有可访问的元素")
        out = _meta("traverse", 0)
        out["result"] = {"values": []}
        out["trace"] = t.steps
        return out

    seen = []
    for i in range(len(st.items) - 1, -1, -1):
        it = st.items[i]
        t.visited += 1
        t._visited_ids.add(it.id)
        t.ptr = {"top": st.top(), "x": it}
        t.push(
            st.items,
            0,
            f"i = {i}：从栈顶往栈底数第 {len(seen) + 1} 个",
            compare=[it.id],
        )
        seen.append(it.value)
        t.moves += 1
        t.push(st.items, 1, f"visit(S.data[{i}])：访问到 {it.value}", compare=[it.id])

    t.ptr = {"top": st.top(), "x": None}
    t.push(
        st.items, None, f"遍历完成（栈顶 → 栈底）：{' → '.join(str(v) for v in seen)}"
    )

    out = _meta("traverse", st.length())
    out["result"] = {"values": seen}
    out["trace"] = t.steps
    return out


def state_payload(st: TraceStack) -> dict:
    """无轨迹的当前状态（首屏对齐 / 快速自检）"""
    return seq_state_payload(st, MAX_ITEMS)
