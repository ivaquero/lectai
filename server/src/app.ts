/* ==========================================================================
   server/src/app.ts —— 应用装配
   --------------------------------------------------------------------------
   ★ 顺序不是风格问题，是正确性问题 ★
     Fastify 的 register 返回 thenable，await 它会触发整实例的 ready()。
     ready() 之后再调用 setErrorHandler / setNotFoundHandler 会被静默忽略——
     实测表现是：参数校验虽然还是 422，但外壳退回 Fastify 默认的
     {statusCode,error,message}，而不是我们要的 {code,msg,data}。
     所以：两个处理器必须先装在根上下文，装配期间不 await register。

   装配顺序：
     CORS → /visual.html 重定向（必须早于静态，否则真文件会被命中）
     → 业务路由 → 静态托管

   为什么 /api/* 兜底不能省：拼错的 /api/xxx 若掉进静态兜底会返回首页 HTML(200)，
   前端 request() 解析 JSON 失败后会误判成「后端离线」，整站切到离线模式。
   ========================================================================== */

import { existsSync } from 'node:fs';

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import { registerAiRoutes } from './ai';
import { LOG_LEVEL, STATIC_DIR, allowedOrigins } from './env';
import { registerHealthRoutes } from './health';
import { HttpError } from './http';
import { registerQuizRoutes } from './quiz';
import { registerTraceRoutes } from './trace';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: LOG_LEVEL },
    // 本项目最大请求体是 build 的 values（12 个整数），1MB 已是极宽松的上限
    bodyLimit: 1024 * 1024
  });

  /* ---- 1. 先装处理器（见文件头说明） ---- */

  app.setNotFoundHandler((req, reply) => {
    const pathname = new URL(req.raw.url ?? '/', 'http://localhost').pathname;
    if (pathname.startsWith('/api/')) {
      return reply.code(404).send({ code: 1, msg: `接口不存在：${pathname}`, data: null });
    }
    return reply.code(404).send({ code: 1, msg: '资源不存在', data: null });
  });

  app.setErrorHandler((error, req, reply) => {
    // 参数校验失败：422 + 可读文案（body 里保留 detail，便于调试）
    if (error instanceof HttpError) {
      return reply
        .code(error.status)
        .send({ code: 1, msg: error.message, data: null, detail: error.detail });
    }

    // Fastify 5 把 error 标成 unknown，这里显式收窄成它实际携带的字段
    const e = error as { statusCode?: number; message?: string };
    const status = e.statusCode ?? 500;

    // Fastify 自己抛的「请求体不是合法 JSON」：统一收成 422（参数校验失败语义）
    if (status === 400) {
      return reply.code(422).send({ code: 1, msg: '请求体不是合法 JSON', data: null });
    }
    if (status < 500) {
      return reply.code(status).send({ code: 1, msg: e.message ?? '请求失败', data: null });
    }

    req.log.error({ err: error }, '未捕获异常');
    return reply.code(500).send({ code: 1, msg: '服务器内部错误', data: null });
  });

  /* ---- 2. 插件与路由：一律不 await，交给 listen 时统一 boot ---- */

  app.register(cors, {
    origin: allowedOrigins(),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Session-Id'],
    exposedHeaders: ['X-Session-Id'],
    credentials: false
  });

  // 旧入口兼容：visual.html 曾是多模块页的早期形态，统一收口到 list.html
  app.get('/visual.html', async (_req, reply) => reply.redirect('/list.html', 302));

  registerHealthRoutes(app);
  registerTraceRoutes(app);
  registerQuizRoutes(app);
  registerAiRoutes(app);

  if (existsSync(STATIC_DIR)) {
    app.register(fastifyStatic, {
      root: STATIC_DIR,
      prefix: '/',
      index: ['index.html']
    });
    app.log.info(`静态托管：${STATIC_DIR}`);
  } else {
    app.log.warn(`静态目录不存在，仅提供 API：${STATIC_DIR}`);
  }

  return app;
}
