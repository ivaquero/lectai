"""
后端接口自动测试脚本（无第三方依赖，仅用标准库 urllib）
用法：先启动服务，再运行  python test_api.py

P-008：期望题数从 data/questions.json 动态读取，不再硬编码 "list=8 / 共 32 题"。
"""

import json
import os
import urllib.request

BASE = "http://127.0.0.1:8000"
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


print("=== 1. 健康检查 ===")
r = call("GET", "/api/health")
if r and isinstance(r.get("data"), dict) and "quiz_total" in r["data"]:
    _expect_total = r["data"]["quiz_total"]
    assert _expect_total == TOTAL_QUESTIONS, (
        f"health.quiz_total={_expect_total} 与 questions.json 统计 {TOTAL_QUESTIONS} 不一致"
    )
    print(f"  ✓ quiz_total 与 questions.json 同步：{TOTAL_QUESTIONS}")

print(
    f"\n=== 2. 单链表：增 / 删 / 查（{CATEGORY_COUNTS.get('list', 0)} 题在库，仅供参照）==="
)
call("GET", "/api/linkedlist")  # 空表
call("POST", "/api/linkedlist/insert-tail", {"value": 12})  # [12]
call("POST", "/api/linkedlist/insert-tail", {"value": 45})  # [12,45]
call("POST", "/api/linkedlist/insert-head", {"value": 7})  # [7,12,45]
r = call("POST", "/api/linkedlist/search", {"value": 45})
assert r and r["data"]["found"] and r["data"]["pos"] == 3, "search 应命中位序 3"
call("POST", "/api/linkedlist/delete", {"pos": 2})  # [7,45]
call("POST", "/api/linkedlist/delete", {"pos": 9}, expect_code=1)  # 越界 -> code=1
call("POST", "/api/linkedlist/delete-value", {"value": 7})  # [45]
call("DELETE", "/api/linkedlist")  # 清空

print("\n=== 3. 栈：入 / 出 / 查 ===")
call("POST", "/api/stack/push", {"value": 15})
call("POST", "/api/stack/push", {"value": 42})
call("GET", "/api/stack/peek")  # 栈顶 42
r = call("POST", "/api/stack/pop")  # 弹出 42
assert r and r["data"]["popped"] == 42, "出栈应弹出 42（LIFO）"
call("POST", "/api/stack/pop")
call("POST", "/api/stack/pop", expect_code=1)  # 栈空 -> code=1
call("DELETE", "/api/stack")

print("\n=== 4. 队列：入 / 出 / 查 ===")
call("POST", "/api/queue/enqueue", {"value": 23})
call("POST", "/api/queue/enqueue", {"value": 56})
call("GET", "/api/queue/peek")  # 队头 23
r = call("POST", "/api/queue/dequeue")  # 出队 23
assert r and r["data"]["dequeued"] == 23, "出队应弹出 23（FIFO）"
call("DELETE", "/api/queue")

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
q1 = r["data"]["questions"][0]
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
exit(1 if FAIL else 0)
