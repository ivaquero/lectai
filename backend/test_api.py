"""
后端接口自动测试脚本（无第三方依赖，仅用标准库 urllib）
用法：先启动服务，再运行  uv run python test_api.py

覆盖点
  · P-002：§3 兼容层已删除，链表/栈/队列一律走 /trace/* 步骤轨迹接口断言。
  · P-003：顺带校验轨迹每一步的指针完整性（head / top / front /rear 不闪烁）。
  · P-008：开跑前先执行 tools/gen_offline_data.py --check，离线快照漂移即判失败。
  · P-003(前端同源)：quiz/ai 响应必须带 *_content_type 字段。
"""

import json
import os
import subprocess
import sys
import urllib.request

BASE = os.environ.get("LECTAI_BASE", "http://127.0.0.1:8000")
HEADERS = {"Content-Type": "application/json", "X-Session-Id": "test-session"}

PASS, FAIL = 0, 0

# 从仓库数据文件读取期望值，避免每次加题都改测试
_HERE = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(_HERE, "data", "questions.json"), "r", encoding="utf-8") as _f:
    _QBANK = json.load(_f)
CATEGORY_COUNTS = {k: len(v.get("questions", [])) for k, v in _QBANK.items()}
TOTAL_QUESTIONS = sum(CATEGORY_COUNTS.values())
NUM_CATEGORIES = len(CATEGORY_COUNTS)


def call(method: str, path: str, body: dict | None = None, expect_code: int = 0):
    """发请求并断言响应 code 字段"""
    global PASS, FAIL
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers=HEADERS,
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        print(f"  ✗ {method} {path} -> 请求异常: {e}")
        FAIL += 1
        return None

    tag = "✓" if result.get("code") == expect_code else "✗"
    if tag == "✓":
        PASS += 1
    else:
        FAIL += 1
    print(
        f"  {tag} {method:6s} {path:34s} code={result.get('code')} msg={result.get('msg', '')[:46]}"
    )
    return result


def assert_ptrs(result, keys, label):
    """P-003：轨迹每一步的 ptr 必须始终携带全部锚点键，否则指针标签会闪烁。"""
    global PASS, FAIL
    steps = (result or {}).get("data", {}).get("trace") or []
    bad = [
        s.get("seq")
        for s in steps
        if not all(k in (s.get("ptr") or {}) for k in keys)
    ]
    if bad:
        FAIL += 1
        print(f"  ✗ {label}：{len(bad)}/{len(steps)} 步缺指针 {keys}（步 {bad}）")
    else:
        PASS += 1
        print(f"  ✓ {label}：全部 {len(steps)} 步指针完整 {keys}")


# ==========================================================================
# 0. 离线快照一致性（P-008 门禁：漂移即判失败，别等前端用到旧数据才发现）
# ==========================================================================
print("=== 0. 离线快照 gen_offline_data --check ===")
_gen = os.path.join(_HERE, "tools", "gen_offline_data.py")
try:
    cp = subprocess.run(
        [sys.executable, _gen, "--check"],
        capture_output=True,
        check=False,
        text=True,
        timeout=30,
    )
    if cp.returncode == 0:
        PASS += 1
        print(f"  ✓ {cp.stdout.strip()}")
    else:
        FAIL += 1
        print(
            f"  ✗ offline-data.js 与数据源不一致（退出 {cp.returncode}）："
            f"{(cp.stdout + cp.stderr).strip()[:80]}"
        )
except Exception as e:  # noqa: BLE001
    FAIL += 1
    print(f"  ✗ 离线快照校验无法执行：{e}")

print("=== 1. 健康检查 ===")
r = call("GET", "/api/health")
if r and isinstance(r.get("data"), dict) and "quiz_total" in r["data"]:
    _expect_total = r["data"]["quiz_total"]
    assert _expect_total == TOTAL_QUESTIONS, (
        f"health.quiz_total={_expect_total} 与 questions.json 统计 {TOTAL_QUESTIONS} 不一致"
    )
    print(f"  ✓ quiz_total 与 questions.json 同步：{TOTAL_QUESTIONS}")

# ==========================================================================
# 2. 单链表：走 /trace/*，顺带验指针完整性
# ==========================================================================
print(f"\n=== 2. 单链表 /trace/*（{CATEGORY_COUNTS.get('list', 0)} 题在库，仅供参照）===")
call("GET", "/api/linkedlist/trace/state")
call("POST", "/api/linkedlist/trace/build", {"values": []})  # 复位空表
r = call("POST", "/api/linkedlist/trace/insert-tail", {"value": 12})
assert_ptrs(r, ["head"], "insert-tail 12")  # [12]
call("POST", "/api/linkedlist/trace/insert-tail", {"value": 45})  # [12,45]
r = call("POST", "/api/linkedlist/trace/insert-head", {"value": 7})
assert_ptrs(r, ["head"], "insert-head 7")  # [7,12,45]
r = call("POST", "/api/linkedlist/trace/search", {"value": 45})
res = (r or {}).get("data", {}).get("result", {})
ok_search = res.get("found") is True and res.get("pos") == 3
print(f"  {'✓' if ok_search else '✗'} search 45 -> found={res.get('found')} pos={res.get('pos')}（期望 pos=3）")
PASS += 1 if ok_search else 0
FAIL += 0 if ok_search else 1
assert_ptrs(r, ["head"], "search 45")
r = call("POST", "/api/linkedlist/trace/delete-pos", {"pos": 2})  # [7,45]
assert_ptrs(r, ["head"], "delete-pos 2")
call("POST", "/api/linkedlist/trace/delete-pos", {"pos": 9}, expect_code=1)  # 越界
r = call("POST", "/api/linkedlist/trace/delete-value", {"value": 7})  # [45]
assert_ptrs(r, ["head"], "delete-value 7")
call("POST", "/api/linkedlist/trace/build", {"values": []})  # 清空

