/* ==========================================================================
   vite.config.mjs —— 多页构建配置
   --------------------------------------------------------------------------
   ★ 后端零改动 ★
     服务端 CORS 白名单只含 8000/5500 端口，不含 5173。因此 dev 阶段不靠放宽
     CORS，而是由 dev server 把 /api 反向代理到 127.0.0.1:8000，前端一律走
     相对路径（见 core/api.js 里 ENV.DEV 分支）。

   ★ base: './' ★
     产物用相对路径引用资源，可直接部署到任意子路径（如 /lectai/），
     也便于用 vite preview 或静态服务器直接打开。

   ★ 多页入口 ★
     5 个 HTML 各自是一个入口，保持现有页面跳转（含 #hash 路由）不变；
     每个入口只 import 对应的 src/entries/<page>.js。

   ★ cacheDir 指到仓库根 ★
     Vite 默认把依赖预构建缓存写进 <root>/node_modules/.vite，而本仓库用
     hoisted 布局，web/ 下刻意没有 node_modules。指到根的 node_modules/.vite-web，
     子包目录就保持干净（根 node_modules 本来就整体 gitignore）。
   ========================================================================== */

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const cacheDir = fileURLToPath(new URL('../node_modules/.vite-web', import.meta.url));

const BACKEND = process.env.LECTAI_BACKEND || 'http://127.0.0.1:8000';

export default defineConfig({
  root,
  base: './',
  cacheDir,

  // 没有 public/ 目录，显式关掉以免未来误建目录时行为不可预期
  publicDir: false,

  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: false,
      },
    },
  },

  preview: {
    port: 4173,
  },

  build: {
    // 产物统一落到仓库根 dist/web（与 dist/server 并列，一个 dist/ 就是完整发布物）。
    // 路径相对 web/ 根，vite preview 也从这里取。
    outDir: '../dist/web',
    emptyOutDir: true,
    assetsDir: 'assets',
    // 与源码保持一致的语法水位；本项目的目标浏览器为现代 Chromium/Firefox
    target: 'es2020',
    // ★ 入口不在此处声明 ★
    // 生产构建由 scripts/build.mjs 逐页执行（每页一个 input）。原因是 5 个页面的
    // 模块之间没有 ESM 依赖边（全靠 window.DS 通信），多入口构建会把共享模块拆成
    // 并列的 <script>，Rollup 无从表达「keys 先于页面逻辑」而导致执行顺序错乱。
    // 详见 scripts/build.mjs 文件头。
  },
});
