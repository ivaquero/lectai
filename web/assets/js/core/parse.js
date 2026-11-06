/* ==========================================================================
   core/parse.js —— 数字序列解析（全站唯一实现）
   --------------------------------------------------------------------------
   P-006：此前 pages/list/ops.js 与 pages/visual/ops.js 各抄了一份 parseNums，
   只差一个「结点 / 元素」的措辞。统一到这里，noun 作为参数传入。
   依赖 core/toast.js 的 DS.toast.warn（缺失时静默截断，不抛错）。
   ========================================================================== */
(function () {
  'use strict';

  const DS = (window.DS = window.DS || {});

  /**
   * 把 "3,1,4" / "3 1 4" / "3，1，4" 解析成整数数组。
   * @param {string} text 原始输入
   * @param {number} max  允许的最大个数（超出截断并提示）
   * @param {string} noun 量词后缀，如 '个结点' / '个元素'（用于提示文案）
   */
  DS.parseNums = function (text, max, noun) {
    const out = [];
    String(text || '')
      .split(/[,，\s]+/)
      .forEach((t) => {
        if (!t) return;
        const v = parseInt(t, 10);
        if (!isNaN(v)) out.push(v);
      });
    if (max && out.length > max) {
      out.length = max;
      if (DS.toast && DS.toast.warn) {
        DS.toast.warn('最多 ' + max + ' ' + (noun || '个元素') + '，多余部分已忽略');
      }
    }
    return out;
  };
})();