# ==========================================================================
# 3. 栈：走 /api/stack/trace/*
# ==========================================================================
print("\n=== 3. 栈 /trace/* ===")
r = call("POST", "/api/stack/trace/build", {"values": [15, 42]})  # [15,42]
assert_ptrs(r, ["top"], "stack build [15,42]")
r = call("POST", "/api/stack/trace/peek")
top = (r or {}).get("data", {}).get("result", {}).get("value")
ok = top == 42
print(f"  {'✓' if ok else '✗'} peek -> {top}（期望 42）")
PASS += 1 if ok else 0
FAIL += 0 if ok else 1
assert_ptrs(r, ["top"], "stack peek")
r = call("POST", "/api/stack/trace/pop")  # 弹出 42
popped = (r or {}).get("data", {}).get("result", {}).get("value")
ok = popped == 42
print(f"  {'✓' if ok else '✗'} pop -> {popped}（期望 42，LIFO）")
PASS += 1 if ok else 0
FAIL += 0 if ok else 1
assert_ptrs(r, ["top"], "stack pop 42")
call("POST", "/api/stack/trace/pop")  # 弹出 15
call("POST", "/api/stack/trace/pop", expect_code=1)  # 空栈 -> code=1

# ==========================================================================
# 4. 队列：走 /api/queue/trace/*
# ==========================================================================
print("\n=== 4. 队列 /trace/* ===")
r = call("POST", "/api/queue/trace/build", {"values": [23, 56]})  # [23,56]
assert_ptrs(r, ["front", "rear"], "queue build [23,56]")
r = call("POST", "/api/queue/trace/peek")
front = (r or {}).get("data", {}).get("result", {}).get("value")
ok = front == 23
print(f"  {'✓' if ok else '✗'} peek -> {front}（期望 23）")
PASS += 1 if ok else 0
FAIL += 0 if ok else 1
assert_ptrs(r, ["front", "rear"], "queue peek")
r = call("POST", "/api/queue/trace/dequeue")  # 出队 23
dq = (r or {}).get("data", {}).get("result", {}).get("value")
ok = dq == 23
print(f"  {'✓' if ok else '✗'} dequeue -> {dq}（期望 23，FIFO）")
PASS += 1 if ok else 0
FAIL += 0 if ok else 1
assert_ptrs(r, ["front", "rear"], "queue dequeue 23")
call("POST", "/api/queue/trace/dequeue")  # 出队 56
call("POST", "/api/queue/trace/dequeue", expect_code=1)  # 空队 -> code=1

# ==========================================================================
# 5. 题库
# ==========================================================================
print(
    f"\n=== 5. 题库：{NUM_CATEGORIES} 分类 / {TOTAL_QUESTIONS} 题（读自 questions.json）==="
)
r = call("GET", "/api/quiz/categories")
if r:
    cats = {c["key"]: c["count"] for c in r["data"]["categories"]}
    assert cats == CATEGORY_COUNTS, (
        f"分类题数不一致：接口 {cats} vs 数据 {CATEGORY_COUNTS}"
    )
    print(f"  ✓ 分类题数与数据文件一致：{cats}")

r = call("GET", "/api/quiz/questions?category=list")
_expect_list = CATEGORY_COUNTS.get("list", 0)
assert r and r["data"]["total"] == _expect_list, (
    f"list 分类应有 {_expect_list} 题（来自 questions.json），实际 {r['data']['total'] if r else 'n/a'}"
)
assert "answer" not in json.dumps(r["data"]), "取题接口不应泄漏答案字段"

# 验证判题逻辑：tree-1（n0 与 n2 的关系）正确答案下标为 1，先答错再答对
call("POST", "/api/quiz/submit", {"question_id": "tree-1", "answer": 0})  # 答错
r = call("POST", "/api/quiz/submit", {"question_id": "tree-1", "answer": 1})
assert r and r["data"]["correct"] is True and r["data"]["explanation"], (
    "判题与解析应正常返回"
)
# P-003：判题响应必须带 content_type 字段供前端选择 innerHTML / textContent
assert r["data"].get("explanation_content_type") in ("trusted_html", "plain_text"), (
    f"explanation_content_type 缺失或非法：{r['data'].get('explanation_content_type')!r}"
)
assert r["data"].get("key_point_content_type") in ("trusted_html", "plain_text"), (
    f"key_point_content_type 缺失或非法：{r['data'].get('key_point_content_type')!r}"
)
call("POST", "/api/quiz/submit", {"question_id": "bad-9", "answer": 0}, expect_code=1)
call("GET", "/api/quiz/stats")

print("\n=== 6. AI 答疑 ===")
r = call("POST", "/api/ai/ask", {"question": "快速排序为什么最坏是 O(n2)"})
assert r and r["data"]["source"] == "local_kb", "术语提问应命中本地知识库"
# P-003：AI 响应也要带 answer_content_type
assert r["data"].get("answer_content_type") in ("trusted_html", "plain_text"), (
    f"answer_content_type 缺失或非法：{r['data'].get('answer_content_type')!r}"
)
r = call("POST", "/api/ai/ask", {"question": "随便聊聊今天天气"})
assert r and r["data"]["source"] == "mock", "未命中应返回模拟回答"
assert r["data"].get("answer_content_type") in ("trusted_html", "plain_text"), (
    "mock 路径同样要带 answer_content_type"
)

print("\n" + "=" * 50)
print(f"测试完成：通过 {PASS} 项，失败 {FAIL} 项")
print("=" * 50)
sys.exit(1 if FAIL else 0)
