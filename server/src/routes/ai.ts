/* ==========================================================================
   server/src/routes/ai.ts —— AI 答疑（main.py §5 的对等实现）
   --------------------------------------------------------------------------
   当前仍是「本地知识库命中 → 模拟回答」两段式，大模型是预留位。
   打分规则与 Python 逐字一致：关键词是小写子串匹配，命中数严格大于当前最优
   才替换，因此并列时取知识库里靠前的那条。
   ========================================================================== */

import type { FastifyInstance } from 'fastify';

import { aiKb } from '../data';
import type { KbEntry } from '../data';
import { ok, stringField } from '../http';

function kbMatch(question: string): KbEntry | null {
  const q = question.toLowerCase();
  let best: KbEntry | null = null;
  let bestScore = 0;

  for (const item of aiKb()) {
    const score = (item.keywords ?? []).filter((k) => q.includes(k.toLowerCase())).length;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/** 大模型接入位：接上后把 ask 里的第 ③ 段换成它，并把 content_type 改 plain_text */
export async function callLlm(_question: string): Promise<string> {
  throw new Error('大模型尚未接入');
}

export function registerAiRoutes(app: FastifyInstance): void {
  app.post('/api/ai/ask', async (req) => {
    const raw = stringField(req.body, 'question', { minLength: 1, maxLength: 500 });
    const question = raw.trim();

    // ① 本地知识库命中
    const hit = kbMatch(question);
    if (hit) {
      return ok({
        answer: hit.answer,
        answer_content_type: 'trusted_html', // 来自仓库内置 kb.json
        title: hit.title ?? null,
        source: 'local_kb',
        model: null
      });
    }

    // ② 大模型（预留：await callLlm(question)，content_type 改 plain_text）
    // ③ 模拟回答
    const mock =
      `<p>【模拟回答】已收到你的提问：「${question}」。</p>` +
      '<p>大模型接口尚未接入。当前后端内置了本地知识库，' +
      '你可以换个包含<b>数据结构术语</b>的问法（例如「KMP 的 next 数组怎么求」' +
      '「快速排序为什么最坏 O(n²)」「循环队列怎么判满」），就能命中真实答案。</p>' +
      "<p class='text-muted'>接入大模型后，本接口将返回真实解答，前端无需改动。</p>";

    return ok({
      answer: mock,
      answer_content_type: 'trusted_html', // 本函数硬编码生成，可信
      title: null,
      source: 'mock',
      model: null
    });
  });
}
