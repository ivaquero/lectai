#!/usr/bin/env python
"""栈 / 队列轨迹引擎断言测试（纯标准库，不需要 pytest）

运行：
    python tests/test_stackqueue_trace.py
"""

import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from algo import queue_trace as Q
from algo import stack_trace as S

passed = 0
failed = 0


def ok(cond, label):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("  ✗ " + label)


def section(t):
    print("\n== " + t + " ==")


# --------------------------- 通用快照校验 ---------------------------


def check_trace(trace, op, label):
    """每一步的 schema 与不变式"""
    ok(isinstance(trace, list) and len(trace) > 0, f"{label} 轨迹非空")
    prev_seq = -1
    for s in trace:
        ok(s["seq"] == prev_seq + 1, f"{label} 步骤 seq 连续")
        prev_seq = s["seq"]
        ok(isinstance(s["items"], list), f"{label} items 是列表")
        ok(isinstance(s["aside"], list), f"{label} aside 是列表")
        ok(isinstance(s["mark"], dict), f"{label} mark 是字典")
        for k in ("compare", "visited", "new", "remove"):
            ok(isinstance(s["mark"].get(k), list), f"{label} mark.{k} 是列表")
        ok(isinstance(s["counters"], dict), f"{label} counters 存在")
        ok(isinstance(s["info"], str) and s["info"], f"{label} info 非空")
        ok(
            s["line"] is None or (isinstance(s["line"], int) and s["line"] >= 0),
            f"{label} line 合法",
        )
        # 高亮/标记引用的 id 必须能在 items + aside 里找到
        pool = {i["id"] for i in s["items"]} | {i["id"] for i in s["aside"]}
        for k in ("compare", "visited", "new", "remove"):
            for i in s["mark"][k]:
                ok(i in pool, f"{label} mark.{k} 的 id 可见")
        # ptr 指向的 id 同样必须可见（或为 NULL）
        for k, v in (s.get("ptr") or {}).items():
            ok(v is None or v == "NULL" or v in pool, f"{label} ptr.{k} 指向可见")
    ok(op["trace"] is trace, f"{label} 返回体挂了同一条轨迹")
    ok(
        isinstance(op.get("code", {}).get("lines"), list)
        and len(op["code"]["lines"]) > 0,
        f"{label} 带 C 代码",
    )


# ============================== 栈 ==============================

section("栈 · 建栈与入栈")

st = S.TraceStack()
out = S.op_build(st, [4, 8, 15])
check_trace(out["trace"], out, "build")
ok(st.length() == 3, "建栈后长度为 3")
ok(st.values() == [4, 8, 15], "建栈后序列正确（栈底→栈顶）")
ok(out["trace"][-1]["items"][-1]["value"] == 15, "最后一步栈顶是 15")
ok(out["trace"][0]["ptr"].get("top") in (None, "NULL"), "第一步 top 为空")

out = S.op_push(st, 42)
check_trace(out["trace"], out, "push")
ok(st.values() == [4, 8, 15, 42], "入栈后 42 在栈顶")
ok(out["result"]["value"] == 42, "push 结果带回 42")
ok(
    any(s["ptr"].get("x") == s["aside"][0]["id"] for s in out["trace"] if s["aside"]),
    "入栈过程中 x 指向待入栈元素",
)

section("栈 · 出栈（LIFO）")

out = S.op_pop(st)
check_trace(out["trace"], out, "pop")
ok(out["result"]["value"] == 42, "出栈返回的是最后入栈的 42")
ok(st.values() == [4, 8, 15], "出栈后序列恢复")
ok(any(s["mark"]["remove"] for s in out["trace"]), "出栈过程有红色待删标记")

out = S.op_peek(st)
check_trace(out["trace"], out, "peek")
ok(out["result"]["value"] == 15, "peek 读到栈顶 15")
ok(st.length() == 3, "peek 不改变栈长度")

out = S.op_traverse(st)
check_trace(out["trace"], out, "traverse")
ok(out["result"]["values"] == [15, 8, 4], "栈的遍历是栈顶 → 栈底")

section("栈 · 边界")

empty = S.TraceStack()
try:
    S.op_pop(empty)
    ok(False, "空栈出栈应报错")
except S.OpError as e:
    ok("栈空" in str(e), "空栈出栈抛 OpError：" + str(e))
