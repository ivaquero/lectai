#!/usr/bin/env node
/* ==========================================================================
   tools/build-questions.mjs —— 合并题库
   --------------------------------------------------------------------------
   把 data/ 里的待合并新题 JSON 并入 data/questions.json。data/ 同时存放主库
   questions.json、答疑知识库 kb.json 与待合并的新题文件（如 questions_extra.json），
   本工具只把「除主库与 kb.json 之外」的 *.json 当新题合并。

   用法：
     node tools/build-questions.mjs            # 合并并校验
     node tools/build-questions.mjs --check    # 只校验，不写回

   校验规则（任何一条不通过都会报错并中止）：
     - 每题必须有 tag / q / opts / ans / exp / key / diff 七个字段
     - opts 恰好 4 项且互不重复
     - ans 是 0..3 的整数
     - diff 是 basic / mid / hard 之一
     - 同一分类内题干不重复
     - 分类必须有 name
   ========================================================================== */

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, 'data');
const MAIN = join(DATA_DIR, 'questions.json');
const BAK = join(DATA_DIR, 'questions.json.bak');

const FIELDS = ['tag', 'q', 'opts', 'ans', 'exp', 'key', 'diff'];
const DIFFS = ['basic', 'mid', 'hard'];

const load = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** 校验题库，返回 { total, errs } */
function check(bank, label) {
  const errs = [];
  let total = 0;

  for (const [cat, block] of Object.entries(bank)) {
    if (!block || typeof block !== 'object' || !Array.isArray(block.questions)) {
      errs.push(`${label}：分类 ${cat} 缺少 name/questions 结构`);
      continue;
    }
    if (!block.name) errs.push(`${label}：分类 ${cat} 缺 name`);

    const seen = new Set();
    block.questions.forEach((q, i) => {
      total++;
      const where = `${label}/${cat}#${i}`;

      for (const f of FIELDS) {
        if (!(f in q)) errs.push(`${where} 缺字段 ${f}`);
      }
      if (Array.isArray(q.opts)) {
        if (q.opts.length !== 4) errs.push(`${where} 选项数=${q.opts.length}（应为 4）`);
        if (new Set(q.opts).size !== q.opts.length) errs.push(`${where} 选项有重复`);
      }
      if ('ans' in q && !(Number.isInteger(q.ans) && q.ans >= 0 && q.ans <= 3)) {
        errs.push(`${where} ans=${JSON.stringify(q.ans)} 不合法`);
      }
      if ('diff' in q && !DIFFS.includes(q.diff)) {
        errs.push(`${where} diff=${JSON.stringify(q.diff)} 不合法（应为 ${DIFFS.join('/')} 之一）`);
      }
      if ('q' in q) {
        if (seen.has(q.q)) errs.push(`${where} 题干与同分类前题重复`);
        seen.add(q.q);
      }
    });
  }
  return { total, errs };
}

function main() {
  const onlyCheck = process.argv.includes('--check');
  const bank = load(MAIN);

  const first = check(bank, '现有');
  if (first.errs.length) {
    console.log('现有题库有问题：');
    for (const e of first.errs) console.log('  - ' + e);
    return 1;
  }
  console.log(`现有题库：${first.total} 题，${Object.keys(bank).length} 个分类`);

  let added = 0;
  const skip = new Set([basename(MAIN), 'kb.json']);

  const isDir = (p) => existsSync(p) && statSync(p).isDirectory();
  if (isDir(DATA_DIR)) {
    for (const fn of readdirSync(DATA_DIR).sort()) {
      if (!fn.endsWith('.json') || skip.has(fn)) continue;

      const extra = load(join(DATA_DIR, fn));
      const { errs } = check(extra, fn);
      if (errs.length) {
        console.log(`新题库 ${fn} 有问题：`);
        for (const e of errs) console.log('  - ' + e);
        return 1;
      }

      for (const [cat, block] of Object.entries(extra)) {
        if (!bank[cat]) {
          bank[cat] = { name: block.name, questions: [] };
          console.log(`  新增分类 ${cat}（${block.name}）`);
        } else if (block.name) {
          // 用新题库里的分类名覆盖（更贴近扩充后的内容）
          bank[cat].name = block.name;
        }

        const exists = new Set(bank[cat].questions.map((q) => q.q));
        let n = 0;
        for (const q of block.questions) {
          if (exists.has(q.q)) continue;
          bank[cat].questions.push(q);
          exists.add(q.q);
          n++;
        }
        added += n;
        console.log(`  ${cat}：+${n} 题 → 共 ${bank[cat].questions.length} 题`);
      }
    }
  } else {
    console.log('没有 data/ 目录，仅做校验');
  }

  const after = check(bank, '合并后');
  if (after.errs.length) {
    console.log('合并后校验失败：');
    for (const e of after.errs) console.log('  - ' + e);
    return 1;
  }

  console.log(`\n合并完成：新增 ${added} 题，总计 ${after.total} 题，${Object.keys(bank).length} 个分类`);
  for (const [cat, block] of Object.entries(bank)) {
    console.log(`  ${cat.padEnd(12)} ${String(block.questions.length).padStart(2)} 题  ${block.name}`);
  }

  if (onlyCheck || added === 0) {
    console.log('\n（未写回）');
    return 0;
  }

  if (!existsSync(BAK)) writeFileSync(BAK, JSON.stringify(load(MAIN), null, 1), 'utf8');
  writeFileSync(MAIN, JSON.stringify(bank, null, 1), 'utf8');
  console.log('\n已写入 data/questions.json（原文件备份为 data/questions.json.bak）');
  return 0;
}

process.exit(main());
