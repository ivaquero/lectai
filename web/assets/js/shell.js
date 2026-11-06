/* ==========================================================================
   shell.js —— 全站外壳：导航高亮、后端状态徽标、页脚
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;
  const $ = DS.$;
  const $$ = DS.$$;

  function markActive() {
    // visual.html 是通用可视化页（链表/栈/队列共用），仍高亮「单链表」这一项
    const raw = document.body.dataset.page;
    const page = raw === 'visual' ? 'list' : raw;
    $$('.nav-item').forEach((a) => {
      const on = a.dataset.nav === page;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  function setBadge(state, label, title) {
    const el = $('#nav-status');
    if (!el) return;
    el.className = 'nav-status ' + state;
    el.innerHTML = '<i></i><span></span>';
    el.querySelector('span').textContent = label;
    el.title = title || '';
  }

  function applyBackend() {
    const b = DS.backend;
    if (!b.checked) {
      setBadge('checking', '检测后端…', '正在检测 ' + b.origin);
      return;
    }
    if (b.online) {
      const total = b.info && b.info.quiz_total ? b.info.quiz_total : '?';
      setBadge(
        'online',
        '后端已连接',
        'FastAPI 已连接 · ' + (b.base || location.origin) + ' · 题库 ' + total + ' 题'
      );
    } else {
      setBadge('offline', '离线模式', '未连接到 ' + b.origin + '，请启动后端后重试');
    }
  }

  function initFooter() {
    const y = $('#foot-year');
    if (y) y.textContent = String(new Date().getFullYear());
  }

  /** 键盘用户的跳转链接：Tab 第一下就能跳到主内容 */
  function addSkipLink() {
    if ($('.skip-link')) return;
    const main = document.querySelector('main.page');
    if (main && !main.id) main.id = 'main';
    const a = document.createElement('a');
    a.className = 'skip-link';
    a.href = '#main';
    a.textContent = '跳到主要内容';
    document.body.insertBefore(a, document.body.firstChild);
  }

  /** 后端离线时在页面顶部挂一条明确的横幅（含启动命令与重试按钮） */
  function renderOfflineBanner() {
    const b = DS.backend;
    const box = document.querySelector('main.page');
    if (!box) return;
    let el = $('#offline-banner');

    if (!b.checked || b.online) {
      if (el) el.remove();
      return;
    }
    if (!el) {
      el = document.createElement('div');
      el.id = 'offline-banner';
      el.className = 'offline-banner';
      el.setAttribute('role', 'status');
      box.insertBefore(el, box.firstChild);
    }

    const offlineCapable = window.DS.offline && window.DS.offline.available();
    if (offlineCapable) {
      el.className = 'offline-banner info';
      el.innerHTML =
        '<b>离线模式已启用</b>' +
        '<span>后端未连接，本页已自动切换到本地快照：刷题、判题、解析、答疑、首页统计均可离线使用；' +
        '仅链表 / 栈 / 队列的逐步可视化需要后端。要启用可视化，在 <code>backend</code> 目录执行 ' +
        '<code>uvicorn main:app --port 8000</code> 后点重试。</span>' +
        '<button class="btn" type="button" id="banner-retry">重试</button>';
    } else {
      el.className = 'offline-banner';
      el.innerHTML =
        '<b>后端未连接</b>' +
        '<span>本页数据由 FastAPI 提供。在 <code>backend</code> 目录执行 ' +
        '<code>uvicorn main:app --port 8000</code> 后点重试。</span>' +
        '<button class="btn" type="button" id="banner-retry">重试</button>';
    }
    $('#banner-retry').onclick = () => {
      DS.backend.checked = false;
      applyBackend();
      DS.api.probe().then(() => { applyBackend(); renderOfflineBanner(); });
    };
  }

  function init() {
    markActive();
    initFooter();
    addSkipLink();
    applyBackend();
    const after = () => { applyBackend(); renderOfflineBanner(); };
    document.addEventListener('backend:ready', after);
    DS.api.probe().then(after);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
