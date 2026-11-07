/* ==========================================================================
   Service Worker —— 静态站离线化（模板，由 scripts/build.mjs 注入后写到 dist/web/sw.js）
   --------------------------------------------------------------------------
   为什么需要它：
     第三步让「后端不可达」时可视化仍可用的前提是**页面本身能打开**。但如果
     静态服务也不在（真断网、机房断外网、U 盘拷走后双击），HTML/JS/CSS 都拉不
     到，本地引擎再准也没机会执行。这一层只解决一件事：把静态资源留在浏览器里。

   三条策略，各有明确理由：
     1) /api/*  —— 绝不拦截、绝不缓存。直接放给网络。这样 api.js 的失败分支
        照常触发「降级到本地快照 / 本地引擎」；一旦缓存了 API，学生会看到
        过期的题库和错误的在线状态，这比离线更糟。
     2) 导航请求（打开页面）—— 网络优先 + 2.5s 超时兜底缓存。导航必须拿到最新
        HTML，否则新版本会引用不到已删除的哈希 chunk；而断网/弱网时超时后立刻
        用缓存，不让浏览器白屏等十几秒。成功的响应**不另存一份**：全部页面在
        install 阶段就已预缓存，再存一次只会多出一份可能与 chunk 不一致的副本。
     3) 其余同源静态资源 —— 缓存优先。文件名带内容哈希（list-krvKVH8C.js），
        内容变则名变，天然不可变，不需要回源校验。

   版本与清理：
     VERSION 由构建脚本对「全部产物内容」做 sha256 得到。CACHE 名带版本，
     activate 时删掉同前缀的旧缓存。构建不变 → 版本不变 → 不重装、不重复下载。
   ========================================================================== */

'use strict';

/* 由 build.mjs 替换：产物内容哈希（8 位）与预缓存清单（相对产物根） */
const VERSION = '__SW_VERSION__';
const PRECACHE = __SW_PRECACHE__;

const CACHE_PREFIX = 'lectai-static-';
const CACHE = CACHE_PREFIX + VERSION;

/* 本 SW 所在目录即产物根。用 self.location 而非 registration.scope：
   后者在部分实现里 install 阶段尚不可读，且 scope 可被 Service-Worker-Allowed 改写。 */
const BASE = new URL('./', self.location.href).href;

const NAV_TIMEOUT = 2500;
/** 形如 /api/... 或 /lectai/api/...；按路径段匹配，避免误伤 assets/api/ 这类名字 */
const API_PATH = /(^|\/)api\//;

const abs = (p) => new URL(p, BASE).href;

/* ------------------------------------------------------------------ 安装 */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const results = await Promise.allSettled(
        PRECACHE.map(async (path) => {
          const url = abs(path);
          // cache: 'reload' 绕过 HTTP 缓存，确保拿到的是本次构建的字节
          const res = await fetch(url, { cache: 'reload' });
          if (!res || !res.ok) throw new Error(url + ' → HTTP ' + (res && res.status));
          await cache.put(url, res);
        })
      );
      const failed = results.filter((r) => r.status === 'rejected');
      // 单个文件缺失不阻断安装：宁可少一页，也好过整站离线能力归零
      if (failed.length) {
        console.warn('[sw] 预缓存未完成，缺失 ' + failed.length + '/' + PRECACHE.length + ' 项');
        failed.slice(0, 5).forEach((r) => console.warn('[sw]', r.reason && r.reason.message));
      }
      // 新版本立即接管：本项目无「更新提示」UI，等待下一轮导航会让新旧缓存并存过久
      await self.skipWaiting();
    })()
  );
});

/* ------------------------------------------------------------------ 激活 */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* ------------------------------------------------------------------ 抓取 */

self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // 跨域一律直连：API_ORIGIN 可能指向另一个域，缓存它只会让降级判断失真
  if (url.origin !== self.location.origin) return;
  if (API_PATH.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith(navigate(req));
    return;
  }
  event.respondWith(asset(req));
});

/* -------------------------------------------------------------- 策略实现 */

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('network timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * 按 URL 取缓存，并忽略 Vary。
 *
 * ★ 这里踩过一个真坑，别改回 cache.match(request) ★
 *   vite preview（以及不少静态服务/CDN）会给响应带上 `Vary: Origin`。缓存里的条目
 *   是 install 阶段由 SW 自己发出的请求存入的，**没有 Origin 头**；而页面发出的子
 *   资源请求带 Origin。于是 `cache.match(request)` 按 Vary 逐字段比对、判定不匹配，
 *   静默落空 → 回源 → 断网时抛错。现象极具误导性：**HTML 能打开，JS/CSS 全挂**，
 *   控制台只说 net::ERR_FAILED，看不出是缓存没命中。
 *   产物文件名带内容哈希，同一 URL 的字节恒定，不存在「按请求头返回不同内容」的
 *   可能，因此按 URL 字符串取是安全的。
 *
 *   两重保险缺一不可：主因是**用 URL 字符串当键**（字符串键不带请求头，Vary 无从
 *   比对）；`ignoreVary` 是第二道，防止某些实现从 URL 反造出的 Request 又带上头。
 *   只留 ignoreVary 而改回传 request，测试会红——已被 sw.test.js 的 Vary 用例覆盖。
 */
async function lookup(cache, req, ignoreSearch) {
  const url = typeof req === 'string' ? req : req.url;
  const hit = await cache.match(url, { ignoreVary: true });
  if (hit) return hit;
  if (ignoreSearch && url.indexOf('?') !== -1) {
    return cache.match(url.split('?')[0], { ignoreVary: true });
  }
  return undefined;
}

/** 导航：网络优先，失败/超时回落到预缓存 */
async function navigate(req) {
  const cache = await caches.open(CACHE);
  try {
    return await withTimeout(fetch(req), NAV_TIMEOUT);
  } catch (e) {
    const hit = await lookup(cache, req, true);
    if (hit) return hit;

    // 部署在子路径时，/lectai/ 与 /lectai/index.html 是两个不同的键：都试一遍
    const home = await lookup(cache, abs('index.html'));
    if (home) return home;

    return new Response('离线，且本地缓存中没有这个页面。', {
      status: 503,
      headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }
}

/** 静态资源：缓存优先，未命中则回源并补进缓存 */
async function asset(req) {
  const cache = await caches.open(CACHE);
  const hit = await lookup(cache, req);
  if (hit) return hit;

  const res = await fetch(req);
  if (res && res.ok) {
    // 这里必须 await：写缓存不能挂在响应返回之后。worker 空闲即被浏览器终止，
    // 未完成的 put 会随之丢失，而这个资源下次离线就取不到；并发请求同一资源时
    // 也会各自回源。多花一次写盘的时间，换「写到就是写到了」。
    await cache.put(urlOf(req), res.clone()).catch(() => {});
  }
  return res;
}

/** 统一用 URL 字符串做缓存键，避免 Request 头差异影响写入 */
function urlOf(req) {
  return typeof req === 'string' ? req : req.url;
}
