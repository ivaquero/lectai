/* ==========================================================================
   web/tests/sw.test.js —— Service Worker 的策略与清单生成
   --------------------------------------------------------------------------
   为什么这层非测不可：
     SW 的错误几乎全是**静默**的。缓存少一个文件 → 离线时某页白屏；
     该放行的 /api 被缓存 → 学生看到过期题库、徽标显示「在线」却全是旧数据；
     导航不做网络优先 → 新版本发布后学生永远停在旧 HTML。这些在 CI 里
     不会报错，在浏览器里也只是「有时候不对」。

   做法：不启动浏览器，用 vm 造一个最小的 ServiceWorkerGlobalScope
     （假 caches / 假 fetch / 事件表），把**真正要发布的 SW 代码**跑起来，
     直接对事件驱动，看它返回什么。测的是产物逻辑本身，不是复刻一份。

   运行：cd web && node tests/sw.test.js （不需要后端，也不需要先 build）
   ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'http://localhost:5500';
const BASE = ORIGIN + '/';

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label); }
}

function section(t) { console.log('\n== ' + t + ' =='); }

/* ------------------------------------------------------------ 假 CacheStorage */

function urlOf(key) {
  if (typeof key === 'string') return new URL(key, BASE).href;
  if (key && typeof key.url === 'string') return key.url;
  throw new TypeError('非法的 cache key');
}

/** 请求头统一小写（Cache 的 Vary 比对是按头的，不是按写法） */
function headersOf(key) {
  const raw = (key && typeof key === 'object' && key.headers) || {};
  const out = {};
  for (const k of Object.keys(raw)) out[k.toLowerCase()] = raw[k];
  return out;
}

function makeCaches() {
  const stores = new Map();

  function storeFor(name) {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  }

  /* 这个假缓存刻意实现 Vary 语义：真实踩过的坑就是 Vary: Origin 让
     cache.match(request) 静默落空（HTML 能开、JS/CSS 全挂）。不模拟 Vary，
     这层测试就永远发现不了那类回归。 */
  function wrapper(map) {
    return {
      async put(key, res) {
        // Cache 存的是响应体副本，键是 URL —— 与真实实现一致
        const vary = (res.headers.get('vary') || '')
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean);
        map.set(urlOf(key), {
          status: res.status,
          body: await res.text(),
          vary,
          resHeaders: Array.from(res.headers),
          reqHeaders: headersOf(key)
        });
      },
      async match(key, opts) {
        const want = urlOf(key);
        const norm = (u) => (opts && opts.ignoreSearch ? u.split('?')[0] : u);
        for (const [k, v] of map) {
          if (norm(k) !== norm(want)) continue;
          if (!(opts && opts.ignoreVary) && v.vary.length) {
            const mine = headersOf(key);
            if (v.vary.some((h) => (v.reqHeaders[h] || '') !== (mine[h] || ''))) continue;
          }
          return new Response(v.body, { status: v.status, headers: v.resHeaders });
        }
        return undefined;
      }
    };
  }

  return {
    _stores: stores,
    async open(name) { return wrapper(storeFor(name)); },
    async keys() { return Array.from(stores.keys()); },
    async delete(name) { return stores.delete(name); }
  };
}

/* -------------------------------------------------------------- 假网络 */

const net = {
  calls: [],
  fail: false,
  status: 200,
  bad: new Set(),
  reset() { net.calls = []; net.fail = false; net.status = 200; net.bad = new Set(); },
  async fetch(input) {
    const url = typeof input === 'string' ? input : input && input.url;
    net.calls.push(url);
    if (net.fail) throw new TypeError('Failed to fetch');
    if (net.bad.has(url)) return new Response('missing', { status: 404 });
    // 模仿 vite preview：所有响应带 Vary: Origin
    return new Response('net:' + url, { status: net.status, headers: { vary: 'Origin' } });
  }
};

/* ------------------------------------------------------ 在 vm 里启动 SW */

function boot(code) {
  const listeners = Object.create(null);
  const flags = { skipped: false, claimed: false };
  const caches = makeCaches();

  const self = {
    location: { href: BASE + 'sw.js', origin: ORIGIN },
    addEventListener(type, fn) {
      (listeners[type] || (listeners[type] = [])).push(fn);
    },
    skipWaiting: async () => { flags.skipped = true; },
    clients: { claim: async () => { flags.claimed = true; } }
  };
  self.self = self;

  const ctx = vm.createContext({
    self,
    caches,
    fetch: (input, init) => net.fetch(input, init),
    Response,
    Request,
    URL,
    setTimeout,
    clearTimeout,
    console,
    Promise
  });

  vm.runInContext(code, ctx, { filename: 'sw.js' });

  async function fire(type) {
    const waits = [];
    (listeners[type] || []).forEach((fn) => fn({ waitUntil: (p) => waits.push(p) }));
    await Promise.all(waits);
  }

  /** 返回 Response；返回 null 表示「没有拦截」（交回浏览器走网络） */
  async function fireFetch(request) {
    let responded = null;
    (listeners.fetch || []).forEach((fn) =>
      fn({ request, respondWith: (p) => { responded = p; } })
    );
    return responded === null ? null : await responded;
  }

  return { fire, fireFetch, caches, flags };
}

