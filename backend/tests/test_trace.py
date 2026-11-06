"""
tests/test_trace.py —— 轨迹生成器的纯逻辑测试（无网络、无 FastAPI 依赖）
运行：python tests/test_trace.py
"""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from algo.linkedlist_trace import (
    MAX_NODES,
    OpError,
    TraceList,
    op_build,
    op_delete_pos,
    op_delete_value,
    op_insert_head,
    op_insert_tail,
    op_search,
    op_traverse,
)

PASS = 0


def check(cond, msg):
    global PASS
    if not cond:
        raise AssertionError("失败: " + msg)
    PASS += 1


def values(lst):
    out, p = [], lst.head
    while p:
        out.append(p.value)
        p = p.next
    return out


def validate_trace(res, lst):
    """每条轨迹都要满足的结构合法性"""
    code = res["code"]
    nlines = len(code["lines"])
    for st in res["trace"]:
        ids = [n["id"] for n in st["nodes"]]
        check(len(ids) == len(set(ids)), "主链无重复结点")
        aside_ids = [n["id"] for n in st["aside"]]
        check(not (set(ids) & set(aside_ids)), "aside 与主链不重叠")
        check(
            st["nodes"][0]["id"] == st["head"] if st["nodes"] else st["head"] is None,
            "head 指向主链第一个结点",
        )
        for name, tgt in st["ptr"].items():
            check(
                tgt is None or tgt == "NULL" or tgt in ids or tgt in aside_ids,
                f"指针 {name} 指向存在的结点 ({tgt})",
            )
        for group in st["mark"].values():
            for i in group:
                check(i in ids or i in aside_ids, "高亮 id 存在")
        check(
            st["line"] is None or 0 <= st["line"] < nlines,
            f"代码行号不越界 (line={st['line']})",
        )
        labels = [n["label"] for n in st["nodes"]]
        check(
            labels == [f"a{i}" for i in range(1, len(labels) + 1)],
            "位序标签 a1..an 连续",
        )
    check(res["length"] == lst.length(), "返回体 length 与链表一致")
    # P-009：旧版把 `A == 派生自 A 的推导式` 当等价检查，是永真式；
    # 现在直接对比 TraceList.to_nodes() 快照，与随机压力段(见下方)保持一致。
    check(res["trace"][-1]["nodes"] == lst.to_nodes(), "最后一步的快照等于链表现状")


