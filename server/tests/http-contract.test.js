/* ==========================================================================
   tests/http-contract.test.js —— 服务端 HTTP 契约回归
   --------------------------------------------------------------------------
   为什么要有这一层：parity.test.js 证明的是「引擎函数」等价，offline-engine
   证明的是「离线适配层」等价，两者都绕过了 HTTP。路由参数校验、应答外壳、
   会话隔离、静态托管这些只在服务端存在的东西，只有对着真实进程发请求才能验。

   做法（record / replay 两态）：
     · 契约快照在 tests/http-contract.golden.json，按**固定顺序**记录每一次
       请求的 状态码 / content-type / Redirect / 应答体。
     · 默认（replay）：起一个全新 Node 进程，按同一顺序重放，逐条比对。
     · `--record`：重新录契约（覆盖快照）。
       设 CONTRACT_BASE=http://host:port 可对**任意实例**录（不启动本地进程）。

   为什么必须全新进程：Node/Item 的 id 是进程内全局自增，老进程的计数器早就
   跑远了；顺序也不再从 1 开始，快照必然对不上。

   轨迹类应答体量大（与 web/tests 内容重复），只锁「规范化后的指纹」；
   其余接口（外壳、题库、答疑、健康、兜底、静态）锁完整应答体，便于直接看出
   哪个字段漂了。

   契约是有意改的（新增字段、改文案、加接口）就重录，并在 PR 里 review 快照
   diff —— 快照的变化就是契约的变化。
   ========================================================================== */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SERVER_DIR = path.resolve(HERE, '..');
const NODE_ENTRY = path.join(SERVER_DIR, 'dist', 'server.mjs');
const GOLDEN = path.join(HERE, 'http-contract.golden.json');
const SCENARIOS = path.join(ROOT, 'web', 'tests', 'trace-cases.json');
const DATA_DIR = path.join(ROOT, 'data');

const PORT = Number(process.env.CONTRACT_PORT || 8392);
const BASE = process.env.CONTRACT_BASE || `http://127.0.0.1:${PORT}`;
const RECORD = process.argv.includes('--record');

const IS_WIN = process.platform === 'win32';

/* -------------------------------------------------------------- 报告工具 */

let pass = 0;
let fail = 0;
const failures = [];

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
    failures.push(label);
  }
}

/** 深度比对，返回第一处差异的路径描述；一致返回 null（键序无关） */
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

/** 键序无关的规范化序列化：指纹只认内容，不认字段顺序 */
function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/* -------------------------------------------------------------- 请求计划 */

const PREFIX = { list: '/api/linkedlist', stack: '/api/stack', queue: '/api/queue' };

/**
 * 生成固定顺序的请求清单。所有「该问什么」都从仓库里的数据文件推出来，
 * 不依赖上一个应答 —— 否则 replay 时清单本身会随实现漂移。
 */
