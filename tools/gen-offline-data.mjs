#!/usr/bin/env node
/* ==========================================================================
   tools/gen-offline-data.mjs —— 生成前端离线快照 offline-data.js
   --------------------------------------------------------------------------
   用途：站点在「后端不可达」时自动降级到本地数据（刷题 / 答疑），无需任何服务。
   本脚本把 data/questions.json（含答案）+ data/kb.json 打成一份纯前端可读的 JS，
   写到 web/assets/js/core/offline-data.js。

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
const OUT_PATH = join(ROOT, 'web', 'assets', 'js', 'core', 'offline-data.js');

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
    version: 1,
    meta: { quiz_total: total, quiz_categories: categories.length, kb_entries: kbRaw.length },
    categories,
    questions,
    kb: kbRaw
  };
}

const HEADER = `/* ==========================================================================
   core/offline-data.js —— 前端离线快照（自动生成，勿手改）
   --------------------------------------------------------------------------
   生成命令：node tools/gen-offline-data.mjs
   数据源  ：data/questions.json + data/kb.json
   ★ 含各题答案/解析，仅供「后端不可达」时的本地离线测试；线上接口不返回答案。
   ========================================================================== */
(function () {
  'use strict';
  var DS = (window.DS = window.DS || {});
  DS.OFFLINE = `;

const FOOTER = ';\n})();\n';

function renderJs(bundle) {
  // 紧凑序列化：文件体积直接计入首屏下载量
  return HEADER + JSON.stringify(bundle) + FOOTER;
}

function main() {
  const check = process.argv.includes('--check');
  const questionsRaw = JSON.parse(readFileSync(QUESTIONS_PATH, 'utf8'));
  const kbRaw = JSON.parse(readFileSync(KB_PATH, 'utf8'));

  const bundle = build(questionsRaw, kbRaw);
  const js = renderJs(bundle);

  if (check) {
    let cur;
    try {
      cur = readFileSync(OUT_PATH, 'utf8');
    } catch {
      console.log('offline-data.js 不存在，请运行 node tools/gen-offline-data.mjs 生成');
      return 1;
    }
    if (cur !== js) {
      console.log('offline-data.js 与数据源不一致，请重跑 node tools/gen-offline-data.mjs');
      return 1;
    }
    console.log('offline-data.js 已是最新');
    return 0;
  }

  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, js, 'utf8');

  const m = bundle.meta;
  console.log(
    `已写入 web/assets/js/core/offline-data.js —— ` +
      `题 ${m.quiz_total} / 类 ${m.quiz_categories} / 知识库 ${m.kb_entries} 条`
  );
  return 0;
}

process.exit(main());
