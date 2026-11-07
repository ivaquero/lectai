/* ==========================================================================
   tests/http-parity.test.js —— Python 服务 ↔ Node 服务 的 HTTP 级对齐
   --------------------------------------------------------------------------
   为什么必须有这一层：parity.test.js 证明的是「引擎函数」等价，offline-engine
   证明的是「离线适配层」等价，两者都绕过了 HTTP。路由参数校验、应答外壳、
   会话隔离、静态托管这些只在服务端存在的东西，只有对着两个真实进程发请求
   才能验。

   做法：
     1) 各起一个**全新进程**（Python 8391 / Node 8392）。必须是全新进程：
        Node/Item 的 id 是进程内全局自增，老进程的计数器早就跑远了，
        不重启就没法逐字节比对。
     2) 用 web/tests/scenarios/trace-cases.json 这份两端共用的脚本重放，
        同一顺序、同一 sid，逐条比对应答。
     3) 再比题库 / 答疑 / 健康 / 兜底 / 参数校验这些非轨迹接口。

   前提：本机可用 uv（跑 `uv run uvicorn`）。跑法：
     仓库根 pnpm test:http-parity
   ========================================================================== */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const SCENARIOS = path.join(ROOT, 'web', 'tests', 'scenarios', 'trace-cases.json');
const NODE_ENTRY = path.join(HERE, '..', 'dist', 'server.mjs');

const PY_PORT = Number(process.env.PARITY_PY_PORT || 8391);
const JS_PORT = Number(process.env.PARITY_JS_PORT || 8392);
const PY = `http://127.0.0.1:${PY_PORT}`;
const JS = `http://127.0.0.1:${JS_PORT}`;

const IS_WIN = process.platform === 'win32';

/* -------------------------------------------------------------- 报告工具 */

let pass = 0;
let fail = 0;

function section(name) {
  console.log('\n== ' + name + ' ==');
}

function ok(cond, label, extra) {
  if (cond) {
    pass++;
    console.log('  ✓ ' + label);
  } else {
    fail++;
    console.log('  ✗ ' + label + (extra ? ' → ' + extra : ''));
  }
}

/** 深度比对，返回第一处差异的路径描述；一致返回 null */
function diff(a, b, at = '') {
  if (a === b) return null;

  if (typeof a !== typeof b) {
    return `${at || 'root'}: 类型不同（期望 ${typeof a}，实际 ${typeof b}）`;
  }
  if (a === null || b === null) {
    return `${at || 'root'}: 期望 ${JSON.stringify(a)}，实际 ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return `${at || 'root'}: 一个是数组一个不是`;
  }
  if (typeof a !== 'object') {
    return `${at || 'root'}: 期望 ${JSON.stringify(a)}，实际 ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) {
      return `${at || 'root'}.length: 期望 ${a.length}，实际 ${b.length}`;
    }
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${at}[${i}]`);
      if (d) return d;
    }
    return null;
  }

  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  const onlyA = ka.filter((k) => !kb.includes(k));
  const onlyB = kb.filter((k) => !ka.includes(k));
  if (onlyA.length) return `${at}: 缺少字段 ${onlyA.join(',')}`;
  if (onlyB.length) return `${at}: 多出字段 ${onlyB.join(',')}`;

  for (const k of ka) {
    const d = diff(a[k], b[k], at ? `${at}.${k}` : k);
    if (d) return d;
  }
  return null;
}

/* -------------------------------------------------------------- 进程管理 */

const children = [];

function start(cmd, args, opts) {
  const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => {
    const text = String(d);
    if (process.env.PARITY_VERBOSE) process.stderr.write('[child] ' + text);
  });
  children.push(child);
  return child;
}

function killTree(child) {
  if (!child || child.killed) return;
  try {
    if (IS_WIN) {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    /* 忽略：进程可能已退出 */
  }
}

function cleanup() {
  for (const c of children) killTree(c);
}

async function waitHealthy(base, label, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/api/health');
      if (res.ok) {
        const j = await res.json();
        if (j && j.code === 0) return true;
      }
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${label} 在 ${timeoutMs}ms 内没有就绪（${base}）`);
}

/* -------------------------------------------------------------- 请求工具 */

