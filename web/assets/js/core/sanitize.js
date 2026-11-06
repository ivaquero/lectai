/* ==========================================================================
   core/sanitize.js —— 后端 HTML 字段的安全渲染
   --------------------------------------------------------------------------
   背景：/api/ai/ask 与 /api/quiz/grade 会返回带 <b>/<code> 等富文本的字符串，
   以前直接塞进 innerHTML 属于典型 XSS sink。即便当前数据源在仓库里（可信），
   一旦接入外部 LLM 或用户投稿题目，就会立刻被利用。

   策略：
   1) 白名单标签 + 白名单属性，其它一律剥掉；
   2) script/style/iframe/object 等危险标签整段丢弃（子节点保留为纯文本）；
   3) 所有 href/src 只允许 http/https/mailto/相对路径，禁止 javascript:/data:；
   4) 无 DOMParser 环境（jsdom/node test）时退化为纯文本转义，绝不放行原文。

   用法：
     el('div', { html: DS.sanitize(rawHtml) })   // 只在后端标 trusted_html 时调用
     el('div', { text: rawText })                 // 其它情况用 text，走 textContent
   ========================================================================== */
(function () {
  'use strict';

  const DS = (window.DS = window.DS || {});

  // 允许保留的标签（大写匹配）
  const ALLOWED_TAGS = new Set([
    'A', 'B', 'I', 'EM', 'STRONG', 'U', 'S', 'SMALL', 'MARK',
    'P', 'BR', 'HR', 'DIV', 'SPAN',
    'UL', 'OL', 'LI',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR',
    'SUB', 'SUP',
    'BLOCKQUOTE', 'Q', 'CITE', 'ABBR',
    'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'TR', 'TD', 'TH',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION'
  ]);

  // 遇到这些标签直接把它和它的所有内容都干掉
  const DROP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'LINK', 'META',
    'BASE', 'FORM', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'OPTION',
    'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT'
  ]);

  // 全局允许的属性
  const GLOBAL_ATTRS = new Set(['title']);
  // 每个标签额外允许的属性
  const TAG_ATTRS = {
    A: new Set(['href']),
    TD: new Set(['colspan', 'rowspan']),
    TH: new Set(['colspan', 'rowspan', 'scope'])
  };

  const URL_ATTRS = new Set(['href']);  // src 类不放开，禁止 <img>
  const SAFE_URL = /^(?:https?:|mailto:|tel:|\/|#|\.\/|\.\.\/)/i;

  function isSafeUrl(v) {
    if (typeof v !== 'string') return false;
    const s = v.replace(/[\u0000-\u001F\s]+/g, '');
    if (!s) return false;
    if (/^javascript:/i.test(s) || /^data:/i.test(s) || /^vbscript:/i.test(s)) return false;
    return SAFE_URL.test(s);
  }

  function attrAllowed(tag, name) {
    const lname = String(name).toLowerCase();
    if (lname.startsWith('on')) return false;      // 事件属性一律拒绝
    if (lname === 'style' || lname === 'class') return false; // 只保留语义
    if (GLOBAL_ATTRS.has(lname)) return true;
    const bag = TAG_ATTRS[tag];
    if (bag && bag.has(lname)) {
      if (URL_ATTRS.has(lname)) return true;        // 值再单独校
      return true;
    }
    return false;
  }

  function escapeText(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /** 无 DOM 环境的兜底：全部转成纯文本（转义后返回，可安全塞进 innerHTML） */
  function fallbackToText(html) {
    // 去掉看起来像标签的片段，再整体转义
    return escapeText(String(html == null ? '' : html).replace(/<[^>]*>/g, ' '));
  }

  /**
   * 清洗一段 HTML，返回可以塞给 innerHTML 的字符串。
   * 保持节点顺序；未知/危险标签剥壳保留子节点内容；DROP_TAGS 整段丢弃。
   */
  DS.sanitize = function (html) {
    const raw = html == null ? '' : String(html);
    if (!raw) return '';
    if (typeof window.DOMParser === 'undefined' || typeof document === 'undefined') {
      return fallbackToText(raw);
    }

    let doc;
    try {
      // 用 XML 以外的模式解析；<template> 隔离运行环境，脚本不会执行
      doc = new window.DOMParser().parseFromString(
        '<!DOCTYPE html><html><body><template id="__ds_sanitize">' + raw + '</template></body></html>',
        'text/html'
      );
    } catch (e) {
      return fallbackToText(raw);
    }

    const tpl = doc.getElementById && doc.getElementById('__ds_sanitize');
    const srcRoot = tpl && tpl.content ? tpl.content : (tpl || doc.body);
    if (!srcRoot) return fallbackToText(raw);

    const out = doc.createDocumentFragment();

    function walk(src, dst) {
      for (let i = 0; i < src.childNodes.length; i++) {
        const node = src.childNodes[i];

        if (node.nodeType === 3) {                      // TEXT_NODE
          dst.appendChild(doc.createTextNode(node.nodeValue || ''));
          continue;
        }
        if (node.nodeType === 8) continue;              // COMMENT_NODE 直接丢
        if (node.nodeType !== 1) continue;              // 其它（doctype 等）丢

        const tag = String(node.tagName || '').toUpperCase();
        if (DROP_TAGS.has(tag)) continue;

        if (!ALLOWED_TAGS.has(tag)) {
          // 未识别标签：脱壳，保留子节点内容继续走
          walk(node, dst);
          continue;
        }

        const clean = doc.createElement(tag.toLowerCase());

        // 属性白名单
        if (node.attributes) {
          for (let a = 0; a < node.attributes.length; a++) {
            const at = node.attributes[a];
            if (!attrAllowed(tag, at.name)) continue;
            let v = at.value;
            if (URL_ATTRS.has(String(at.name).toLowerCase())) {
              if (!isSafeUrl(v)) continue;
            }
            clean.setAttribute(at.name, v);
          }
        }

        if (tag === 'BR' || tag === 'HR') {
          dst.appendChild(clean);
        } else {
          dst.appendChild(clean);
          walk(node, clean);
        }
      }
    }

    walk(srcRoot, out);

    // 序列化片段
    const wrapper = doc.createElement('div');
    wrapper.appendChild(out);
    return wrapper.innerHTML;
  };
})();
