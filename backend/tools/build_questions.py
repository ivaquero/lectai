#!/usr/bin/env python
"""合并题库：把 data/ 里的待合并新题 JSON 并入 data/questions.json。

data/ 目录同时存放主库 questions.json、答疑知识库 kb.json 与待合并的新题文件
（例如 questions_extra.json）。本工具只把「除主库与 kb.json 之外」的 *.json 当新题合并。

用法：
    python tools/build_questions.py            # 合并并校验
    python tools/build_questions.py --check    # 只校验，不写回

校验规则（任何一条不通过都会报错并中止）：
  - 每题必须有 tag / q / opts / ans / exp / key / diff 七个字段
  - opts 恰好 4 项且互不重复
  - ans 是 0..3 的整数
  - diff 是 basic / mid / hard 之一
  - 同一分类内题干不重复
  - 分类必须有 name
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
MAIN = os.path.join(DATA_DIR, "questions.json")
BAK = os.path.join(DATA_DIR, "questions.json.bak")

FIELDS = ("tag", "q", "opts", "ans", "exp", "key", "diff")
DIFFS = ("basic", "mid", "hard")


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def check(bank, label):
    """校验题库，返回 (题数, 错误列表)"""
    errs = []
    total = 0
    for cat, block in bank.items():
        if not isinstance(block, dict) or "questions" not in block:
            errs.append(f"{label}：分类 {cat} 缺少 name/questions 结构")
            continue
        if not block.get("name"):
            errs.append(f"{label}：分类 {cat} 缺 name")
        seen = set()
        for i, q in enumerate(block["questions"]):
            total += 1
            where = f"{label}/{cat}#{i}"
            for f in FIELDS:
                if f not in q:
                    errs.append(f"{where} 缺字段 {f}")
            if "opts" in q:
                if len(q["opts"]) != 4:
                    errs.append(f"{where} 选项数={len(q['opts'])}（应为 4）")
                if len(set(q["opts"])) != len(q["opts"]):
                    errs.append(f"{where} 选项有重复")
            if "ans" in q and (not isinstance(q["ans"], int) or not 0 <= q["ans"] <= 3):
                errs.append(f"{where} ans={q['ans']!r} 不合法")
            if "diff" in q and q["diff"] not in DIFFS:
                errs.append(f"{where} diff={q['diff']!r} 不合法（应为 {DIFFS} 之一）")
            if "q" in q:
                if q["q"] in seen:
                    errs.append(f"{where} 题干与同分类前题重复")
                seen.add(q["q"])
    return total, errs


def main():
    only_check = "--check" in sys.argv
    bank = load(MAIN)
    before, errs0 = check(bank, "现有")
    if errs0:
        print("现有题库有问题：")
        for e in errs0:
            print("  - " + e)
        return 1
    print(f"现有题库：{before} 题，{len(bank)} 个分类")

    added = 0
    skip = {os.path.basename(MAIN), "kb.json"}
    if os.path.isdir(DATA_DIR):
        for fn in sorted(os.listdir(DATA_DIR)):
            if not fn.endswith(".json") or fn in skip:
                continue
            extra = load(os.path.join(DATA_DIR, fn))
            _, errs = check(extra, fn)
            if errs:
                print(f"新题库 {fn} 有问题：")
                for e in errs:
                    print("  - " + e)
                return 1
            for cat, block in extra.items():
                if cat not in bank:
                    bank[cat] = {"name": block["name"], "questions": []}
                    print(f"  新增分类 {cat}（{block['name']}）")
                else:
                    # 用新题库里的分类名覆盖（更贴近扩充后的内容）
                    if block.get("name"):
                        bank[cat]["name"] = block["name"]
                exists = {q["q"] for q in bank[cat]["questions"]}
                n = 0
                for q in block["questions"]:
                    if q["q"] in exists:
                        continue
                    bank[cat]["questions"].append(q)
                    exists.add(q["q"])
                    n += 1
                added += n
                print(f"  {cat}：+{n} 题 → 共 {len(bank[cat]['questions'])} 题")
    else:
        print("没有 data/ 目录，仅做校验")

    total, errs = check(bank, "合并后")
    if errs:
        print("合并后校验失败：")
        for e in errs:
            print("  - " + e)
        return 1

    print(f"\n合并完成：新增 {added} 题，总计 {total} 题，{len(bank)} 个分类")
    for cat in bank:
        print(f"  {cat:<12} {len(bank[cat]['questions']):>2} 题  {bank[cat]['name']}")

    if only_check or added == 0:
        print("\n（未写回）")
        return 0

    if not os.path.exists(BAK):
        with open(BAK, "w", encoding="utf-8") as f:
            json.dump(load(MAIN), f, ensure_ascii=False, indent=1)
    with open(MAIN, "w", encoding="utf-8") as f:
        json.dump(bank, f, ensure_ascii=False, indent=1)
    print("\n已写入 data/questions.json（原文件备份为 data/questions.json.bak）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
