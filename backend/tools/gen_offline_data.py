#!/usr/bin/env python3
"""
gen_offline_data.py —— 生成前端离线快照 offline-data.js

用途：web/ 站点在「后端不可达」时自动降级到本地数据（刷题 / 答疑），无需 FastAPI。
本脚本把 backend/data/questions.json（含答案）+ backend/data/kb.json 打成一份
纯前端可读的 JS，写到 web/assets/js/core/offline-data.js。

★ 只有离线快照才把答案 ans/exp/key 打进前端；线上题库接口 /api/quiz/questions
   依旧不返回答案（防作弊）。离线降级是「本地测试」语义，答案落地到本机可接受。

数据源变更后重跑：  uv run python tools/gen_offline_data.py
校验（不写盘，仅比对）：uv run python tools/gen_offline_data.py --check
"""

from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
ROOT = os.path.dirname(BACKEND)

QUESTIONS_PATH = os.path.join(BACKEND, "data", "questions.json")
KB_PATH = os.path.join(BACKEND, "data", "kb.json")
OUT_PATH = os.path.join(ROOT, "web", "assets", "js", "core", "offline-data.js")

# 每题摊平成 {id, category, tag, question, options, answer, explanation, key_point, difficulty}
# 与后端 question_index() 的 id 规则保持一致：f"{cat}-{i}"（i 从 1 起）。
LETTERS = "ABCD"


def build(questions_raw: dict, kb_raw: list) -> dict:
    questions = {}
    categories = []
    total = 0
    for cat_key, cat in questions_raw.items():
        name = cat.get("name", cat_key)
        items = cat.get("questions", [])
        qs = []
        for i, q in enumerate(items, 1):
            qid = f"{cat_key}-{i}"
            ans = q["ans"]
            rec = {
                "id": qid,
                "category": cat_key,
                "tag": q.get("tag", ""),
                "question": q["q"],
                "options": q["opts"],
                "answer": ans,
                "answer_letter": LETTERS[ans],
                "explanation": q["exp"],
                "key_point": q["key"],
                "difficulty": q.get("diff", "mid"),
            }
            questions[qid] = rec
            qs.append(rec)
        categories.append({"key": cat_key, "name": name, "count": len(qs)})
        total += len(qs)

    return {
        "version": 1,
        "meta": {
            "quiz_total": total,
            "quiz_categories": len(categories),
            "kb_entries": len(kb_raw),
        },
        "categories": categories,
        "questions": questions,
        "kb": kb_raw,
    }


def render_js(bundle: dict) -> str:
    payload = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
    header = (
        "/* ==========================================================================\n"
        "   core/offline-data.js —— 前端离线快照（自动生成，勿手改）\n"
        "   --------------------------------------------------------------------------\n"
        "   生成命令：cd backend && uv run python tools/gen_offline_data.py\n"
        "   数据源  ：backend/data/questions.json + backend/data/kb.json\n"
        "   ★ 含各题答案/解析，仅供「后端不可达」时的本地离线测试；线上接口不返回答案。\n"
        "   ========================================================================== */\n"
        "(function () {\n"
        "  'use strict';\n"
        "  var DS = (window.DS = window.DS || {});\n"
        "  DS.OFFLINE = "
    )
    footer = ";\n})();\n"
    return header + payload + footer


def main() -> int:
    check = "--check" in sys.argv[1:]
    with open(QUESTIONS_PATH, encoding="utf-8") as f:
        questions_raw = json.load(f)
    with open(KB_PATH, encoding="utf-8") as f:
        kb_raw = json.load(f)

    bundle = build(questions_raw, kb_raw)
    js = render_js(bundle)

    if check:
        try:
            with open(OUT_PATH, encoding="utf-8") as f:
                cur = f.read()
        except FileNotFoundError:
            print("offline-data.js 不存在，请运行 gen_offline_data.py 生成")
            return 1
        if cur != js:
            print("offline-data.js 与数据源不一致，请重跑 gen_offline_data.py")
            return 1
        print("offline-data.js 已是最新")
        return 0

    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(js)

    m = bundle["meta"]
    print(
        f"已写入 web/assets/js/core/offline-data.js —— "
        f"题 {m['quiz_total']} / 类 {m['quiz_categories']} / 知识库 {m['kb_entries']} 条"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
