/* ==========================================================================
   scripts/sw-manifest.mjs —— 生成 Service Worker 的预缓存清单与版本号
   --------------------------------------------------------------------------
   抽成独立模块而不是写在 build.mjs 里，是为了能被单元测试直接调用：
   「清单漏了文件」这类错误在浏览器里只表现为「离线某个页面白屏」，很难发现，
   必须有一条不依赖浏览器的断言盯着它。
   ========================================================================== */

import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** 产物里不需要预缓存的条目：SW 自身由浏览器按 URL 取，不能自己缓存自己 */
const EXCLUDE = new Set(['sw.js']);

/** 预缓存顺序：先 HTML（离线先能打开页面），再按路径排序，保证结果稳定可比 */
function order(a, b) {
  const ah = a.endsWith('.html') ? 0 : 1;
  const bh = b.endsWith('.html') ? 0 : 1;
  if (ah !== bh) return ah - bh;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * 递归收集产物里的全部文件，返回相对产物根、以 `/` 分隔的路径列表。
 * 统一成正斜杠：SW 里用 `new URL(path, BASE)` 解析，反斜杠在 Windows 产物上会出错。
 */
export async function collectPrecache(distDir) {
  const out = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(distDir, full).split(sep).join('/');
      if (EXCLUDE.has(rel)) continue;
      out.push(rel);
    }
  }

  await walk(distDir);
  return out.sort(order);
}

/**
 * 版本号 = 全部产物（路径 + 内容）+ SW 模板内容的 sha256 前 8 位。
 *
 * ★ 模板必须计入 ★ 否则只改 SW 自身的策略、页面产物一字不动时版本不变，
 *   浏览器认为 sw.js 没变 → 不安装新 SW → 旧逻辑永远留在用户的浏览器里。
 *   这类问题线上极难发现（「改了没生效」），所以模板字节是版本的一部分。
 *
 * 反过来，重复构建同一份代码版本不变，浏览器不会重新下载 400KB。
 * 注意：sw.js 本身在文件清单里被排除，模板用原文参与哈希，避免自我引用。
 */
export async function hashVersion(distDir, files, template) {
  const hash = createHash('sha256');
  if (template) {
    hash.update('sw-template\0');
    hash.update(template);
    hash.update('\0');
  }
  for (const rel of files) {
    hash.update(rel);
    hash.update('\0');
    hash.update(await readFile(join(distDir, rel)));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 8);
}

/** 把模板里的两处占位符替换成真实值；占位符不存在时直接报错，避免静默产出坏 SW */
export function renderSw(template, version, precache) {
  const versionMark = "'__SW_VERSION__'";
  const listMark = '__SW_PRECACHE__';
  if (template.indexOf(versionMark) === -1 || template.indexOf(listMark) === -1) {
    throw new Error('SW 模板缺少占位符 __SW_VERSION__ / __SW_PRECACHE__');
  }
  return template
    .replace(versionMark, JSON.stringify(version))
    .replace(listMark, JSON.stringify(precache, null, 2));
}

/** 汇总用：产物目录 → { version, precache, code } */
export async function buildSw(distDir, templatePath) {
  const template = await readFile(templatePath, 'utf8');
  const precache = await collectPrecache(distDir);
  const version = await hashVersion(distDir, precache, template);
  return { version, precache, code: renderSw(template, version, precache) };
}

/** 仅供测试/调试读取产物体积 */
export async function sizeOf(file) {
  return (await stat(file)).size;
}
