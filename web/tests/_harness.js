/* ==========================================================================
   tests/_harness.js —— 把页面入口打成经典脚本，供 jsdom 注入
   --------------------------------------------------------------------------
   背景：jsdom 不实现 ES module。实测 <script type="module"> 会被静默忽略
   （既不执行也不报错），而源码已改为「单入口 + ESM」。若不处理，4 个集成
   测试会拿到一个 window.DS 根本不存在的页面，全部断言假红。

   做法：用 esbuild（Vite 的同款打包器）把 entries/<page>.js 连同其
   全部 import 打成一个 iife 经典脚本，再由测试调用 win.eval() 注入。等价于
   改造前「按顺序执行多条 <script src>」的效果，且不依赖任何网络请求。

   为什么不用 Vite 自己的 build 产物：产物仍是 module 脚本，jsdom 同样不认；
   这里要的是经典脚本形态，esbuild 直接给到。
   ========================================================================== */
'use strict';

const path = require('path');

const esbuild = require('esbuild');

const WEB_ROOT = path.resolve(__dirname, '..');

/** 页面 → 入口文件。新增页面时这里与 entries/ 一并登记。 */
const ENTRY_BY_PAGE = {
  'index.html': 'entries/index.js',
  'list.html': 'entries/list.js',
  'quiz.html': 'entries/quiz.js',
  'ai.html': 'entries/ai.js',
  'visual.html': 'entries/visual.js'
};

const cache = new Map();

/** 打包某个入口，返回经典脚本源码（同一进程内复用） */
async function bundleEntry(entryRelPath) {
  if (cache.has(entryRelPath)) return cache.get(entryRelPath);

  const out = await esbuild.build({
    absWorkingDir: WEB_ROOT,
    entryPoints: [path.join(WEB_ROOT, entryRelPath)],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
    logLevel: 'silent'
    /* core/api.js 读 import.meta.env 决定 API 基址。esbuild 打成 iife 时会按规范
       把 import.meta 置为空对象（相当于 import.meta.env === undefined），源码里
       「import.meta.env || {}」自然退化为 {}，于是走「默认 127.0.0.1:8000 + 同源
       判定」分支 —— 与改造前行为一致（测试的 JSDOM url 就是 127.0.0.1:8000）。
       注意：不要再用 define 覆盖 import.meta.env，esbuild 只接受实体名或 JS 字面量，
       传 '({})' 会直接构建失败。 */
  });

  const code = out.outputFiles[0].text;
  cache.set(entryRelPath, code);
  return code;
}

/** 按页面名注入对应入口脚本 */
async function injectPage(win, htmlName) {
  const entry = ENTRY_BY_PAGE[htmlName];
  if (!entry) throw new Error('_harness: 未登记的页面入口 -> ' + htmlName);
  win.eval(await bundleEntry(entry));
}

module.exports = { bundleEntry, injectPage, ENTRY_BY_PAGE, WEB_ROOT };