try:
    S.op_peek(empty)
    ok(False, "空栈 peek 应报错")
except S.OpError:
    ok(True, "空栈 peek 抛 OpError")

full = S.TraceStack(list(range(S.MAX_ITEMS)))
try:
    S.op_push(full, 99)
    ok(False, "栈满入栈应报错")
except S.OpError as e:
    ok("栈满" in str(e), "栈满入栈抛 OpError：" + str(e))

section("栈 · 随机不变式（60 次）")

rnd = random.Random(7)
st = S.TraceStack()
model = []
for _ in range(60):
    if model and rnd.random() < 0.45:
        out = S.op_pop(st)
        check_trace(out["trace"], out, "rand-pop")
        ok(out["result"]["value"] == model.pop(), "随机出栈满足 LIFO")
    else:
        if len(model) >= S.MAX_ITEMS:
            continue
        v = rnd.randint(0, 99)
        out = S.op_push(st, v)
        check_trace(out["trace"], out, "rand-push")
        model.append(v)
    ok(st.values() == model, "随机操作后栈内序列与模型一致")
    # 每一步的 items 长度不超过真实长度 + 1（允许"写入中"的快照）
    for s in out["trace"]:
        ok(len(s["items"]) <= len(model) + 1, "快照 items 长度合理")

# ============================== 队列 ==============================

section("队列 · 建队与入队")

q = Q.TraceQueue()
out = Q.op_build(q, [4, 8, 15])
check_trace(out["trace"], out, "q-build")
ok(q.values() == [4, 8, 15], "建队后序列正确（队头→队尾）")
ok(out["trace"][0]["ptr"].get("front") in (None, "NULL"), "第一步 front 为空")

out = Q.op_enqueue(q, 42)
check_trace(out["trace"], out, "enqueue")
ok(q.values() == [4, 8, 15, 42], "入队后 42 在队尾")
ok(out["result"]["value"] == 42, "enqueue 结果带回 42")

section("队列 · 出队（FIFO）")

out = Q.op_dequeue(q)
check_trace(out["trace"], out, "dequeue")
ok(out["result"]["value"] == 4, "出队返回最早入队的 4")
ok(q.values() == [8, 15, 42], "出队后序列正确")
ok(any(s["mark"]["remove"] for s in out["trace"]), "出队过程有红色待删标记")

out = Q.op_peek(q)
check_trace(out["trace"], out, "q-peek")
ok(out["result"]["value"] == 8, "peek 读到队头 8")
ok(q.length() == 3, "peek 不改变队列长度")

out = Q.op_traverse(q)
check_trace(out["trace"], out, "q-traverse")
ok(out["result"]["values"] == [8, 15, 42], "队列遍历是队头 → 队尾")

section("队列 · 边界")

empty = Q.TraceQueue()
for fn, name in ((Q.op_dequeue, "空队出队"), (Q.op_peek, "空队 peek")):
    try:
        fn(empty)
        ok(False, name + " 应报错")
    except Q.OpError:
        ok(True, name + " 抛 OpError")

full = Q.TraceQueue(list(range(Q.CAPACITY - 1)))
try:
    Q.op_enqueue(full, 99)
    ok(False, "队满入队应报错")
except Q.OpError as e:
    ok("队满" in str(e), "队满入队抛 OpError：" + str(e))
ok(full.ring()["full"] is True, "环形缓冲标记为满")

section("队列 · 随机不变式（60 次）")

rnd = random.Random(11)
q = Q.TraceQueue()
model = []
for _ in range(60):
    if model and rnd.random() < 0.45:
        out = Q.op_dequeue(q)
        check_trace(out["trace"], out, "rand-dequeue")
        ok(out["result"]["value"] == model.pop(0), "随机出队满足 FIFO")
    else:
        if len(model) >= Q.CAPACITY - 1:
            continue
        v = rnd.randint(0, 99)
        out = Q.op_enqueue(q, v)
        check_trace(out["trace"], out, "rand-enqueue")
        model.append(v)
    ok(q.values() == model, "随机操作后队列与模型一致")

print("\n========================================")
print(
    "全部通过：%d 项断言" % passed
    if not failed
    else "通过 %d 项，失败 %d 项" % (passed, failed)
)
sys.exit(1 if failed else 0)
