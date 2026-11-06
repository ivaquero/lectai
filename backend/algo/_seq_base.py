"""
algo/_seq_base.py —— 顺序结构（栈 / 循环队列）轨迹生成器的公共底座
==========================================================================
背景：栈与队列都是"受限的线性表"，主结构用一维 items（栈：栈底→栈顶；
队列：队头→队尾），轨迹记录逻辑几乎完全同构。这里把两者共享的东西收拢到
一处，避免 stack_trace.py / queue_trace.py 各写一份：

  * OpError          —— 满/空业务异常，路由层转成 code=1
  * SeqTracer        —— 步骤快照记录器（含"粘性指针"修复，见下）
  * seq_meta         —— 组装 {op,title,code,length,max_nodes,trace}
  * seq_state_payload —— 无轨迹的当前状态快照

★ 粘性指针（P-003）：
  上层操作习惯整本字典重赋 `t.ptr = {"x": item}`，这会顺手抹掉上一快照里
  的 top / front / rear，导致这些指针标签"闪一下没了、下一步又回来"。
  链表侧靠 self.ptr["head"]=head 逐键赋值规避；这里等价地引入 anchor_keys：
  SeqTracer 在每次 push 前把缺失的锚点键用"最近一次看到的值"回填（没有就
  用 "NULL"），指针语义与逐键赋值一致，却无需改动各 op_* 主体。
==========================================================================
"""


class OpError(Exception):
    """业务错误：栈满 / 队空等。由路由层转成 code=1（HTTP 仍为 200）"""


# ==========================================================================
# SeqTracer —— 顺序结构（栈 / 队列）通用的轨迹记录器
# ==========================================================================


class SeqTracer:
    """记录一串步骤快照。

    anchor_keys：需要"粘性保持"的指针名（栈=("top",)；队列=("front","rear")）。
    这些键即便在某次 `t.ptr = {...}` 整体重赋时被漏掉，也会在 push 时按最近
    一次出现过的值自动回填，避免前端指针标签闪烁。
    """

    def __init__(self, anchor_keys=()):
        self.steps: list = []
        self.visited = 0
        self.moves = 0
        self.compares = 0
        self.ptr: dict = {}
        self.aside: list = []
        self._visited_ids: set = set()
        self._new_ids: set = set()
        self.anchor_keys: tuple = tuple(anchor_keys)
        self._anchor_last: dict = {}

    @staticmethod
    def _flat(items) -> list:
        """按容器既有顺序编号 a1, a2, ...（栈：栈底→栈顶；队列：队头→队尾）"""
        return [
            {"id": it.id, "value": it.value, "label": f"a{i + 1}"}
            for i, it in enumerate(items)
        ]

    @staticmethod
    def _aside_flat(items) -> list:
        return [{"id": it.id, "value": it.value, "label": None} for it in items]

    def _ptr_json(self) -> dict:
        # 鸭子类型判断（栈 / 队列各自持有不同 Item 类），只看有没有 .id
        out = {}
        for k, v in self.ptr.items():
            out[k] = v.id if hasattr(v, "id") else v
        return out

    def _mark(self, items, compare=(), remove=()) -> dict:
        order = [it.id for it in items] + [it.id for it in self.aside]

        def keep(ids):
            return [i for i in order if i in ids]

        return {
            "compare": keep(set(compare or ())),
            "visited": keep(self._visited_ids),
            "new": keep(self._new_ids),
            "remove": keep(set(remove or ())),
        }

    def _reconcile_anchors(self) -> None:
        """补齐被整体重赋 ptr 时漏掉的锚点键（粘性回填）。

        - 键存在且非 None：记住它（Item 或 "NULL" 都算有效锚点值，空结构时
          top/front/rear 就是 "NULL"，后续步骤应如实保持 "NULL"）。
        - 键缺失：用最近一次记住的值回填；从没出现过则用 "NULL"。
        """
        for k in self.anchor_keys:
            if k in self.ptr:
                if self.ptr[k] is not None:
                    self._anchor_last[k] = self.ptr[k]
            else:
                self.ptr[k] = self._anchor_last.get(k, "NULL")

    def push(
        self, items, line, info, compare=(), remove=(), ptr=None, aside=None
    ) -> dict:
        if ptr is not None:
            self.ptr.update({k: v for k, v in ptr.items()})
        if aside is not None:
            self.aside = list(aside)
        self._reconcile_anchors()
        snap = {
            "seq": len(self.steps),
            "items": self._flat(items),
            "aside": self._aside_flat(self.aside),
            "ptr": self._ptr_json(),
            "mark": self._mark(items, compare, remove),
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
# 共享组装器（P-007：栈 / 队列原本各写一份，这里统一）
# ==========================================================================


def seq_meta(OPS: dict, op: str, n: int, max_nodes: int) -> dict:
    """元数据 + 空 trace 骨架；调用方随后填入 trace / result。"""
    meta = OPS[op]
    return {
        "op": op,
        "title": meta["title"],
        "code": {"lines": meta["lines"], "structural": meta["structural"]},
        "length": n,
        "max_nodes": max_nodes,
        "trace": None,
    }


def seq_state_payload(container, max_nodes: int, extra: dict | None = None) -> dict:
    """无轨迹的当前状态（首屏对齐 / 快速自检）。

    extra：队列会传 {"ring": q.ring()} 之类附加字段并入。
    """
    payload = {
        "op": "state",
        "length": container.length(),
        "max_nodes": max_nodes,
        "items": container.to_items(),
        "trace": [],
    }
    if extra:
        payload.update(extra)
    return payload
