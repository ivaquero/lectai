/* ==========================================================================
   server/src/routes/health.ts —— 健康检查
   --------------------------------------------------------------------------
   字段名与顺序属于对外契约：前端 probe() 会把它整体存进 DS.backend.info，
   导航徽标直接读 quiz_total。改动会打进契约快照，需刻意 review。
   ========================================================================== */

import type { FastifyInstance } from 'fastify';

import { dataStats } from '../data';
import { ok } from '../http';
import { sessionCount, sessionStats } from '../session';

/** 进程启动时刻：uptime 从服务起来算，不从模块被 import 算错 */
const START = Date.now();

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () =>
    ok({
      service: '数据结构学习平台后端',
      version: '1.1.0', // 对外契约版本号；改动同步 tests/golden/http-contract.json
      uptime_sec: Math.round((Date.now() - START) / 100) / 10,
      sessions: sessionCount(),
      session_policy: sessionStats(),
      ...dataStats()
    })
  );
}
