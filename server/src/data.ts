/* ==========================================================================
   server/src/data.ts —— 题库 / 知识库
   --------------------------------------------------------------------------
   懒加载 + mtime 热更新（改完 JSON 不用重启），文件缺失时给出可读错误而不是
   裸 ENOENT。id 规则（分类-序号，从 1 起）属于对外契约：离线快照
   web/data/offline.json 用同一套规则，两边错位会导致判题对不上题。
   ========================================================================== */

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { DATA_DIR } from './env';

export interface QuizItem {
  q: string;
  opts: string[];
  ans: number;
  exp: string;
  key: string;
  tag?: string;
  diff?: string;
}

export interface QuizQuestion extends QuizItem {
  id: string;
  category: string;
}

export interface QuizBank {
  [category: string]: { name?: string; questions: QuizItem[] };
}

export interface KbEntry {
  keywords: string[];
  answer: string;
  title?: string;
}

const QUIZ_PATH = join(DATA_DIR, 'questions.json');
const KB_PATH = join(DATA_DIR, 'kb.json');

interface QuizCache {
  mtimeMs: number;
  bank: QuizBank;
  index: Record<string, QuizQuestion>;
}

let quizCache: QuizCache | null = null;
let kbCache: { mtimeMs: number; entries: KbEntry[] } | null = null;

function readJson<T>(path: string): T {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `required data file missing: ${path}. 请检查仓库是否完整 clone，或设置正确的相对路径。`
      );
    }
    throw e;
  }
}

/** 把 {cat: {questions: [...]}} 摊平成 {qid: {..., id, category}}；id 从 1 起 */
function buildIndex(raw: QuizBank): Record<string, QuizQuestion> {
  const index: Record<string, QuizQuestion> = {};
  for (const [category, cat] of Object.entries(raw)) {
    (cat.questions ?? []).forEach((q, i) => {
      const id = `${category}-${i + 1}`;
      index[id] = { ...q, id, category };
    });
  }
  return index;
}

function loadQuiz(): QuizCache {
  const mtimeMs = statSync(QUIZ_PATH).mtimeMs;
  if (quizCache && quizCache.mtimeMs === mtimeMs) return quizCache;

  const bank = readJson<QuizBank>(QUIZ_PATH);
  quizCache = { mtimeMs, bank, index: buildIndex(bank) };
  return quizCache;
}

export function quizBank(): QuizBank {
  return loadQuiz().bank;
}

export function questionIndex(): Record<string, QuizQuestion> {
  return loadQuiz().index;
}

export function aiKb(): KbEntry[] {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(KB_PATH).mtimeMs;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `required data file missing: ${KB_PATH}. 请检查仓库是否完整 clone，或设置正确的相对路径。`
      );
    }
    throw e;
  }
  if (kbCache && kbCache.mtimeMs === mtimeMs) return kbCache.entries;
  const entries = readJson<KbEntry[]>(KB_PATH);
  kbCache = { mtimeMs, entries };
  return entries;
}

/** 启动时主动 warm 一次：缺文件就让进程起不来，而不是等第一个用户请求才 500 */
export function warmData(): { quizTotal: number; categories: number; kbEntries: number } {
  const index = questionIndex();
  const bank = quizBank();
  const entries = aiKb();
  return {
    quizTotal: Object.keys(index).length,
    categories: Object.keys(bank).length,
    kbEntries: entries.length
  };
}

/** 健康检查用；数据缺文件时不抛错，返回 data_ok=false，让健康检查本身还能应答 */
export function dataStats(): {
  quiz_total: number;
  quiz_categories: number;
  kb_entries: number;
  data_ok: boolean;
} {
  try {
    const index = questionIndex();
    return {
      quiz_total: Object.keys(index).length,
      quiz_categories: Object.keys(quizBank()).length,
      kb_entries: aiKb().length,
      data_ok: true
    };
  } catch (e) {
    console.warn('health: data file issue -> %s', (e as Error).message);
    return { quiz_total: 0, quiz_categories: 0, kb_entries: 0, data_ok: false };
  }
}
