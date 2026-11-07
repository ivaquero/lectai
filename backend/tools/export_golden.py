"""
tools/export_golden.py —— 导出轨迹引擎的 golden 快照与操作注册表
==========================================================================
用途：web/src/engine/ 的 TypeScript 移植靠这份数据做逐字节对齐。

做三件事：
  1) 读 web/tests/scenarios/trace-cases.json（两端共用的场景脚本）
  2) 用 Python 侧 algo/*_trace.py 原样跑一遍 → web/tests/golden/ 下的 golden
  3) 把三个 OPS 表导出到 web/src/engine/ops.generated.json（C 代码行单一真相源）

为什么要重置 id 计数器：Node / Item 的 id 来自全局自增（n1、k2、q3…），
服务端进程是长驻的，浏览器每次打开页面却从 1 开始。逐场景重置后，每份 golden
与执行顺序无关，才能同时约束「服务端」和「离线引擎」两种运行形态。

改了 algo/ 或 OPS 之后重跑：
    cd backend && uv run python tools/export_golden.py
然后跑 `cd web && npm run test:parity` 看移植是否仍然对齐。
==========================================================================
"""

from __future__ import annotations

import itertools
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from algo import linkedlist_trace as LL  # noqa: E402
from algo import queue_trace as QT  # noqa: E402
from algo import stack_trace as ST  # noqa: E402

SCENARIOS = ROOT / "web" / "tests" / "scenarios" / "trace-cases.json"
GOLDEN_DIR = ROOT / "web" / "tests" / "golden"
OPS_OUT = ROOT / "web" / "src" / "engine" / "ops.generated.json"

ERR = (LL.OpError, ST.OpError)


def _reset_ids(container: str) -> None:
    if container == "list":
        LL.Node._seq = itertools.count(1)
    elif container == "stack":
        ST.Item._seq = itertools.count(1)
    else:
        QT.Item._seq = itertools.count(1)


def _handlers(container: str, box: dict) -> dict:
    """返回 {op: fn(step)}。box["c"] 是当前容器，允许场景中重建。"""
    if container == "list":

        def build(s):
            return LL.op_build(box["c"], s.get("values", []))

        return {
            "build": build,
            "insert-head": lambda s: LL.op_insert_head(box["c"], s["value"]),
            "insert-tail": lambda s: LL.op_insert_tail(box["c"], s["value"]),
            "delete-pos": lambda s: LL.op_delete_pos(box["c"], s["pos"]),
            "delete-value": lambda s: LL.op_delete_value(box["c"], s["value"]),
            "search": lambda s: LL.op_search(box["c"], s["value"]),
            "traverse": lambda s: LL.op_traverse(box["c"]),
        }
    if container == "stack":

        def build(s):
            return ST.op_build(box["c"], s.get("values", []))

        return {
            "build": build,
            "push": lambda s: ST.op_push(box["c"], s["value"]),
            "pop": lambda s: ST.op_pop(box["c"]),
            "peek": lambda s: ST.op_peek(box["c"]),
            "traverse": lambda s: ST.op_traverse(box["c"]),
        }

    def build(s):
        return QT.op_build(box["c"], s.get("values", []))

    return {
        "build": build,
        "enqueue": lambda s: QT.op_enqueue(box["c"], s["value"]),
        "dequeue": lambda s: QT.op_dequeue(box["c"]),
        "peek": lambda s: QT.op_peek(box["c"]),
        "traverse": lambda s: QT.op_traverse(box["c"]),
    }


def _new_container(container: str):
    if container == "list":
        return LL.TraceList()
    if container == "stack":
        return ST.TraceStack()
    return QT.TraceQueue()


def _state(container: str, c):
    if container == "list":
        return LL.state_payload(c)
    if container == "stack":
        return ST.state_payload(c)
    return QT.state_payload(c)


def run_case(case: dict) -> dict:
    container = case["container"]
    _reset_ids(container)
    box = {"c": _new_container(container)}
    handlers = _handlers(container, box)
    outputs, error = [], None

    for i, step in enumerate(case["steps"]):
        op = step["op"]
        if op not in handlers:
            raise SystemExit(f"{case['name']}: 未知操作 {op}")
        try:
            outputs.append(handlers[op](step))
        except ERR as exc:  # 业务错误：路由层转 code=1，轨迹整体丢弃
            error = {"index": i, "message": str(exc)}
            break

    return {
        "name": case["name"],
        "container": container,
        "outputs": outputs,
        "state": _state(container, box["c"]),
        "error": error,
    }


def main() -> None:
    spec = json.loads(SCENARIOS.read_text(encoding="utf-8"))
    GOLDEN_DIR.mkdir(parents=True, exist_ok=True)
    OPS_OUT.parent.mkdir(parents=True, exist_ok=True)

    cases = [run_case(c) for c in spec["cases"]]
    (GOLDEN_DIR / "trace-cases.golden.json").write_text(
        json.dumps(cases, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    OPS_OUT.write_text(
        json.dumps(
            {"list": LL.OPS, "stack": ST.OPS, "queue": QT.OPS},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    steps = sum(len(c["outputs"]) for c in cases)
    snaps = sum(
        len(o.get("trace") or []) for c in cases for o in c["outputs"]
    )
    errors = sum(1 for c in cases if c["error"])
    print(f"场景 {len(cases)} 个（含错误用例 {errors} 个），操作 {steps} 次，快照 {snaps} 个")
    print(f"  → {GOLDEN_DIR / 'trace-cases.golden.json'}")
    print(f"  → {OPS_OUT}")


if __name__ == "__main__":
    main()
