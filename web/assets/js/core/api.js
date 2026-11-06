/* ==========================================================================
   core/api.js —— 后端请求层
   --------------------------------------------------------------------------
   ★ 唯一需要改地址的地方：API_ORIGIN ★

   1) 由后端托管前端（推荐）：打开 http://127.0.0.1:8000 → 同源，走相对路径
   2) 前端单独打开（file:// 或别的端口）→ 走 API_ORIGIN 绝对地址，后端已开 CORS
   3) 后端没起 → 请求失败返回 {ok:false, offline:true}，由调用方决定降级
   ========================================================================== */
(function () {
  'use strict';

  const DS = (window.DS = window.DS || {});

  const API_ORIGIN = 'http://127.0.0.1:8000';
  const sameOrigin =
    (location.protocol === 'http:' || location.protocol === 'https:') &&
    location.port === String(new URL(API_ORIGIN).port);

  const API_BASE = sameOrigin ? '' : API_ORIGIN;

  /**
   * 超时阈值分级（P-010）：不同接口对延迟容忍度不同，集中一处便于调整。
   *   request 常规操作默认上限 / probe 健康探测（要快）/ state 首屏对齐 / ai 大模型留足余量
   */
  const TIMEOUTS = { request: 8000, probe: 2500, state: 4000, ai: 20000 };

  /** 后端状态（各页共享） */
  const backend = (DS.backend = {
    online: false,
    checked: false,
    info: null,
    origin: API_ORIGIN,
    base: API_BASE
  });

  /**
   * 会话 id：同一标签页固定，用于后端隔离数据。
   * P-012：优先 crypto.randomUUID()（36 位 UUIDv4，浏览器环境安全随机），
   * 兜底链：crypto.getRandomValues → Math.random（老浏览器 / file:// 环境）。
   * 后端 core/session.py:sid 正则要求 ^[A-Za-z0-9_\-]{1,64}$，所以去掉破折号也可，
   * 但保留破折号更贴近 UUID 惯例；后端会原样接受。
   */
  function newSessionId() {
    const c = (typeof crypto !== 'undefined') ? crypto : null;
    if (c && typeof c.randomUUID === 'function') {
      try { return 'web-' + c.randomUUID(); } catch (e) { /* 继续兜底 */ }
    }
    if (c && typeof c.getRandomValues === 'function') {
      try {
        const b = new Uint8Array(16);
        c.getRandomValues(b);
        // 标 version 4 + variant，方便肉眼识别
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const hex = Array.prototype.map.call(b, (x) => x.toString(16).padStart(2, '0')).join('');
        return 'web-' + hex;
      } catch (e) { /* 继续兜底 */ }
    }
    // 最终兜底：32 位 Math.random 十六进制（熵较低但格式合法，且仅用于会话隔离，
    // 后端已把 sid 视为不可信输入并加正则校验）
    let s = '';
    while (s.length < 32) s += Math.random().toString(16).slice(2);
    return 'web-' + s.slice(0, 32);
  }

  function sessionId() {
    let sid;
    try { sid = sessionStorage.getItem('ds-session-id'); } catch (e) { sid = null; }
    if (!sid) {
      sid = newSessionId();
      try { sessionStorage.setItem('ds-session-id', sid); } catch (e) { /* 隐私模式忽略 */ }
    }
    return sid;
  }

  /**
   * 统一请求
   * @returns {Promise<{ok:boolean, data:any, msg:string, offline?:boolean, kind?:string}>}
   *   业务错误（栈空、越界）返回 ok:false 且 offline 为空
   *   网络/超时/HTTP 错误返回 ok:false, offline:true 并附 kind:
   *     'timeout' | 'network' | 'http-4xx' | 'http-5xx' | 'parse' | 'unknown'
   */
  async function request(path, opt) {
    const o = opt || {};
    const method = o.method || 'GET';
    // ★ 自动降级：后端已判定不可达且本路径可离线应答 → 直接返回本地快照，不发请求。
    if (DS.offline && DS.offline.active && DS.offline.available()) {
      const local = DS.offline.handle(method, path, o.body);
      if (local) return local;
    }
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, o.timeout || TIMEOUTS.request);
    let res;
    try {
      res = await fetch(API_BASE + path, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId()
        },
        body: o.body === undefined || o.body === null ? undefined : JSON.stringify(o.body),
        signal: ctrl.signal
      });
    } catch (e) {
      clearTimeout(timer);
      backend.online = false;
      // ★ 自动降级：连接失败 / 超时那一刻，尝试用本地快照应答本页所需接口。
      if (DS.offline && DS.offline.available()) {
        const local = DS.offline.handle(method, path, o.body);
        if (local) { DS.offline.enable(); return local; }
      }
      if (timedOut) {
        return { ok: false, data: null, msg: '请求超时，请稍后重试', offline: true, kind: 'timeout' };
      }
      // fetch 抛错基本只剩 TypeError('Failed to fetch')——网络不可达 / CORS 阻断
      return { ok: false, data: null, msg: '后端未连接', offline: true, kind: 'network' };
    }
    clearTimeout(timer);

    if (!res.ok) {
      // 4xx/5xx 区分开：4xx 通常是我方请求有问题，不该判定后端离线
      const kind = res.status >= 500 ? 'http-5xx' : 'http-4xx';
      if (res.status >= 500) backend.online = false;
      // 尽量解析后端 err(msg) 结构，回退到 HTTP 状态描述
      let msg = 'HTTP ' + res.status;
      try {
        const j = await res.json();
        if (j && j.msg) msg = j.msg;
      } catch (e) { /* 忽略非 JSON 响应 */ }
      return {
        ok: false,
        data: null,
        msg,
        offline: res.status >= 500,
        kind
      };
    }

    let json;
    try {
      json = await res.json();
    } catch (e) {
      backend.online = false;
      return { ok: false, data: null, msg: '后端响应非 JSON', offline: true, kind: 'parse' };
    }
    backend.online = true;
    if (json.code !== 0) return { ok: false, data: null, msg: json.msg || '操作失败' };
    return { ok: true, data: json.data, msg: json.msg || 'ok' };
  }

  DS.api = {
    request,
    base: API_BASE,
    origin: API_ORIGIN,
    TIMEOUTS,
    sessionId,
    get: (p, o) => request(p, Object.assign({ method: 'GET' }, o)),
    post: (p, body, o) => request(p, Object.assign({ method: 'POST', body }, o)),
    del: (p, o) => request(p, Object.assign({ method: 'DELETE' }, o)),

    /** 探测健康状态；后端不可达时自动切到本地离线快照（若离线数据可用） */
    async probe() {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUTS.probe);
        const res = await fetch(API_BASE + '/api/health', { signal: ctrl.signal });
        clearTimeout(timer);
        const json = await res.json();
        if (json.code === 0) {
          backend.online = true;
          backend.info = json.data || null;
          if (DS.offline) DS.offline.disable(); // 后端恢复 → 关掉降级
        } else {
          backend.online = false;
          backend.info = null;
        }
      } catch (e) {
        backend.online = false;
        backend.info = null;
      }
      // 后端不可达 + 本页声明支持离线快照 → 懒加载 offline-data.js 并启用降级。
      // P-005：不再靠 index/quiz/ai 页无条件同步 <script> 拉 78KB，只有真离线时才注入。
      if (!backend.online && DS.offline) {
        const docEl = document.documentElement;
        const capable =
          (docEl && docEl.hasAttribute('data-offline-snapshot')) ||
          (document.body && document.body.hasAttribute('data-offline-snapshot'));
        if (capable && !DS.offline.available()) {
          try { await DS.offline.loadSnapshot(); } catch (e) { /* 注入失败，保持普通离线态 */ }
        }
        if (DS.offline.available()) {
          DS.offline.enable();
          const h = DS.offline.handle('GET', '/api/health');
          if (h && h.ok) backend.info = h.data;
        }
      }
      backend.checked = true;
      document.dispatchEvent(new CustomEvent('backend:ready', { detail: backend }));
      return backend;
    }
  };
})();
