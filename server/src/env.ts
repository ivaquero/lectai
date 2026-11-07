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
 * 题库 / 知识库位置。
 *
 * 迁移期刻意指向 backend/data：Node 与 Python 读同一份 JSON，HTTP 对齐测试里
 * 任何差异就只可能来自代码而不是数据。Python 侧退场时把这两个文件挪到仓库根
 * data/，改这里一行即可（见 server/README.md 的切换清单）。
 */
export const DATA_DIR = process.env.LECTAI_DATA_DIR ?? resolve(REPO_ROOT, 'backend', 'data');

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

/** 与 core/session.py 的同名环境变量保持一致 */
export const SESSION_TTL_SEC = Number(process.env.LECTAI_SESSION_TTL ?? 3600);
export const SESSION_MAX = Number(process.env.LECTAI_SESSION_MAX ?? 10000);

/** CORS 白名单，逗号分隔；默认值与 main.py 的 _resolve_origins 完全一致 */
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
