/* ==========================================================================
   core/dom.js —— 极简 DOM 工具
   不用框架，够用就好；所有页面共享 DS.*
   ========================================================================== */
(function () {
  'use strict';

  const DS = (window.DS = window.DS || {});

  /** 单元素查询，支持传入元素本身 */
  DS.$ = function (sel, root) {
    if (sel instanceof Element) return sel;
    return (root || document).querySelector(sel);
  };

  /** 多元素查询，返回真数组 */
  DS.$$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };

  /**
   * 建元素：el('div.card', {id:'x'}, [child, 'text'])
   * 标签支持 .class 简写（只处理一层）
   */
  DS.el = function (spec, attrs, children) {
    const m = String(spec).match(/^([a-zA-Z0-9-]+)?((?:\.[\w-]+)*)$/);
    const tag = (m && m[1]) || 'div';
    const node = document.createElement(tag);
    if (m && m[2]) {
      m[2].split('.').filter(Boolean).forEach((c) => node.classList.add(c));
    }
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), v);
        } else node.setAttribute(k, v === true ? '' : v);
      });
    }
    (Array.isArray(children) ? children : children ? [children] : []).forEach((c) => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  /** HTML 转义（用于拼接 innerHTML 的场景） */
  DS.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[c]));
  };

  /** 数字补零 */
  DS.pad = function (n, w) {
    return String(n).padStart(w || 2, '0');
  };

  /** 触发一次 CSS 动画（先移除再添加类） */
  DS.reflow = function (node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  };

  /** 平滑滚动到容器内的某个元素（只滚最近的滚动父级） */
  DS.scrollIntoBox = function (node, box, pad) {
    if (!node || !box) return;
    try {
      const top = node.offsetTop - (pad || 8);
      const bottom = top + node.offsetHeight + (pad || 8);
      if (top < box.scrollTop) box.scrollTo({ top: top, behavior: 'smooth' });
      else if (bottom > box.scrollTop + box.clientHeight) {
        box.scrollTo({ top: bottom - box.clientHeight, behavior: 'smooth' });
      }
    } catch (e) {
      /* jsdom 等无布局环境忽略 */
    }
  };
})();
