/* ==========================================================================
   server/quiz.ts —— 题库接口
   --------------------------------------------------------------------------
   契约要点（不能改）：
     · 取题接口永不返回 ans / exp / key —— 防作弊，判题只能在服务端做；
     · 判题结果带 answer_content_type / key_point_content_type，
       前端据此决定用 textContent 还是 sanitize 后的 innerHTML；
     · 统计按会话累计，accuracy 保留一位小数且必须是银行家舍入（见 round1）。
   ========================================================================== */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { questionIndex, quizBank } from './data';
import { err, intField, ok, queryField, stringField } from './http';
import { getSession } from './session';

const LETTERS = 'ABCD';

function sid(req: FastifyRequest): string | string[] | undefined {
  return req.headers['x-session-id'] as string | string[] | undefined;
}

/**
 * 银行家舍入（round half to even）：Math.round 是「五入」，遇到 1/16 → 6.25
 * 这类正好落在 .x5 的值会与既有统计差 0.1。契约快照里 accuracy 是逐字节比对的，
 * 所以这里显式实现，而不是依赖 toFixed 的近似行为。
 */
function round1(x: number): number {
  const scaled = x * 10;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  if (Math.abs(frac - 0.5) < 1e-9) {
    return (floor % 2 === 0 ? floor : floor + 1) / 10;
  }
  return Math.round(scaled) / 10;
}

export function registerQuizRoutes(app: FastifyInstance): void {
  app.get('/api/quiz/categories', async () => {
    const bank = quizBank();
    const categories = Object.entries(bank).map(([key, cat]) => ({
      key,
      name: cat.name ?? key,
      count: (cat.questions ?? []).length
    }));
    return ok({
      categories,
      total: categories.reduce((sum, c) => sum + c.count, 0)
    });
  });

  app.get('/api/quiz/questions', async (req) => {
    const category = queryField(req.query, 'category');
    const bank = quizBank();
    if (!Object.prototype.hasOwnProperty.call(bank, category)) {
      return err(`未知分类 ${category}，可用：${Object.keys(bank).join(', ')}`);
    }
    const questions = (bank[category].questions ?? []).map((q, i) => ({
      id: `${category}-${i + 1}`,
      tag: q.tag ?? '',
      question: q.q,
      options: q.opts, // 4 个选项，下标 0~3 对应 A~D
      difficulty: q.diff ?? 'mid' // basic / mid / hard
    }));
    return ok({
      category,
      name: bank[category].name ?? category,
      total: questions.length,
      questions
    });
  });

  app.post('/api/quiz/submit', async (req) => {
    // 先做参数校验（对齐 Pydantic：校验失败 422，先于业务判断）
    const questionId = stringField(req.body, 'question_id', { minLength: 1, maxLength: 64 });
    const answer = intField(req.body, 'answer', { min: 0, max: 3 });

    const q = questionIndex()[questionId];
    if (!q) return err(`题目不存在：${questionId}`);

    const correct = answer === q.ans;
    const session = getSession(sid(req));
    const stat = (session.quizStats[q.category] ??= { done: 0, right: 0 });
    stat.done += 1;
    if (correct) stat.right += 1;

    return ok({
      question_id: q.id,
      difficulty: q.diff ?? 'mid',
      correct,
      answer_index: q.ans,
      answer_letter: LETTERS[q.ans],
      answer_text: q.opts[q.ans],
      explanation: q.exp,
      explanation_content_type: 'trusted_html',
      key_point: q.key,
      key_point_content_type: 'trusted_html',
      msg: correct ? '✅ 回答正确！' : `❌ 回答错误，正确答案是 ${LETTERS[q.ans]}`
    });
  });

  app.get('/api/quiz/stats', async (req) => {
    const stats = getSession(sid(req)).quizStats;
    const categories: Record<string, { done: number; right: number; accuracy: number }> = {};
    let totalDone = 0;
    let totalRight = 0;

    for (const [key, v] of Object.entries(stats)) {
      categories[key] = {
        done: v.done,
        right: v.right,
        accuracy: v.done ? round1((v.right / v.done) * 100) : 0.0
      };
      totalDone += v.done;
      totalRight += v.right;
    }

    return ok({ categories, total_done: totalDone, total_right: totalRight });
  });
}
