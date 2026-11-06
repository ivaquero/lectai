# -*- coding: utf-8 -*-
"""
后端接口自动测试脚本（无第三方依赖，仅用标准库 urllib）
用法：先启动服务，再运行  python test_api.py
"""

import json
import urllib.request

BASE = "http://127.0.0.1:8000"
HEADERS = {"Content-Type": "application/json", "X-Session-Id": "test-session"}

PASS, FAIL = 0, 0


def call(method: str, path: str, body: dict = None, expect_code: int = 0):
    """发请求并断言响应 code 字段"""
    global PASS, FAIL
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers=HEADERS, method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except Exception as e:                                   # noqa: BLE001
        print(f"  ✗ {method} {path} -> 请求异常: {e}")
        FAIL += 1
        return None

    tag = "✓" if result.get("code") == expect_code else "✗"
    if tag == "✓":
        PASS += 1
    else:
        FAIL += 1
    print(f"  {tag} {method:6s} {path:34s} code={result.get('code')} msg={result.get('msg', '')[:46]}")
    return result


print("=== 1. 健康检查 ===")
call("GET", "/api/health")

print("\n=== 2. 单链表：增 / 删 / 查 ===")
call("GET", "/api/linkedlist")                                       # 空表
call("POST", "/api/linkedlist/insert-tail", {"value": 12})           # [12]
call("POST", "/api/linkedlist/insert-tail", {"value": 45})           # [12,45]
call("POST", "/api/linkedlist/insert-head", {"value": 7})            # [7,12,45]
r = call("POST", "/api/linkedlist/search", {"value": 45})
assert r and r["data"]["found"] and r["data"]["pos"] == 3, "search 应命中位序 3"
call("POST", "/api/linkedlist/delete", {"pos": 2})                   # [7,45]
call("POST", "/api/linkedlist/delete", {"pos": 9}, expect_code=1)    # 越界 -> code=1
call("POST", "/api/linkedlist/delete-value", {"value": 7})           # [45]
call("DELETE", "/api/linkedlist")                                    # 清空

print("\n=== 3. 栈：入 / 出 / 查 ===")
call("POST", "/api/stack/push", {"value": 15})
call("POST", "/api/stack/push", {"value": 42})
call("GET", "/api/stack/peek")                                       # 栈顶 42
r = call("POST", "/api/stack/pop")                                   # 弹出 42
assert r and r["data"]["popped"] == 42, "出栈应弹出 42（LIFO）"
call("POST", "/api/stack/pop")
call("POST", "/api/stack/pop", expect_code=1)                        # 栈空 -> code=1
call("DELETE", "/api/stack")

print("\n=== 4. 队列：入 / 出 / 查 ===")
call("POST", "/api/queue/enqueue", {"value": 23})
call("POST", "/api/queue/enqueue", {"value": 56})
call("GET", "/api/queue/peek")                                       # 队头 23
r = call("POST", "/api/queue/dequeue")                               # 出队 23
assert r and r["data"]["dequeued"] == 23, "出队应弹出 23（FIFO）"
call("DELETE", "/api/queue")

print("\n=== 5. 题库：分类 / 取题 / 提交 ===")
call("GET", "/api/quiz/categories")
r = call("GET", "/api/quiz/questions?category=list")
assert r and r["data"]["total"] == 8, "list 分类应有 8 题"
q1 = r["data"]["questions"][0]
assert "answer" not in json.dumps(r["data"]), "取题接口不应泄漏答案字段"

# 验证判题逻辑：tree-1（n0 与 n2 的关系）正确答案下标为 1，先答错再答对
call("POST", "/api/quiz/submit", {"question_id": "tree-1", "answer": 0})   # 答错
r = call("POST", "/api/quiz/submit", {"question_id": "tree-1", "answer": 1})
assert r and r["data"]["correct"] is True and r["data"]["explanation"], "判题与解析应正常返回"
call("POST", "/api/quiz/submit", {"question_id": "bad-9", "answer": 0}, expect_code=1)
call("GET", "/api/quiz/stats")

print("\n=== 6. AI 答疑 ===")
r = call("POST", "/api/ai/ask", {"question": "快速排序为什么最坏是 O(n2)"})
assert r and r["data"]["source"] == "local_kb", "术语提问应命中本地知识库"
r = call("POST", "/api/ai/ask", {"question": "随便聊聊今天天气"})
assert r and r["data"]["source"] == "mock", "未命中应返回模拟回答"

print("\n" + "=" * 50)
print(f"测试完成：通过 {PASS} 项，失败 {FAIL} 项")
print("=" * 50)
exit(1 if FAIL else 0)
