/* ==========================================================================
   pages/home.js —— 首页：用后端健康数据填指标
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;

  function apply(b) {
    if (!b || !b.info) return;
    const q = document.getElementById('m-quiz');
    const k = document.getElementById('m-kb');
    if (q && b.info.quiz_total) q.textContent = String(b.info.quiz_total);
    if (k && b.info.kb_entries) k.textContent = String(b.info.kb_entries);
  }

  if (DS.backend.checked) apply(DS.backend);
  document.addEventListener('backend:ready', (e) => apply(e.detail));
})();
