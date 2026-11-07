/* ==========================================================================
   tests/run-all.cjs —— 顺序跑完全部集成测试
   --------------------------------------------------------------------------
   各测试文件结尾会 process.exit()，因此必须逐个子进程运行，不能同进程 import。

   前提：后端已在 127.0.0.1:8000 运行
         cd backend && uv run uvicorn main:app --port 8000
   用法：cd web && npm test
   ========================================================================== */
'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const TESTS = ['sw', 'parity', 'offline-engine', 'list-page', 'quiz-ai', 'offline', 'visual-stackqueue'];

let failedSuites = 0;

for (const name of TESTS) {
  console.log('\n#################### ' + name + ' ####################');
  const r = spawnSync(process.execPath, [path.join(__dirname, name + '.test.js')], {
    stdio: 'inherit'
  });
  if (r.status !== 0) failedSuites++;
}

console.log('\n========================================');
console.log(failedSuites ? '有 ' + failedSuites + ' 个套件未全绿' : '全部套件通过');
process.exit(failedSuites ? 1 : 0);