async function call(base, method, url, { sid, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (sid) headers['X-Session-Id'] = sid;
  const res = await fetch(base + url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { __raw: text };
  }
  return { status: res.status, json };
}

/** 同时在两个服务上打同一请求，返回两边结果 */
async function both(method, url, opts = {}) {
  const [a, b] = await Promise.all([call(PY, method, url, opts), call(JS, method, url, opts)]);
  return { py: a, js: b };
}

/** 断言两边完全一致（状态码 + JSON） */
async function same(label, method, url, opts = {}) {
  const { py, js } = await both(method, url, opts);
  const statusSame = py.status === js.status;
  const d = diff(py.json, js.json);
  ok(statusSame && !d, label, statusSame ? d : `HTTP ${py.status} vs ${js.status}`);
  return { py, js };
}

/* -------------------------------------------------------------- 场景重放 */

const PREFIX = { list: '/api/linkedlist', stack: '/api/stack', queue: '/api/queue' };

async function replayCases() {
  const spec = JSON.parse(fs.readFileSync(SCENARIOS, 'utf8'));
  const cases = spec.cases;

  section(`轨迹场景重放（${cases.length} 个用例）`);

  for (const c of cases) {
    const base = PREFIX[c.container];
    if (!base) throw new Error('未知容器：' + c.container);
    const sid = 'parity-' + c.name;

    let mismatched = null;

    for (let i = 0; i < c.steps.length; i++) {
      const step = c.steps[i];
      const body = {};
      if (step.values !== undefined) body.values = step.values;
      if (step.value !== undefined) body.value = step.value;
      if (step.pos !== undefined) body.pos = step.pos;

      const { py, js } = await both('POST', `${base}/trace/${step.op}`, { sid, body });
      const d = diff(py.json, js.json);
      if (py.status !== js.status || d) {
        mismatched = `${c.name} step#${i} ${step.op}: ` +
          (py.status !== js.status ? `HTTP ${py.status} vs ${js.status}` : d);
        break;
      }
    }

    if (!mismatched) {
      const { py, js } = await both('GET', `${base}/trace/state`, { sid });
      const d = diff(py.json, js.json);
      if (py.status !== js.status || d) mismatched = `${c.name} state: ` + (d || `HTTP ${py.status} vs ${js.status}`);
    }

    ok(!mismatched, `${c.name}（${c.container}，${c.steps.length} 步）`, mismatched);
  }
}

/* -------------------------------------------------------------- 其余接口 */

async function opsRegistries() {
  section('操作注册表');
  for (const [kind, base] of Object.entries(PREFIX)) {
    const { py, js } = await both('GET', `${base}/ops`);
    if (py.status !== js.status) {
      ok(false, `${kind}/ops`, `HTTP ${py.status} vs ${js.status}`);
      continue;
    }
    const a = py.json.data;
    const b = js.json.data;

    // 数组顺序不属于契约（前端只比对 key 集合），按 key 排序后逐字段比
    const byKey = (x) => [...x.ops].sort((m, n) => (m.key < n.key ? -1 : 1));
    const d = diff(
      { module: a.module, max_nodes: a.max_nodes, ops: byKey(a) },
      { module: b.module, max_nodes: b.max_nodes, ops: byKey(b) }
    );
    ok(!d, `${kind}/ops（${a.ops.length} 个操作、max_nodes=${a.max_nodes}）`, d);
  }
}

async function quizApis() {
  section('题库接口');

  const cats = await same('GET /api/quiz/categories', 'GET', '/api/quiz/categories');
  const list = (cats.py.json.data && cats.py.json.data.categories) || [];
  ok(list.length > 0, `分类数量 ${list.length}`, '两侧都没返回分类');

  const first = list[0] && list[0].key;
  if (first) {
    await same(`GET /api/quiz/questions?category=${first}`, 'GET', `/api/quiz/questions?category=${first}`);
  }
  await same('GET /api/quiz/questions?category=不存在', 'GET', '/api/quiz/questions?category=NOT_A_CATEGORY');

  // 判题：同一道题分别答对、答错，再比统计
  const sid = 'parity-quiz';
  const qs = first
    ? (await call(PY, 'GET', `/api/quiz/questions?category=${first}`)).json.data.questions
    : [];

  if (qs.length >= 2) {
    // 取题接口不含答案（防作弊），所以这里不追求「答对/答错」，只要求两侧
    // 收到完全相同的答案下标——判题结果、统计增量才有可比性。
    for (const [i, q] of qs.slice(0, 2).entries()) {
      await same(`POST /api/quiz/submit ${q.id}`, 'POST', '/api/quiz/submit', {
        sid,
        body: { question_id: q.id, answer: i % 4 }
      });
    }
  }

  await same('POST /api/quiz/submit 不存在的题', 'POST', '/api/quiz/submit', {
    sid,
    body: { question_id: 'list-9999', answer: 0 }
  });

  await same('GET /api/quiz/stats', 'GET', '/api/quiz/stats', { sid });
}

async function aiApis() {
  section('答疑接口');

  // 从知识库取一条真实关键词，保证命中本地知识库
  const kbPath = path.join(BACKEND, 'data', 'kb.json');
  const kb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
  const kw = (kb[0] && kb[0].keywords && kb[0].keywords[0]) || 'KMP';

  await same(`POST /api/ai/ask 命中关键词「${kw}」`, 'POST', '/api/ai/ask', {
    body: { question: `请解释一下 ${kw} 是什么` }
  });
  await same('POST /api/ai/ask 未命中（模拟回答）', 'POST', '/api/ai/ask', {
    body: { question: '今天天气怎么样' }
  });
}

async function healthApi() {
  section('健康检查');

  const { py, js } = await both('GET', '/api/health');
  const stable = (r) => {
    const d = { ...r.json.data };
    // 这两项天然随时间/请求数变化，不属于契约
    delete d.uptime_sec;
    delete d.sessions;
    delete d.session_policy;
    return d;
  };
  const d = diff(stable(py), stable(js));
  ok(py.status === js.status && !d, 'GET /api/health（忽略 uptime / 会话计数）', d);

  const shape = (r) => Object.keys(r.json.data || {}).sort().join(',');
  ok(
    shape(py) === shape(js),
    'health 字段集合一致',
    `Python: ${shape(py)} / Node: ${shape(js)}`
  );
  ok(
    typeof py.json.data.uptime_sec === 'number' && typeof js.json.data.uptime_sec === 'number',
    'uptime_sec 两侧都是数字'
  );
}

async function errorPaths() {
  section('兜底与参数校验');

  await same('GET /api/未知接口 → 404 + code=1', 'GET', '/api/not-a-route');

  const { py, js } = await both('POST', '/api/linkedlist/trace/insert-head', { body: { value: 'abc' } });
  ok(py.status === 422 && js.status === 422, '非法整数 → 两侧都是 422', `${py.status} vs ${js.status}`);
  ok(
    js.json && js.json.code === 1 && typeof js.json.msg === 'string',
    'Node 的 422 仍是统一外壳（带 code/msg，前端可直接显示）',
    JSON.stringify(js.json)
  );

  const { py: py2, js: js2 } = await both('POST', '/api/linkedlist/trace/delete-pos', {
    sid: 'parity-invalid',
    body: { pos: 0 }
  });
  ok(py2.status === 422 && js2.status === 422, 'pos=0（小于下界）→ 两侧都是 422', `${py2.status} vs ${js2.status}`);
}

async function staticHosting() {
  section('静态托管');
  const js_ = await call(JS, 'GET', '/list.html');
  ok(js_.status === 200 && typeof js_.json.__raw === 'string' && js_.json.__raw.includes('<html'),
    'Node 直接托管 list.html');

  const redirect = await fetch(JS + '/visual.html', { redirect: 'manual' });
  ok(redirect.status === 302 && redirect.headers.get('location') === '/list.html',
    'GET /visual.html → 302 /list.html',
    `${redirect.status} → ${redirect.headers.get('location')}`);

  const py_ = await fetch(PY + '/visual.html', { redirect: 'manual' });
  ok(py_.status === 302, 'Python 侧同样 302（行为对齐）', String(py_.status));

  const home = await fetch(JS + '/');
  ok(home.status === 200 && (home.headers.get('content-type') || '').includes('text/html'),
    'GET / → 200 text/html');
}

/* -------------------------------------------------------------- 主流程 */

async function main() {
  if (!fs.existsSync(NODE_ENTRY)) {
    console.error('缺少 ' + NODE_ENTRY + '，先执行 pnpm --filter @lectai/server build');
    process.exit(1);
  }

  console.log('启动 Python（%s）与 Node（%s）…', PY, JS);
  start('uv', ['run', 'uvicorn', 'main:app', '--port', String(PY_PORT)], {
    cwd: BACKEND,
    env: { LECTAI_LOG_LEVEL: 'WARNING' }
  });
  start(process.execPath, [NODE_ENTRY], {
    cwd: path.join(ROOT, 'server'),
    env: { LECTAI_PORT: String(JS_PORT), LECTAI_LOG_LEVEL: 'warn' }
  });

  try {
    await Promise.all([waitHealthy(PY, 'Python'), waitHealthy(JS, 'Node')]);
    console.log('两侧均已就绪\n');

    await replayCases();
    await opsRegistries();
    await quizApis();
    await aiApis();
    await healthApi();
    await errorPaths();
    await staticHosting();
  } finally {
    cleanup();
  }

  console.log('\n========================================');
  console.log(`通过 ${pass} / ${pass + fail}`);
  process.exit(fail ? 1 : 0);
}

process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

main().catch((e) => {
  cleanup();
  console.error('\n测试异常：', e && e.message);
  process.exit(1);
});
