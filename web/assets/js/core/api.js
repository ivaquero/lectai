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

  /** 后端状态（各页共享） */
  const backend = (DS.backend = {
    online: false,
    checked: false,
    info: null,
    origin: API_ORIGIN,
    base: API_BASE
  });

  /** 会话 id：同一标签页固定，用于后端隔离数据 */
  function sessionId() {
    let sid = sessionStorage.getItem('ds-session-id');
    if (!sid) {
      sid = 'web-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('ds-session-id', sid);
    }
    return sid;
  }

  /**
   * 统一请求
   * @returns {Promise<{ok:boolean, data:any, msg:string, offline?:boolean}>}
   *   业务错误（栈空、越界）返回 ok:false 且 offline 为空
   *   网络失败返回 ok:false, offline:true
   */
  async function request(path, opt) {
    const o = opt || {};
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), o.timeout || 8000);
    try {
      const res = await fetch(API_BASE + path, {
        method: o.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-Id': sessionId()
        },
        body: o.body === undefined || o.body === null ? undefined : JSON.stringify(o.body),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      backend.online = true;
      if (json.code !== 0) return { ok: false, data: null, msg: json.msg || '操作失败' };
      return { ok: true, data: json.data, msg: json.msg || 'ok' };
    } catch (err) {
      backend.online = false;
      return { ok: false, data: null, msg: '后端未连接', offline: true };
    } finally {
      clearTimeout(timer);
    }
  }

  DS.api = {
    request,
    base: API_BASE,
    origin: API_ORIGIN,
    sessionId,
    get: (p, o) => request(p, Object.assign({ method: 'GET' }, o)),
    post: (p, body, o) => request(p, Object.assign({ method: 'POST', body }, o)),
    del: (p, o) => request(p, Object.assign({ method: 'DELETE' }, o)),

    /** 探测健康状态 */
    async probe() {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 2500);
        const res = await fetch(API_BASE + '/api/health', { signal: ctrl.signal });
        clearTimeout(timer);
        const json = await res.json();
        backend.online = json.code === 0;
        backend.info = json.data || null;
      } catch (e) {
        backend.online = false;
        backend.info = null;
      }
      backend.checked = true;
      document.dispatchEvent(new CustomEvent('backend:ready', { detail: backend }));
      return backend;
    }
  };
})();
