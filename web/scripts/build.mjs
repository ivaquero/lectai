/* ==========================================================================
   scripts/build.mjs —— 逐页构建（生产产物）
   --------------------------------------------------------------------------
   为什么不一次性多入口构建？

   本项目 5 个页面的模块之间**没有 ESM 依赖边**：每个模块都是 IIFE，彼此只通过
   window.DS 这个全局命名空间通信。多入口构建时，被多页共享的模块（keys.js、
   parse.js、pages/list/*）会被拆成独立 chunk，而 Rollup 无法用 import 语句表达
   「keys 必须先于 pages/list/index 执行」——因为没有这条边。产物 HTML 于是变成
   若干并列的 <script type="module">，按标签顺序执行，页面逻辑跑到 keymap 之前，
   表现为 DS.keys 为 undefined、首屏序列空着、控制台报 reading 'bind'。

   逐页构建后，每页只有一个输入：静态导入全部并入该页的唯一 chunk，动态导入
   （offline-data 快照，75KB）仍是独立 chunk、保持按需加载。执行顺序由 ESM 语义
   保证，不再依赖标签顺序。

   用法：npm run build
   ========================================================================== */

import { rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { build } from 'vite';

import baseConfig from '../vite.config.mjs';
import { buildSw } from './sw-manifest.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const PAGES = ['index', 'list', 'quiz', 'ai', 'visual'];

await rm(resolve(root, 'dist'), { recursive: true, force: true });

for (const page of PAGES) {
  await build({
    ...baseConfig,
    configFile: false,
    logLevel: 'warn',
    build: {
      ...baseConfig.build,
      emptyOutDir: false, // 由上面的 rm 统一清空，避免逐页互相覆盖
      rollupOptions: { input: resolve(root, `${page}.html`) },
    },
  });
  console.log(`  ✓ ${page}.html`);
}

/* Service Worker 必须最后生成：预缓存清单要覆盖上面 5 页产出的全部 HTML/JS/CSS。
   版本号由产物内容哈希得出，因此这一步不改动任何已有文件的字节。 */
const dist = resolve(root, 'dist');
const sw = await buildSw(dist, resolve(root, 'src/sw/sw.js'));
await writeFile(resolve(dist, 'sw.js'), sw.code, 'utf8');
console.log(`  ✓ sw.js  v${sw.version}  预缓存 ${sw.precache.length} 项`);

console.log(`构建完成：${PAGES.length} 页 + sw.js → dist/`);
