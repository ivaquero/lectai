/* ==========================================================================
   core/sw.js —— 注册 Service Worker（仅生产产物）
   --------------------------------------------------------------------------
   为什么只在生产注册：
     · dev 下 Vite 按需编译模块，URL 上带着 ?t= 时间戳与 HMR 客户端，SW 缓存会
       让「改了不生效 / 生效的是旧版」反复出现，排查成本极高。
     · 后端直接托管 web/ 源码时（uvicorn 的 StaticFiles）根本没有 /sw.js 这个
       文件，注册必然 404。
   所以用构建期常量 ENV.PROD 做闸门：源码直托管与 dev 都不注册，行为与改造前
   完全一致；只有 dist 产物（静态发布、vite preview）才装上离线层。

   SW 的作用边界：它只负责让 HTML/JS/CSS 离线可打开。后端不可达时的业务降级
   仍由 core/api.js + core/offline.js 那条链路处理，两者互不依赖。
   ========================================================================== */
(function () {
  'use strict';

  const DS = (window.DS = window.DS || {});
  const ENV = import.meta.env || {};

  const supported =
    !!ENV.PROD &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    (location.protocol === 'http:' || location.protocol === 'https:');

  function register() {
    if (!supported) return;
    /* 'sw.js' 相对当前文档解析：dist 根部署在 / 或 /lectai/ 都能找对，
       而 SW 的默认 scope 就是它所在目录，正好覆盖全部 5 个页面。 */
    navigator.serviceWorker
      .register('sw.js')
      .then(mark)
      .catch(function (e) {
        // 注册失败不影响任何在线功能，只在控制台留痕，便于排查证书/路径问题
        console.debug('[sw] 注册失败：', e && e.message);
      });

    // clients.claim() 生效时本页才真正被接管，那一刻再标一次
    navigator.serviceWorker.addEventListener('controllerchange', mark);
  }

  /* 把「离线层是否已接管本页」写成 <html data-sw="controlled">。
     不是为了 UI，而是为了让「打包产物到底装上没有」可被外部观测到——
     否则只能靠猜，或用 devtools 手点。样式表不引用这个属性。 */
  function mark() {
    const ctrl = navigator.serviceWorker && navigator.serviceWorker.controller;
    document.documentElement.setAttribute('data-sw', ctrl ? 'controlled' : 'registered');
  }

  // load 之后再注册：首次访问的带宽优先给页面本身，不与应用抢资源
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);

  DS.sw = {
    supported: supported,
    register: register,
    /** 当前是否有 SW 在控制本页（离线可用性的一种观测点，供测试/调试用） */
    get controlled() {
      return !!(navigator.serviceWorker && navigator.serviceWorker.controller);
    }
  };
})();
