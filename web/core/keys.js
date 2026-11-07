/* ==========================================================================
   core/keys.js —— 全局快捷键
   --------------------------------------------------------------------------
   只在「焦点不在输入框」时生效，避免抢走表单里的方向键与空格。
   页面通过 DS.keys.bind(map) 注册本页按键。
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;

  /** 焦点是否在可输入元素中 */
  function typing() {
    const a = document.activeElement;
    if (!a) return false;
    const tag = (a.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || a.isContentEditable;
  }

  const NAME = {
    ' ': 'space',
    Spacebar: 'space',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Escape: 'esc',
    Enter: 'enter',
    Home: 'home',
    End: 'end'
  };

  /** 已注册的处理器：{ key: [fn] } */
  const map = {};

  function onKeyDown(e) {
    if (typing()) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const k = NAME[e.key] || (e.key || '').toLowerCase();
    const list = map[k];
    if (!list || !list.length) return;

    const fn = list[list.length - 1];
    if (fn(e) === false) return;
    e.preventDefault();
  }

  document.addEventListener('keydown', onKeyDown);

  DS.keys = {
    /**
     * 注册按键（后进先出，便于单页覆盖）
     * @param {Object} handlers  { space: fn, left: fn, ... }
     * @returns {Function} 注销函数
     */
    bind(handlers) {
      const added = [];
      Object.keys(handlers).forEach((k) => {
        (map[k] = map[k] || []).push(handlers[k]);
        added.push(k);
      });
      return function unbind() {
        added.forEach((k) => {
          map[k] = (map[k] || []).filter((f) => f !== handlers[k]);
        });
      };
    },
    isTyping: typing
  };
})();
