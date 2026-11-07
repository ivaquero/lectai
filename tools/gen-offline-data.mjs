#!/usr/bin/env node
/* ==========================================================================
   tools/gen-offline-data.mjs —— 生成前端离线快照 web/data/offline.json
   --------------------------------------------------------------------------
   用途：站点在「后端不可达」时自动降级到本地数据（刷题 / 答疑），无需任何服务。
   本脚本把 data/questions.json（含答案）+ data/kb.json 打成一份**纯数据**的
   JSON，写到 web/data/offline.json，由 core/offline.js 在探测到离线时 fetch。

   ★ 为什么是 JSON 而不是 JS ★
     这份东西是数据，不是代码：内联进 core/offline-data.js（旧位置）时以 `DS.OFFLINE = {...}`
     既让 78KB 的载荷必须经由 JS 解析器，也让「数据」混进了源码目录。JSON 可以被
     `node tools/gen-offline-data.mjs --check` 直接比字节，也能被任何工具读取。

   ★ 只有离线快照才把答案 ans/exp/key 打进前端；线上题库接口 /api/quiz/questions
     依旧不返回答案（防作弊）。离线降级是「本地测试」语义，答案落地到本机可接受。

   数据源变更后重跑：  node tools/gen-offline-data.mjs
   校验（不写盘，仅比对）：node tools/gen-offline-data.mjs --check
   ========================================================================== */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = join(ROOT, 'data');
const QUESTIONS_PATH = join(DATA_DIR, 'questions.json');
const KB_PATH = join(DATA_DIR, 'kb.json');
const OUT_PATH = join(ROOT, 'web', 'data', 'offline.json');

/** 每题摊平成 {id, category, tag, question, options, answer, ...}；
    与后端 question_index() 的 id 规则保持一致：`${cat}-${i}`（i 从 1 起） */
const LETTERS = 'ABCD';

function build(questionsRaw, kbRaw) {
  const questions = {};
  const categories = [];
  let total = 0;

  for (const [catKey, cat] of Object.entries(questionsRaw)) {
    const name = cat.name ?? catKey;
    const items = cat.questions ?? [];
    const qs = [];

    items.forEach((q, i) => {
      const qid = `${catKey}-${i + 1}`;
      const ans = q.ans;
      const rec = {
        id: qid,
        category: catKey,
        tag: q.tag ?? '',
        question: q.q,
        options: q.opts,
        answer: ans,
        answer_letter: LETTERS[ans],
        explanation: q.exp,
        key_point: q.key,
        difficulty: q.diff ?? 'mid'
      };
      questions[qid] = rec;
      qs.push(rec);
    });

    categories.push({ key: catKey, name, count: qs.length });
    total += qs.length;
  }

  return {
    generated_by: 'tools/gen-offline-data.mjs',
    version: 1,
    meta: { quiz_total: total, quiz_categories: categories.length, kb_entries: kbRaw.length },
    categories,
    questions,
    kb: kbRaw
  };
}

/** 1 空格缩进：与 data/questions.json 同一套风格，人工排查时不必在一行里找字段。
    线上多传输约 10KB，只在「已判定离线」时才拉，可接受。 */
function renderJson(bundle) {
  return JSON.stringify(bundle, null, 1) + '\n';
}

/** 比对前先抹平换行符差异：Windows 检出 / 不同编辑器都不该让 --check 假红 */
const stripEol = (s) => s.replace(/\r\n/g, '\n');

function main() {
  const check = process.argv.includes('--check');
  const questionsRaw = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf8'));
  const kbRaw = JSON.parse(readFileSync(KB_PATH, 'utf8'));

  const bundle = build(questionsRaw, kbRaw);
  const json = renderJson(bundle);

  if (check) {
    let cur;
    try {
      cur = readFileSync(OUT_PATH, 'utf8');
    } catch {
      console.log('web/data/offline.json 不存在，请运行 node tools/gen-offline-data.mjs 生成');
      return 1;
    }
    if (stripEol(cur) !== stripEol(json)) {
      console.log('web/data/offline.json 与数据源不一致，请重跑 node tools/gen-offline-data.mjs');
      return 1;
    }
    console.log('web/data/offline.json 已是最新');
    return 0;
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, json, 'utf8');

  const m = bundle.meta;
  console.log(
    `已写入 web/data/offline.json —— ` +
      `题 ${m.quiz_total} / 类 ${m.quiz_categories} / 知识库 ${m.kb_entries} 条`
  );
  return 0;
}

process.exit(main());
