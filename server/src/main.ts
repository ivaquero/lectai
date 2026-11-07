/* ==========================================================================
   server/src/main.ts —— 进程入口
   --------------------------------------------------------------------------
   启动顺序与 main.py 的「import 即 warm 数据」等价：数据文件缺失时直接退出，
   而不是等第一个用户请求才 500。两种情况都要在日志里说清原因。
   ========================================================================== */

import { buildApp } from './app';
import { warmData } from './data';
import { HOST, PORT } from './env';

try {
  const stats = warmData();
  // eslint-disable-next-line no-console -- 启动横幅必须先于 Fastify logger 输出
  console.log(
    `[lectai] 数据已就绪：${stats.categories} 个分类 / ${stats.quizTotal} 题 / 知识库 ${stats.kbEntries} 条`
  );
} catch (e) {
  console.error('[lectai] 启动失败：数据文件不可用 →', (e as Error).message);
  process.exit(1);
}

const app = buildApp();

try {
  await app.listen({ host: HOST, port: PORT });
} catch (e) {
  app.log.error({ err: e }, '监听失败');
  process.exit(1);
}

// 容器/终端收到终止信号时优雅关闭：让在途请求先完成
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info(`收到 ${signal}，正在关闭`);
    void app.close().then(() => process.exit(0));
  });
}
