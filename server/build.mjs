/* ==========================================================================
   server/build.mjs —— 用 esbuild 把服务打成一个 ESM 文件
   --------------------------------------------------------------------------
   为什么不用 tsc 产出：只有一个入口，esbuild 打包能做到「单文件 + 内联引擎 +
   保留依赖为 external」，比 tsc 的逐文件产物更好部署；类型检查仍交给
   `tsc --noEmit`（pnpm typecheck），两者职责分开。

   用法：
     node build.mjs            一次性构建 → dist/server.mjs
     node build.mjs --watch    监听改动：重建 + 重启子进程（开发用）
   ========================================================================== */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as esbuild from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = HERE;
const OUT = resolve(ROOT, 'dist', 'server.mjs');

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: [resolve(ROOT, 'src', 'main.ts')],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // 依赖留在 node_modules：fastify 及其插件带动态 require，打进来反而脆弱
  packages: 'external',
  sourcemap: true,
  logLevel: 'info'
};

if (!watch) {
  await esbuild.build(options);
  process.exit(0);
}

/* ------------------------------------------------------------ 开发模式 */

let child = null;
let restarting = false;

function startServer() {
  child = spawn(process.execPath, [OUT], { stdio: 'inherit' });
  child.on('exit', (code) => {
    if (!restarting && code !== null && code !== 0) {
      console.error(`[dev] 服务退出（code ${code}），等待下一次改动`);
    }
  });
}

async function restart() {
  if (child) {
    restarting = true;
    child.kill();
    await new Promise((r) => child.on('exit', r));
    restarting = false;
  }
  startServer();
}

const ctx = await esbuild.context({
  ...options,
  plugins: [
    {
      name: 'restart-on-rebuild',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length) return;
          if (child === null) startServer();
          else void restart();
        });
      }
    }
  ]
});

await ctx.watch();
console.log('[dev] 监听 src/ 改动，重建后自动重启');
