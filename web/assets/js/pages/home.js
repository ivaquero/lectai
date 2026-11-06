/* ==========================================================================
   pages/home.js —— 首页：用后端健康数据填指标
   --------------------------------------------------------------------------
   P-002：题库/知识库数量全部从 /api/health 动态取，前端不再硬编码 "32 题 /
   21 条 / 4 类" 这类已经漂移的历史数字。后端返回：
     { quiz_total, quiz_categories, kb_entries, ... }
   离线时保留占位文案（"–" / "全部题库" / "高频考点"），不假装知道准确数字。
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node && value !== null && value !== undefined) node.textContent = String(value);
  }

  function apply(b) {
    if (!b || !b.info) return;
    const info = b.info;
    setText('m-quiz', info.quiz_total);
    setText('m-kb', info.kb_entries);
    if (info.quiz_categories) {
      setText('m-cats', info.quiz_categories + ' 类');
    }
    if (info.kb_entries) {
      setText('m-kb-tag', info.kb_entries + ' 条');
    }
  }

  if (DS.backend.checked) apply(DS.backend);
  document.addEventListener('backend:ready', (e) => apply(e.detail));
})();
