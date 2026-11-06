#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""合并题库：把 data/*.json 里的新题并进 questions.json。

用法：
    python tools/build_questions.py            # 合并并校验
    python tools/build_questions.py --check    # 只校验，不写回

校验规则（任何一条不通过都会报错并中止）：
  - 每题必须有 tag / q / opts / ans / exp / key 六个字段
  - opts 恰好 4 项且互不重复
  - ans 是 0..3 的整数
  - 同一分类内题干不重复
  - 分类必须有 name
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAIN = os.path.join(ROOT, 'questions.json')
DATA_DIR = os.path.join(ROOT, 'data')
BAK = os.path.join(ROOT, 'questions.json.bak')

FIELDS = ('tag', 'q', 'opts', 'ans', 'exp', 'key')


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def check(bank, label):
    """校验题库，返回 (题数, 错误列表)"""
    errs = []
    total = 0
    for cat, block in bank.items():
        if not isinstance(block, dict) or 'questions' not in block:
            errs.append('%s：分类 %s 缺少 name/questions 结构' % (label, cat))
            continue
        if not block.get('name'):
            errs.append('%s：分类 %s 缺 name' % (label, cat))
        seen = set()
        for i, q in enumerate(block['questions']):
            total += 1
            where = '%s/%s#%d' % (label, cat, i)
            for f in FIELDS:
                if f not in q:
                    errs.append('%s 缺字段 %s' % (where, f))
            if 'opts' in q:
                if len(q['opts']) != 4:
                    errs.append('%s 选项数=%d（应为 4）' % (where, len(q['opts'])))
                if len(set(q['opts'])) != len(q['opts']):
                    errs.append('%s 选项有重复' % where)
            if 'ans' in q:
                if not isinstance(q['ans'], int) or not (0 <= q['ans'] <= 3):
                    errs.append('%s ans=%r 不合法' % (where, q['ans']))
            if 'q' in q:
                if q['q'] in seen:
                    errs.append('%s 题干与同分类前题重复' % where)
                seen.add(q['q'])
    return total, errs


def main():
    only_check = '--check' in sys.argv
    bank = load(MAIN)
    before, errs0 = check(bank, '现有')
    if errs0:
        print('现有题库有问题：')
        for e in errs0:
            print('  - ' + e)
        return 1
    print('现有题库：%d 题，%d 个分类' % (before, len(bank)))

    added = 0
    if os.path.isdir(DATA_DIR):
        for fn in sorted(os.listdir(DATA_DIR)):
            if not fn.endswith('.json'):
                continue
            extra = load(os.path.join(DATA_DIR, fn))
            _, errs = check(extra, fn)
            if errs:
                print('新题库 %s 有问题：' % fn)
                for e in errs:
                    print('  - ' + e)
                return 1
            for cat, block in extra.items():
                if cat not in bank:
                    bank[cat] = {'name': block['name'], 'questions': []}
                    print('  新增分类 %s（%s）' % (cat, block['name']))
                else:
                    # 用新题库里的分类名覆盖（更贴近扩充后的内容）
                    if block.get('name'):
                        bank[cat]['name'] = block['name']
                exists = {q['q'] for q in bank[cat]['questions']}
                n = 0
                for q in block['questions']:
                    if q['q'] in exists:
                        continue
                    bank[cat]['questions'].append(q)
                    exists.add(q['q'])
                    n += 1
                added += n
                print('  %s：+%d 题 → 共 %d 题' % (cat, n, len(bank[cat]['questions'])))
    else:
        print('没有 data/ 目录，仅做校验')

    total, errs = check(bank, '合并后')
    if errs:
        print('合并后校验失败：')
        for e in errs:
            print('  - ' + e)
        return 1

    print('\n合并完成：新增 %d 题，总计 %d 题，%d 个分类' % (added, total, len(bank)))
    for cat in bank:
        print('  %-12s %2d 题  %s' % (cat, len(bank[cat]['questions']), bank[cat]['name']))

    if only_check or added == 0:
        print('\n（未写回）')
        return 0

    if not os.path.exists(BAK):
        with open(BAK, 'w', encoding='utf-8') as f:
            json.dump(load(MAIN), f, ensure_ascii=False, indent=1)
    with open(MAIN, 'w', encoding='utf-8') as f:
        json.dump(bank, f, ensure_ascii=False, indent=1)
    print('\n已写入 questions.json（原文件备份为 questions.json.bak）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