function buildPlan() {
  const cases = JSON.parse(fs.readFileSync(SCENARIOS, 'utf8')).cases;
  const bank = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'questions.json'), 'utf8'));
  const kb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'kb.json'), 'utf8'));

  const plan = [];
  const add = (e) => plan.push({ sid: undefined, body: undefined, ...e });

  /* 1) 轨迹：36 个场景逐操作重放，每个场景收尾再取一次 state */
  for (const c of cases) {
    const base = PREFIX[c.container];
    if (!base) throw new Error('未知容器：' + c.container);
    const sid = 'contract-' + c.name;

    c.steps.forEach((step, i) => {
      const body = {};
      if (step.values !== undefined) body.values = step.values;
      if (step.value !== undefined) body.value = step.value;
      if (step.pos !== undefined) body.pos = step.pos;

      add({
        label: `${c.name} step#${i} ${step.op}`,
        group: `轨迹场景重放（${cases.length} 个用例）`,
        method: 'POST',
        url: `${base}/trace/${step.op}`,
        sid,
        body
      });
    });

    add({
      label: `${c.name} state`,
      group: `轨迹场景重放（${cases.length} 个用例）`,
      method: 'GET',
      url: `${base}/trace/state`,
      sid
    });
  }

  /* 2) 操作注册表 */
  for (const [kind, base] of Object.entries(PREFIX)) {
    add({ label: `${kind}/ops`, group: '操作注册表', method: 'GET', url: `${base}/ops` });
  }

  /* 3) 题库 */
  const firstCat = Object.keys(bank)[0];
  const quiz = 'contract-quiz';
  add({ label: 'GET /api/quiz/categories', group: '题库接口', method: 'GET', url: '/api/quiz/categories' });
  add({
    label: `GET /api/quiz/questions?category=${firstCat}`,
    group: '题库接口',
    method: 'GET',
    url: `/api/quiz/questions?category=${firstCat}`
  });
  add({
    label: 'GET /api/quiz/questions?category=不存在',
    group: '题库接口',
    method: 'GET',
    url: '/api/quiz/questions?category=NOT_A_CATEGORY'
  });

  // 取题接口不含答案（防作弊），这里只固定「收到的答案下标」，判题结果随即可比
  (bank[firstCat].questions || []).slice(0, 2).forEach((q, i) => {
    const id = `${firstCat}-${i + 1}`;
    add({
      label: `POST /api/quiz/submit ${id}`,
      group: '题库接口',
      method: 'POST',
      url: '/api/quiz/submit',
      sid: quiz,
      body: { question_id: id, answer: i % 4 }
    });
  });
  add({
    label: 'POST /api/quiz/submit 不存在的题',
    group: '题库接口',
    method: 'POST',
    url: '/api/quiz/submit',
    sid: quiz,
    body: { question_id: 'list-9999', answer: 0 }
  });
  add({ label: 'GET /api/quiz/stats', group: '题库接口', method: 'GET', url: '/api/quiz/stats', sid: quiz });

  /* 4) 答疑：一条命中知识库，一条不命中 */
  const kw = (kb[0] && kb[0].keywords && kb[0].keywords[0]) || 'KMP';
  add({
    label: `POST /api/ai/ask 命中关键词「${kw}」`,
    group: '答疑接口',
    method: 'POST',
    url: '/api/ai/ask',
    body: { question: `请解释一下 ${kw} 是什么` }
  });
  add({
    label: 'POST /api/ai/ask 未命中（模拟回答）',
    group: '答疑接口',
    method: 'POST',
    url: '/api/ai/ask',
    body: { question: '今天天气怎么样' }
  });

  /* 5) 健康检查 */
  add({ label: 'GET /api/health', group: '健康检查', method: 'GET', url: '/api/health' });

  /* 6) 兜底与参数校验 */
  add({ label: 'GET /api/未知接口', group: '兜底与参数校验', method: 'GET', url: '/api/not-a-route' });
  add({
    label: 'POST /api/linkedlist/trace/insert-head 非法整数',
    group: '兜底与参数校验',
    method: 'POST',
    url: '/api/linkedlist/trace/insert-head',
    body: { value: 'abc' }
  });
  add({
    label: 'POST /api/linkedlist/trace/delete-pos pos=0（小于下界）',
    group: '兜底与参数校验',
    method: 'POST',
    url: '/api/linkedlist/trace/delete-pos',
    sid: 'contract-invalid',
    body: { pos: 0 }
  });

  /* 7) 静态托管 */
  add({ label: 'GET /list.html', group: '静态托管', method: 'GET', url: '/list.html' });
  add({ label: 'GET /visual.html', group: '静态托管', method: 'GET', url: '/visual.html', manualRedirect: true });
  add({ label: 'GET /', group: '静态托管', method: 'GET', url: '/' });

  return plan;
}

/* -------------------------------------------------------------- 规范化 */

const HEALTH = '/api/health';
const volatileKeys = ['uptime_sec', 'sessions', 'session_policy'];

/**
 * 把一次应答压成契约里能长期稳定的形状：
 *  · HTML 只锁「是 HTML」，内容随改版变化，不该写进契约；
 *  · 健康检查里的 uptime / 会话计数天然随时间变化，摘掉；
 *  · 参数校验失败（422）只锁状态码 —— 外壳是各家框架的方言，Node 侧另行断言
 *    必须是统一外壳，见 replay()；
 *  · /ops 的操作顺序不属于契约（前端只按 key 取），排序后比；
 *  · 轨迹类换成规范化指纹（体积大且已在 web/tests 里锁过）。
 */