# --------------------------------------------------------------------------
def main():
    random.seed(42)

    # 1. 建表
    lst = TraceList()
    res = op_build(lst, [3, 1, 4, 1, 5])
    validate_trace(res, lst)
    check(values(lst) == [3, 1, 4, 1, 5], "建表后的值序列")
    check(res["trace"][0]["nodes"] == [], "第一步是空表")
    check(res["trace"][-1]["info"].startswith("建表完成"), "最后一步是完成提示")
    print("build          OK")

    # 2. 头插
    res = op_insert_head(lst, 7)
    validate_trace(res, lst)
    check(values(lst) == [7, 3, 1, 4, 1, 5], "头插后 head 是新结点")
    aside_steps = [s for s in res["trace"] if s["aside"]]
    check(len(aside_steps) >= 2, "新结点先出现在暂存区")
    check(res["trace"][-1]["nodes"][0]["value"] == 7, "最后一步新结点在链首")
    print("insert-head    OK")

    # 3. 尾插（验证 p 走到尾结点）
    res = op_insert_tail(lst, 9)
    validate_trace(res, lst)
    check(values(lst)[-1] == 9, "尾插后 9 在末尾")
    walk = [s for s in res["trace"] if s["ptr"].get("p")]
    check(len(walk) >= 4, "尾插至少走了 4 步（申请+p=head+逐步后移+接链）")
    print("insert-tail    OK")

    # 4. 按位删除（删中间）
    before = values(lst)
    res = op_delete_pos(lst, 3)
    validate_trace(res, lst)
    expect = before[:2] + before[3:]
    check(values(lst) == expect, "按位删除后序列正确")
    # 摘链那一刻：被删结点应出现在 aside 且带 remove 标记
    unlink = [
        s for s in res["trace"] if any(n["value"] == before[2] for n in s["aside"])
    ]
    check(len(unlink) >= 1, "被删结点先离开主链进暂存区，再被释放")
    print("delete-pos     OK")

    # 5. 删首元
    before = values(lst)
    res = op_delete_pos(lst, 1)
    validate_trace(res, lst)
    check(values(lst) == before[1:], "删首元后 head 后移")
    print("delete-pos #1  OK")

    # 6. 按值删除（命中 + 未命中）
    lst2 = TraceList()
    op_build(lst2, [5, 2, 8, 2])
    res = op_delete_value(lst2, 2)
    validate_trace(res, lst2)
    check(values(lst2) == [5, 8, 2], "按值删除只删第一个命中")
    try:
        op_delete_value(lst2, 999)
        check(False, "未命中应抛 OpError")
    except OpError:
        check(True, "未命中抛 OpError")
    print("delete-value   OK")

    # 7. 查找（命中 / 未命中）
    lst3 = TraceList()
    op_build(lst3, [10, 20, 30])
    res = op_search(lst3, 20)
    check(res["result"] == {"found": True, "pos": 2}, "查找命中位序")
    check(
        any(s["ptr"].get("p") == "NULL" for s in res["trace"]) is False,
        "命中时 p 不应走到 NULL",
    )
    res = op_search(lst3, 99)
    check(res["result"] == {"found": False, "pos": -1}, "未命中返回 -1")
    check(
        any(s["ptr"].get("p") == "NULL" for s in res["trace"]), "未命中时 p 走到 NULL"
    )
    validate_trace(res, lst3)
    print("search         OK")

    # 8. 遍历
    res = op_traverse(lst3)
    validate_trace(res, lst3)
    check(res["result"]["values"] == [10, 20, 30], "遍历收集的值")
    print("traverse       OK")

    # 9. 越界与容量
    try:
        op_delete_pos(lst3, 9)
        check(False, "越界应抛 OpError")
    except OpError:
        check(True, "越界抛 OpError")
    big = TraceList(list(range(MAX_NODES)))
    try:
        op_insert_head(big, -1)
        check(False, "超容量应抛 OpError")
    except OpError:
        check(True, "超容量抛 OpError")
    try:
        op_build(TraceList(), list(range(MAX_NODES + 1)))
        check(False, "建表超容量应抛 OpError")
    except OpError:
        check(True, "建表超容量抛 OpError")
    print("bounds         OK")

    # 10. 随机压力：连续操作后链表与最后一步快照始终一致
    lst4 = TraceList()
    op_build(lst4, [1, 2, 3])
    for _ in range(60):
        op_kind = random.choice(["ih", "it", "dp", "dv", "sv", "tv"])
        cur = values(lst4)
        try:
            if op_kind == "ih":
                v = random.randint(0, 99)
                r = op_insert_head(lst4, v)
                expect = [v] + cur
            elif op_kind == "it":
                v = random.randint(0, 99)
                r = op_insert_tail(lst4, v)
                expect = cur + [v]
            elif op_kind == "dp":
                if not cur:
                    continue
                pos = random.randint(1, len(cur))
                r = op_delete_pos(lst4, pos)
                expect = cur[: pos - 1] + cur[pos:]
            elif op_kind == "dv":
                if not cur:
                    continue
                v = random.choice(cur)
                r = op_delete_value(lst4, v)
                i = cur.index(v)
                expect = cur[:i] + cur[i + 1 :]
            elif op_kind == "sv":
                r = op_search(lst4, random.randint(0, 99))
                continue
            else:
                r = op_traverse(lst4)
                continue
        except OpError:
            continue
        # 最后一步的主链必须等于真实链表
        check(
            r["trace"][-1]["nodes"] == lst4.to_nodes(),
            f"随机 {op_kind} 后最后一步快照 == 真实链表",
        )
        check(values(lst4) == expect, f"随机 {op_kind} 值序列正确")
    print("random 60 ops  OK")

    print(f"\n全部通过：{PASS} 项断言")


if __name__ == "__main__":
    main()