/** 相对产物根的请求对象：SW 只读 method / url / mode（headers 仅用于 Vary 比对） */
const req = (rel, mode, headers) => ({
  method: 'GET',
  url: new URL(rel, BASE).href,
  mode: mode || 'cors',
  headers: headers || {}
});

async function main() {
  const swMod = await import(pathToFileURL(path.join(ROOT, 'scripts/sw-manifest.mjs')).href);
  const template = fs.readFileSync(path.join(ROOT, 'src/sw/sw.js'), 'utf8');

  /* ------------------------------------------------ 清单与版本（纯函数） */

  section('预缓存清单 collectPrecache');
  {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lectai-sw-'));
    fs.mkdirSync(path.join(tmp, 'assets', 'sub'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'list.html'), '<html>list</html>');
    fs.writeFileSync(path.join(tmp, 'index.html'), '<html>index</html>');
    fs.writeFileSync(path.join(tmp, 'assets', 'a.js'), 'a');
    fs.writeFileSync(path.join(tmp, 'assets', 'sub', 'b.css'), 'b');
    fs.writeFileSync(path.join(tmp, 'sw.js'), 'sw');

    const files = await swMod.collectPrecache(tmp);
    ok(files.length === 4, `收集到 4 项（实际 ${files.length}）`);
    ok(!files.includes('sw.js'), 'sw.js 不把自己列进预缓存');
    ok(files[0] === 'index.html' && files[1] === 'list.html', 'HTML 排在最前（离线先能打开页面）');
    ok(files.includes('assets/sub/b.css'), '嵌套目录路径用正斜杠');

    const v1 = await swMod.hashVersion(tmp, files);
    const v2 = await swMod.hashVersion(tmp, files);
    ok(v1 === v2 && /^[0-9a-f]{8}$/.test(v1), `版本号稳定且为 8 位十六进制（${v1}）`);

    fs.writeFileSync(path.join(tmp, 'assets', 'a.js'), 'a-changed');
    const v3 = await swMod.hashVersion(tmp, files);
    ok(v3 !== v1, '任一字节变化 → 版本号变化（旧缓存会被清掉）');

    // 只改 SW 自身策略、页面产物不动：版本必须变，否则浏览器不装新 SW
    const v4 = await swMod.hashVersion(tmp, files, '// sw 模板 v2');
    const v5 = await swMod.hashVersion(tmp, files, '// sw 模板 v3');
    ok(v4 !== v3 && v4 !== v5, 'SW 模板内容参与哈希（改策略即触发更新）');

    let threw = false;
    try { swMod.renderSw('<html>', 'x', []); } catch (e) { threw = true; }
    ok(threw, '模板缺占位符时直接报错，不产出坏 SW');

    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ------------------------------------------------------------ install */

  const PRECACHE = ['index.html', 'list.html', 'assets/list-abc.js', 'assets/list-abc.css'];
  const code = swMod.renderSw(template, 'deadbeef', PRECACHE);

  ok(
    code.indexOf('__SW_VERSION__') === -1 && code.indexOf('__SW_PRECACHE__') === -1,
    '生成的代码里没有占位符残留'
  );

  section('install · 预缓存');
  {
    net.reset();
    const sw = boot(code);
    await sw.fire('install');

    const cache = await sw.caches.open('lectai-static-deadbeef');
    let hit = 0;
    for (const p of PRECACHE) {
      if (await cache.match(new URL(p, BASE).href)) hit++;
    }
    ok(hit === PRECACHE.length, `4 项全部进缓存（实际 ${hit}）`);
    ok(net.calls.length === PRECACHE.length, `每个文件只请求一次（实际 ${net.calls.length}）`);
    ok(sw.flags.skipped === true, 'install 结束调用 skipWaiting（无更新提示 UI，立即接管）');
  }

  section('install · 单个文件缺失不阻断');
  {
    net.reset();
    net.bad.add(new URL('assets/list-abc.css', BASE).href);
    const sw = boot(code);
    await sw.fire('install');

    const cache = await sw.caches.open('lectai-static-deadbeef');
    let hit = 0;
    for (const p of PRECACHE) {
      if (await cache.match(new URL(p, BASE).href)) hit++;
    }
    ok(hit === PRECACHE.length - 1, `其余 3 项仍然装上（实际 ${hit}）`);
  }

  /* --------------------------------------------------------- 路由判定 */

  section('fetch · 不该拦的绝不拦');
  {
    net.reset();
    const sw = boot(code);
    await sw.fire('install');
    net.reset();

    ok((await sw.fireFetch(req('api/health'))) === null, '/api/health 不拦截（交给网络，失败才降级）');
    ok((await sw.fireFetch(req('api/quiz/questions'))) === null, '/api/quiz/* 不拦截');
    ok(
      (await sw.fireFetch({ method: 'GET', url: ORIGIN + '/api/ai/ask', mode: 'cors' })) === null,
      '根路径 /api/ai/ask 同样不拦截'
    );
    ok(
      (await sw.fireFetch({ method: 'GET', url: 'https://api.example.com/api/health', mode: 'cors' })) === null,
      '跨域请求不拦截（API_ORIGIN 指向别的域时不能被缓存污染）'
    );
    ok(
      (await sw.fireFetch({ method: 'POST', url: BASE + 'api/linkedlist/trace/push', mode: 'cors' })) === null,
      '非 GET 不拦截'
    );
    ok(net.calls.length === 0, `上述 5 次判定一次网络都没发（实际 ${net.calls.length}）`);
  }

  section('fetch · 静态资源缓存优先');
  {
    net.reset();
    const sw = boot(code);
    await sw.fire('install');
    net.reset();

    const res = await sw.fireFetch(req('assets/list-abc.js'));
    ok(!!res && (await res.text()) === 'net:' + new URL('assets/list-abc.js', BASE).href,
      '命中缓存直接返回预缓存内容');
    ok(net.calls.length === 0, '命中缓存时不发网络请求');

    // 未预缓存的资源：回源并补进缓存，第二次不再回源
    const extra = req('assets/lazy-chunk.js');
    const r1 = await sw.fireFetch(extra);
    ok(!!r1 && net.calls.length === 1, '未命中时回源一次');
    await sw.fireFetch(extra);
    ok(net.calls.length === 1, '首次回源后写入缓存，第二次不再回源');
  }

  section('fetch · Vary 头不影响匹配（真踩过的坑）');
  {
    net.reset();
    const sw = boot(code);
    await sw.fire('install');

    const pre = await (await sw.caches.open('lectai-static-deadbeef')).match(
      new URL('assets/list-abc.js', BASE).href
    );
    ok(!!pre && pre.headers.get('vary') === 'Origin', '前置：桩响应带 Vary: Origin（与 vite preview 同）');

    net.reset();
    net.fail = true; // 断网：一旦漏命中就会变成 net::ERR_FAILED
    let res = null;
    let err = null;
    try {
      res = await sw.fireFetch(req('assets/list-abc.js', 'cors', { Origin: ORIGIN }));
    } catch (e) { err = e; }

    ok(!err && !!res, '带 Origin 的子资源请求仍命中预缓存（不会因 Vary 漏命中）');
    ok(!!res && (await res.text()).indexOf('net:') === 0, '返回的确实是预缓存内容');
    ok(net.calls.length === 0, '全程没有回源尝试（断网下这是唯一能活的路径）');
  }


  section('fetch · 导航网络优先');
  {
    net.reset();
    const sw = boot(code);
    await sw.fire('install');
    net.reset();

    const on = await sw.fireFetch(req('list.html', 'navigate'));
    ok(!!on && (await on.text()).indexOf('net:') === 0, '在线时拿到网络版本（保证新 HTML 即时生效）');
    ok(net.calls.length === 1, '导航确实走了网络');
    const store = sw.caches._stores.get('lectai-static-deadbeef');
    ok(store.size === PRECACHE.length, '导航成功不额外存一份 HTML（预缓存是唯一副本，避免与 chunk 版本错配）');

    // 离线：网络整体失败
    net.reset();
    net.fail = true;
    const off = await sw.fireFetch(req('list.html', 'navigate'));
    const body = off ? await off.text() : '';
    ok(!!off && body === 'net:' + new URL('list.html', BASE).href,
      '网络失败后回落到预缓存版本（断网仍能打开页面）');

    // 从未缓存过的页面 → 回落首页
    const never = await sw.fireFetch(req('quiz.html', 'navigate'));
    const neverBody = never ? await never.text() : '';
    ok(!!never && neverBody === 'net:' + new URL('index.html', BASE).href,
      '无该页缓存时回落 index.html，而不是白屏');
    ok(net.fail === true, '兜底过程没有偷偷成功联网（说明确实走了缓存）');
  }

  /* ----------------------------------------------------------- activate */

  section('activate · 旧版本清理');
  {
    net.reset();
    const sw = boot(code);
    await sw.fire('install');
    await sw.caches.open('lectai-static-oldver');
    ok((await sw.caches.keys()).length === 2, '前置：存在新旧两个缓存');

    await sw.fire('activate');
    const keys = await sw.caches.keys();
    ok(keys.length === 1 && keys[0] === 'lectai-static-deadbeef', '只保留当前版本缓存');
    ok(sw.flags.claimed === true, 'activate 结束调用 clients.claim');
  }

  console.log('\n----------------------------------------');
  console.log(`通过 ${passed} / ${passed + failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