function normalize(url, raw) {
  const out = { status: raw.status };
  out.contentType = (raw.contentType || '').split(';')[0].trim();
  out.location = raw.location || '';

  if (raw.json && typeof raw.json.__raw === 'string') {
    out.body = { __html: true };
    return out;
  }

  if (raw.status === 422) {
    out.body = { __validation_error: true };
    return out;
  }

  let body = raw.json;
  if (body && body.data && url.startsWith(HEALTH)) {
    body = { ...body, data: { ...body.data } };
    for (const k of volatileKeys) delete body.data[k];
  }

  if (/\/ops$/.test(url) && body && body.data && Array.isArray(body.data.ops)) {
    body = {
      ...body,
      data: { ...body.data, ops: [...body.data.ops].sort((m, n) => (m.key < n.key ? -1 : 1)) }
    };
  }

  out.body = /\/trace\//.test(url) ? { __digest: sha(canonical(body)) } : body;
  return out;
}

/* -------------------------------------------------------------- 进程管理 */

const children = [];

function startNode() {
  const child = spawn(process.execPath, [NODE_ENTRY], {
    cwd: SERVER_DIR,
    env: { ...process.env, LECTAI_PORT: String(PORT), LECTAI_LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.__log = '';
  child.__exited = false;
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => {
    child.__log = (child.__log + String(d)).slice(-2000);
  });
  child.on('exit', () => {
    child.__exited = true;
  });
  children.push(child);
  return child;
}

/**
 * 必须同步杀掉整棵进程树。
 * 之前用异步 spawn：cleanup 后立刻退出，taskkill 还没跑完下一轮就起来了，
 * 新进程 EADDRINUSE 退出、测试却连上了残留的旧进程——表现为随机大面积失败。
 */
function killTree(child) {
  if (!child) return;
  try {
    if (IS_WIN) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill('SIGKILL');
    }
  } catch {
    /* 进程可能已退出 */
  }
}

function cleanup() {
  for (const c of children) killTree(c);
  children.length = 0;
}

async function portInUse(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(600) });
    return true;
  } catch {
    return false;
  }
}

/** 启动前确认端口干净：否则会静默连到上一轮残留的进程上，录制结果毫无意义 */
async function assertPortFree(port) {
  if (await portInUse(port)) {
    throw new Error(
      `端口 ${port} 已被占用（可能是上一轮残留的服务）。` +
        `请先结束该进程，或设 CONTRACT_PORT 换端口。`
    );
  }
}

async function waitHealthy(base, child, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child && child.__exited) {
      throw new Error('服务启动即退出：\n' + (child.__log || '(无输出)'));
    }
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
  throw new Error(`服务在 ${timeoutMs}ms 内没有就绪（${base}）` + (child && child.__log ? '\n' + child.__log : ''));
}

/* -------------------------------------------------------------- 执行 */

