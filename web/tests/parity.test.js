/* ==========================================================================
   web/tests/parity.test.js —— TS 引擎 ↔ golden 快照 逐字节对齐
   --------------------------------------------------------------------------
   这一步是移植的验收关。为什么必须做：渲染层只按 step.mark 上色、按 step.ptr
   定位，引擎移植错了不会抛异常，只会「颜色偶尔不对」「指针闪一下」。类型系统
   也抓不到——类型对、语义错。唯一可靠的判据是拿同一份操作脚本喂两边，比对
   每一个快照的每个字段。

   数据来源：
     web/tests/trace-cases.json      操作脚本
     web/tests/trace-cases.golden.json  冻结参考实现（迁移期的 Python 版
                                               algo/*_trace.py）导出的行为快照

   golden 已冻结，不再重新生成——它就是「曾经的权威语义」。要新增场景就在
   trace-cases.json 里加用例，并按同一形状手工补 golden，再在 PR 里逐字段 review。
   改了引擎却让这个测试红，先怀疑引擎，不要直接改 golden。

   运行：仓库根 pnpm test:parity （不需要后端在跑）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const esbuild = require('esbuild');

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + label);
  } else {
    failed++;
    console.log('  ✗ ' + label);
  }
}

function section(t) {
  console.log('\n== ' + t + ' ==');
}

/* ---------------------------------------------------------------- 装载引擎 */

/** 用 esbuild 把 TS 引擎打成 CJS 后编译进内存，避免落临时文件 */
function loadEngine() {
  const entry = path.join(__dirname, '..', 'engine', 'index.ts');
  const out = esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'silent',
  });
  const filename = path.join(__dirname, '..', 'engine', '__bundled.js');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(out.outputFiles[0].text, filename);
  return m.exports;
}

/* ------------------------------------------------------------ 深度比对工具 */

const { diff } = require('./_diff.js');

/* -------------------------------------------------------------- 场景重放器 */

function makeRunner(E, container) {
  if (container === 'list') {
    E.list.resetIds();
    const c = new E.list.TraceList();
    return {
      handlers: {
        build: (s) => E.list.opBuild(c, s.values || []),
        'insert-head': (s) => E.list.opInsertHead(c, s.value),
        'insert-tail': (s) => E.list.opInsertTail(c, s.value),
        'delete-pos': (s) => E.list.opDeletePos(c, s.pos),
        'delete-value': (s) => E.list.opDeleteValue(c, s.value),
        search: (s) => E.list.opSearch(c, s.value),
        traverse: () => E.list.opTraverse(c),
      },
      state: () => E.list.statePayload(c),
      errors: [E.list.OpError],
    };
  }
  if (container === 'stack') {
    E.stack.resetIds();
    const c = new E.stack.TraceStack();
    return {
      handlers: {
        build: (s) => E.stack.opBuild(c, s.values || []),
        push: (s) => E.stack.opPush(c, s.value),
        pop: () => E.stack.opPop(c),
        peek: () => E.stack.opPeek(c),
        traverse: () => E.stack.opTraverse(c),
      },
      state: () => E.stack.statePayload(c),
      errors: [E.stack.OpError],
    };
  }
  E.queue.resetIds();
  const c = new E.queue.TraceQueue();
  return {
    handlers: {
      build: (s) => E.queue.opBuild(c, s.values || []),
      enqueue: (s) => E.queue.opEnqueue(c, s.value),
      dequeue: () => E.queue.opDequeue(c),
      peek: () => E.queue.opPeek(c),
      traverse: () => E.queue.opTraverse(c),
    },
    state: () => E.queue.statePayload(c),
    errors: [E.queue.OpError],
  };
}

function replay(E, kase) {
  const runner = makeRunner(E, kase.container);
  const outputs = [];
  let error = null;

  for (let i = 0; i < kase.steps.length; i += 1) {
    const step = kase.steps[i];
    const fn = runner.handlers[step.op];
    if (!fn) throw new Error(`未知操作 ${step.op}`);
    try {
      outputs.push(fn(step));
    } catch (e) {
      if (!runner.errors.some((C) => e instanceof C)) throw e;
      error = { index: i, message: e.message };
      break;
    }
  }

  return { outputs, state: runner.state(), error };
}

/* -------------------------------------------------------------------- 主流程 */

function main() {
  const E = loadEngine();

  const scenarios = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'trace-cases.json'), 'utf8'),
  ).cases;
  const golden = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'trace-cases.golden.json'), 'utf8'),
  );

  section('基线自检');
  ok(golden.length === scenarios.length, `golden 场景数与脚本一致（${golden.length}）`);
  const goldenSteps = golden.reduce(
    (n, g) => n + g.outputs.reduce((m, o) => m + (o.trace || []).length, 0),
    0,
  );
  ok(goldenSteps > 500, `golden 覆盖快照 ${goldenSteps} 个（应 > 500）`);

  section('逐场景对齐');
  for (const g of golden) {
    const kase = scenarios.find((s) => s.name === g.name);
    ok(!!kase, `${g.name}: 场景脚本存在`);
    if (!kase) continue;

    const got = replay(E, kase);

    ok(got.outputs.length === g.outputs.length, `${g.name}: 操作次数一致（${got.outputs.length}）`);

    let mismatch = diff(got.error, g.error, 'error');
    if (!mismatch) {
      for (let i = 0; i < g.outputs.length; i += 1) {
        mismatch = diff(got.outputs[i], g.outputs[i], `outputs[${i}]`);
        if (mismatch) break;
      }
    }
    if (!mismatch) mismatch = diff(got.state, g.state, 'state');

    ok(
      !mismatch,
      `${g.name}: ` + (mismatch ? `快照不一致 → ${mismatch}` : '快照整体一致'),
    );
  }

  console.log('\n----------------------------------------');
  console.log(`通过 ${passed} / ${passed + failed}`);
  process.exit(failed ? 1 : 0);
}

main();
