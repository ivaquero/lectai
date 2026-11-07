/* ==========================================================================
   web/tests/offline-engine.test.js —— 离线 REST 适配层 ↔ golden 对齐
   --------------------------------------------------------------------------
   parity.test.js 验的是「引擎函数 = golden 快照里的语义」。这一层验的是它上面那层：
   `POST /api/linkedlist/trace/delete-pos {pos:2}` 这种路径 + 请求体，经
   src/engine/offline.ts 映射后，返回的载荷是否**和线上服务逐字节一致**。

   为什么单独测：适配层是纯新增代码，parity 覆盖不到。写错一个 `body.pos`
   就会变成「位序永远是 undefined」——类型系统看不出来，页面上表现为越界报错，
   只有真的比 payload 才能发现。

   运行：cd web && node tests/offline-engine.test.js （不需要后端）
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

const esbuild = require('esbuild');

const { diff } = require('./_diff.js');

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label); }
}

function section(t) { console.log('\n== ' + t + ' =='); }

/* ------------------------------------------------------------- 环境垫片 */

/* 引擎桥用 sessionStorage 存容器状态（只存 values）。Node 里没有，先给一个
   最小实现，才能验证「刷新后状态还在」这件事。 */
function installSessionStorage() {
  const m = new Map();
  globalThis.sessionStorage = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => { m.clear(); },
  };
}

/* --------------------------------------------------------------- 装载 */

