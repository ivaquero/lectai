/* ==========================================================================
   server/src/env.ts —— 运行期配置（全部走环境变量，代码里不写死路径）
   --------------------------------------------------------------------------
   为什么路径要按 import.meta.url 推：src/ 与 dist/ 只差一层，打包前后都能
   正确定位到 server/ 与仓库根，不依赖 process.cwd()（从哪个目录启动都行）。
   ========================================================================== */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // server/src 或 server/dist
export const SERVER_ROOT = resolve(HERE, '..');
export const REPO_ROOT = resolve(SERVER_ROOT, '..');

export const HOST = process.env.LECTAI_HOST ?? '127.0.0.1';
export const PORT = Number(process.env.LECTAI_PORT ?? 8000);

/**
 * 题库 / 知识库位置：仓库根 data/{questions,kb}.json。
 * 与其他数据表（cpp-stl-*.csv 等）同处一个目录，构建期工具与运行期服务读同一份。
 */
export const DATA_DIR = process.env.LECTAI_DATA_DIR ?? resolve(REPO_ROOT, 'data');

/**
 * 静态托管目录：显式指定优先；否则 dist 存在就用 dist（发布物，含 sw.js），
 * 否则用源码目录 web/（改完刷新即可，不用先构建）。
 */
function resolveStaticDir(): string {
  const explicit = process.env.LECTAI_STATIC_DIR;
  if (explicit) return resolve(REPO_ROOT, explicit);

  const dist = resolve(REPO_ROOT, 'web', 'dist');
  if (existsSync(resolve(dist, 'index.html'))) return dist;
  return resolve(REPO_ROOT, 'web');
}

export const STATIC_DIR = resolveStaticDir();

/** 会话策略：TTL 秒数 + 会话数上限（超出按 LRU 淘汰） */
export const SESSION_TTL_SEC = Number(process.env.LECTAI_SESSION_TTL ?? 3600);
export const SESSION_MAX = Number(process.env.LECTAI_SESSION_MAX ?? 10000);

/** CORS 白名单，逗号分隔；默认值覆盖本地开发端口与 file:// 直开两种场景 */
export function allowedOrigins(): string[] {
  const raw = (process.env.ALLOWED_ORIGINS ?? '').trim();
  if (!raw) {
    return [
      'http://127.0.0.1:8000',
      'http://localhost:8000',
      'http://127.0.0.1:5500', // VSCode Live Server 常用端口
      'http://localhost:5500',
      'null' // file:// 打开时浏览器的 Origin
    ];
  }
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const LOG_LEVEL = (process.env.LECTAI_LOG_LEVEL ?? 'info').toLowerCase();
