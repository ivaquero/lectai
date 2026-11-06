/* ==========================================================================
   core/toast.js —— 右下角轻提示
   ========================================================================== */
(function () {
  'use strict';

  const DS = (window.DS = window.DS || {});
  let host = null;

  function ensureHost() {
    if (host && document.body.contains(host)) return host;
    host = document.createElement('div');
    host.className = 'toast-host';
    document.body.appendChild(host);
    return host;
  }

  /**
   * @param {string} msg  文案
   * @param {'info'|'ok'|'warn'|'danger'} [kind]
   * @param {number} [ms] 停留时长
   */
  DS.toast = function (msg, kind, ms) {
    if (!msg) return;
    const box = ensureHost();
    const el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = msg;
    box.appendChild(el);

    requestAnimationFrame(() => el.classList.add('show'));
    const life = ms || (kind === 'warn' || kind === 'danger' ? 3600 : 2600);
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 260);
    }, life);

    // 最多同时显示 4 条
    while (box.children.length > 4) box.firstElementChild.remove();
  };

  ['ok', 'warn', 'danger', 'info'].forEach((kind) => {
    DS.toast[kind] = function (msg, ms) {
      return DS.toast(msg, kind, ms);
    };
  });
})();