/** 桥接层与引擎打进同一个 bundle，保证共享模块实例（容器 / id 计数器） */
function loadModules() {
  const WEB_ROOT = path.resolve(__dirname, '..');
  const out = esbuild.buildSync({
    stdin: {
      contents: [
        "export * as bridge from './src/engine/offline.ts';",
        "export * as engine from './src/engine/index.ts';",
      ].join('\n'),
      resolveDir: WEB_ROOT,
      loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'silent',
  });
  const filename = path.join(WEB_ROOT, 'src', '__offline_bundle.js');
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(out.outputFiles[0].text, filename);
  return m.exports;
}

/* --------------------------------------------------------- 路径与请求体 */

const MODULE_OF = { list: 'linkedlist', stack: 'stack', queue: 'queue' };

function tracePath(kind, op) {
  return `/api/${MODULE_OF[kind]}/trace/${op}`;
}

/** 场景步骤 {op, values|value|pos, ...} → 请求体（去掉 op 本身） */
function bodyOf(step) {
  const body = {};
  Object.keys(step).forEach((k) => {
    if (k !== 'op') body[k] = step[k];
  });
  return body;
}

/* ------------------------------------------------------------------ 主流程 */

function main() {
  installSessionStorage();
  const { bridge: B, engine: E } = loadModules();

  const scenarios = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'trace-cases.json'), 'utf8'),
  ).cases;
  const golden = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'trace-cases.golden.json'), 'utf8'),
  );

  section('操作注册表（/ops）');
  [
    { kind: 'list', module: 'linkedlist', max: E.list.MAX_NODES, table: E.OPS.list },
    { kind: 'stack', module: 'stack', max: E.stack.MAX_ITEMS, table: E.OPS.stack },
    { kind: 'queue', module: 'queue', max: E.queue.MAX_ITEMS - 1, table: E.OPS.queue },
  ].forEach(({ kind, module, max, table }) => {
    const r = B.handle('GET', `/api/${module}/ops`);
    ok(!!r && r.ok === true, `${module}: /ops 有应答`);
    if (!r || !r.ok) return;
    const d = r.data;
    ok(d.module === module, `${module}: module 字段正确（${d.module}）`);
    ok(d.max_nodes === max, `${module}: max_nodes = ${max}`);
    const keys = d.ops.map((o) => o.key).join(',');
    ok(keys === Object.keys(table).join(','), `${module}: ops 键与引擎注册表一致（${keys}）`);
    ok(d.ops.every((o) => typeof o.title === 'string' && Array.isArray(o.lines)
      && Array.isArray(o.structural)), `${module}: 每条都带 title/lines/structural`);
  });

  section('空状态（/trace/state）');
  ['list', 'stack', 'queue'].forEach((kind) => {
    B.reset();
    const r = B.handle('GET', tracePath(kind, 'state'));
    ok(!!r && r.ok && r.data.length === 0, `${kind}: 空容器 state.length = 0`);
    ok(r.data.max_nodes > 0 && Array.isArray(r.data.trace), `${kind}: state 带 max_nodes 与空 trace`);
  });

  section('逐场景对齐（REST 路径 → 引擎 → golden）');
  for (const g of golden) {
    const kase = scenarios.find((s) => s.name === g.name);
    ok(!!kase, `${g.name}: 场景脚本存在`);
    if (!kase) continue;

    /* 每个场景重新起一个会话，并重置 id 计数器 —— golden 就是这么导出的，
       不重置的话 id 会随执行顺序漂移，比对必然失败。 */
    B.reset();
    const mod = E[kase.container];
    mod.resetIds();

    const outputs = [];
    let error = null;

    for (let i = 0; i < kase.steps.length; i += 1) {
      const step = kase.steps[i];
      const r = B.handle('POST', tracePath(kase.container, step.op), bodyOf(step));
      if (!r) { error = { index: i, message: `<未接管: ${step.op}>` }; break; }
      if (!r.ok) { error = { index: i, message: r.msg }; break; }
      outputs.push(r.data);
    }

    const stateResp = B.handle('GET', tracePath(kase.container, 'state'));

    let mismatch = diff(error, g.error, 'error');
    if (!mismatch) {
      if (outputs.length !== g.outputs.length) {
        mismatch = `outputs.length: 期望 ${g.outputs.length}，实际 ${outputs.length}`;
      }
    }
    if (!mismatch) {
      for (let i = 0; i < g.outputs.length; i += 1) {
        mismatch = diff(outputs[i], g.outputs[i], `outputs[${i}]`);
        if (mismatch) break;
      }
    }
    if (!mismatch && stateResp) mismatch = diff(stateResp.data, g.state, 'state');

    ok(!mismatch, `${g.name}: ` + (mismatch ? `载荷不一致 → ${mismatch}` : '载荷整体一致'));
  }

  section('适配层边界');
  {
    B.reset();
    ok(B.handle('GET', '/api/quiz/questions?category=list') === null, '题库路径不由轨迹引擎接管');
    ok(B.handle('GET', '/api/linkedlist/something') === null, '未知子路径返回 null');
    ok(B.handle('GET', tracePath('list', 'build')) === null, 'GET 打操作接口不接管（只认 POST）');
    ok(B.handle('POST', tracePath('list', 'nope'), {}) === null, '未知操作返回 null');

    const bad = B.handle('POST', tracePath('list', 'insert-head'), { value: 'abc' });
    ok(!!bad && bad.ok === false && /整数/.test(bad.msg), '非整数参数走 err()，不抛异常');

    B.reset();
    const empty = B.handle('POST', tracePath('stack', 'pop'), {});
    ok(!!empty && empty.ok === false && /空/.test(empty.msg), '空栈 pop 返回业务错误（与后端 err 同形）');
  }

  section('状态持久化（离线刷新 / 切模块后仍在）');
  [
    { kind: 'list', values: [3, 1, 4], op: 'insert-tail', body: { value: 1 }, expect: [3, 1, 4, 1] },
    { kind: 'stack', values: [5, 3, 8], op: 'push', body: { value: 2 }, expect: [5, 3, 8, 2] },
    { kind: 'queue', values: [5, 3, 8], op: 'enqueue', body: { value: 2 }, expect: [5, 3, 8, 2] },
  ].forEach(({ kind, values, op, body, expect }) => {
    B.reset();
    B.handle('POST', tracePath(kind, 'build'), { values });
    const r = B.handle('POST', tracePath(kind, op), body);
    ok(!!r && r.ok, `${kind}: 操作执行成功`);
    B.dropMemory();  // 等价于整页重载：内存容器丢了，只剩 sessionStorage
    const st = B.handle('GET', tracePath(kind, 'state')).data;
    ok(st.length === expect.length, `${kind}: 重载后长度 = ${expect.length}（实际 ${st.length}）`);
    const vals = (st.nodes || st.items).map((it) => it.value);
    ok(JSON.stringify(vals) === JSON.stringify(expect), `${kind}: 重载后值序列 ${JSON.stringify(vals)}`);
  });

  section('seed（在线状态 → 离线容器）');
  {
    B.reset();
    B.seed({ list: [7, 8, 9] });
    const st = B.handle('GET', tracePath('list', 'state')).data;
    ok(st.length === 3, 'seed 后容器长度 = 3');
    const r = B.handle('POST', tracePath('list', 'search'), { value: 8 });
    ok(!!r && r.ok && r.data.result && r.data.result.found === true, 'seed 后可直接接着操作');
  }

  console.log('\n----------------------------------------');
  console.log(`通过 ${passed} / ${passed + failed}`);
  process.exit(failed ? 1 : 0);
}

main();