async function call(base, entry) {
  const headers = { 'Content-Type': 'application/json' };
  if (entry.sid) headers['X-Session-Id'] = entry.sid;

  const res = await fetch(base + entry.url, {
    method: entry.method,
    headers,
    redirect: entry.manualRedirect ? 'manual' : 'follow',
    body: entry.body === undefined ? undefined : JSON.stringify(entry.body)
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { __raw: text };
  }

  return {
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    location: res.headers.get('location') || '',
    json
  };
}

/** 顺序执行整个计划，返回 [{entry, observed, isHtml, validationShellOk}] */
async function runPlan(base, plan) {
  const out = [];
  for (const entry of plan) {
    const raw = await call(base, entry);
    const text = raw.json && typeof raw.json.__raw === 'string' ? raw.json.__raw : '';
    const j = raw.json || {};
    out.push({
      entry,
      observed: normalize(entry.url, raw),
      isHtml: text.includes('<html'),
      // 422 的应答外壳不在契约里（各家框架方言不同），但 Node 必须是统一外壳
      validationShellOk: raw.status === 422 ? j.code === 1 && typeof j.msg === 'string' : null
    });
  }
  return out;
}

/* -------------------------------------------------------------- 主流程 */

async function main() {
  if (!fs.existsSync(NODE_ENTRY)) {
    console.error('缺少 ' + NODE_ENTRY + '，先执行 pnpm --filter @lectai/server build');
    process.exit(1);
  }

  const plan = buildPlan();
  const external = Boolean(process.env.CONTRACT_BASE);

  if (RECORD && external) {
    console.log(`对已运行实例 ${BASE} 录契约（${plan.length} 条请求）…`);
    const results = await runPlan(BASE, plan);
    writeGolden(results);
    return;
  }

  console.log(`启动 Node（${BASE}），共 ${plan.length} 条请求…`);
  await assertPortFree(PORT);
  const child = startNode();

  try {
    await waitHealthy(BASE, child);
    console.log('服务已就绪\n');

    const results = await runPlan(BASE, plan);

    if (RECORD) {
      writeGolden(results);
      return;
    }

    replay(results);
  } finally {
    cleanup();
  }

  console.log('\n========================================');
  console.log(`通过 ${pass} / ${pass + fail}`);
  if (fail) console.log('失败项：\n  - ' + failures.join('\n  - '));
  process.exit(fail ? 1 : 0);
}

function writeGolden(results) {
  const payload = {
    $comment:
      '服务端 HTTP 契约快照（node tests/http-contract.test.js --record 生成）。' +
      '按固定顺序记录：状态码 / content-type / Redirect / 应答体；' +
      '轨迹类接口只记规范化指纹，HTML 只记「是 HTML」，健康检查剔除 uptime 与会话计数。' +
      '有意改契约才重录，并在 diff 里逐条 review。',
    exchanges: results.map(({ entry, observed }) => ({
      label: entry.label,
      method: entry.method,
      url: entry.url,
      status: observed.status,
      contentType: observed.contentType,
      location: observed.location,
      body: observed.body
    }))
  };

  fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
  fs.writeFileSync(GOLDEN, JSON.stringify(payload, null, 1) + '\n', 'utf8');

  const kb = (fs.statSync(GOLDEN).size / 1024).toFixed(0);
  console.log(`已写入 ${path.relative(ROOT, GOLDEN)}（${payload.exchanges.length} 条，${kb}KB）`);
  pass = payload.exchanges.length;
  fail = 0;
}

function replay(results) {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8')).exchanges;

  if (golden.length !== results.length) {
    ok(false, '契约条数与脚本一致', `快照 ${golden.length} 条 / 脚本 ${results.length} 条；改了请求清单就要重录`);
  }

  let group = null;
  results.forEach(({ entry, observed }, i) => {
    if (entry.group !== group) {
      group = entry.group;
      section(group);
    }

    const expect = golden[i];
    if (!expect) {
      ok(false, entry.label, '快照里没有这一条');
      return;
    }

    /* 快照里还存了 label/method/url 便于人工阅读，比对只看应答本身 */
    const d = diff(
      {
        status: expect.status,
        contentType: expect.contentType,
        location: expect.location,
        body: expect.body
      },
      observed
    );
    ok(!d, entry.label, d);
  });

  /* 静态托管不止「状态码对」，内容也得是页面而不是空壳 */
  section('静态托管内容');
  ok(lastIsHtml(results, '/list.html'), 'list.html 返回真实 HTML');
  ok(lastIsHtml(results, '/'), '首页返回真实 HTML');

  /* 参数校验失败：状态码已由契约锁住，外壳单独验（Node 侧的统一外壳是前端
     直接拿来显示的，不能退化成框架默认的 {detail:[...]}） */
  const validations = results.filter((r) => r.validationShellOk !== null);
  section(`参数校验外壳（${validations.length} 条 422）`);
  ok(validations.length > 0, '契约里确实覆盖了参数校验失败');
  for (const r of validations) {
    ok(r.validationShellOk === true, `${r.entry.label} 走统一外壳（code=1 + msg）`);
  }
}

function lastIsHtml(results, url) {
  const hit = results.filter((r) => r.entry.url === url).pop();
  return Boolean(hit && hit.isHtml);
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
