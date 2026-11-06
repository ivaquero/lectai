/* ==========================================================================
   pages/ai.js —— AI 答疑页
   --------------------------------------------------------------------------
   POST /api/ai/ask → { answer(html), title, source: local_kb|llm|mock, model }
   来源角标直接显示后端给的 source，前端不假装自己有答案。
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;
  const $ = DS.$;
  const el = DS.el;

  const HOT = [
    'KMP 的 next 数组怎么求？',
    '循环队列怎么判满？',
    '快速排序为什么最坏是 O(n²)？',
    '哈夫曼树的 WPL 怎么算？',
    '头插法和尾插法有什么区别？',
    '二叉排序树删除结点有哪几种情况？',
    '什么时候用邻接矩阵，什么时候用邻接表？',
    'Dijkstra 为什么不能处理负权边？'
  ];

  const SRC_LABEL = {
    local_kb: ['ok', 'local_kb · 本地知识库'],
    llm: ['info', 'llm · 大模型'],
    mock: ['warn', 'mock · 未命中知识库']
  };

  let asked = 0;
  let pending = false;

  /* ============================ 消息 ============================ */

  function scrollDown() {
    const box = $('#msgs');
    try { box.scrollTop = box.scrollHeight; } catch (e) { /* 无布局环境 */ }
  }

  function addMsg(who, node) {
    const wrap = el('div.msg.who-' + who, {}, [
      el('span.avatar', { text: who === 'ai' ? 'AI' : '我' })
    ]);
    const b = el('div.bubble', {}, [node]);
    wrap.appendChild(b);
    $('#msgs').appendChild(wrap);
    scrollDown();
    return b;
  }

  function addUser(text) {
    return addMsg('user', el('p', { text: text }));
  }

  /** 思考中占位：返回气泡，后续就地替换内容 */
  function addThinking() {
    const b = addMsg('ai', el('span.thinking', {}, [
      el('i'), el('i'), el('i')
    ]));
    return b;
  }

  function addAnswer(data, ms) {
    const frag = [];
    if (data.title) frag.push(el('div.ans-title', { text: data.title }));
    // P-003：只有后端明确标 trusted_html 时才走 sanitize+innerHTML，其余一律 textContent。
    const body = data.answer_content_type === 'trusted_html'
      ? el('div', { html: DS.sanitize(data.answer || '') })
      : el('div', { text: data.answer || '' });
    frag.push(body);

    const src = SRC_LABEL[data.source] || ['', data.source || 'unknown'];
    const badges = [
      el('span.badge.' + src[0], { text: src[1] }),
      el('span.badge', { text: ms + ' ms' })
    ];
    if (data.offline) badges.push(el('span.badge.info', { text: '离线模式 · 本地知识库' }));
    frag.push(el('div.src', {}, badges));

    const b = addMsg('ai', el('div', {}, frag));
    if (data.model) {
      b.appendChild(el('div.src', {}, [el('span.badge', { text: 'model: ' + data.model })]));
    }
    return b;
  }

  /* ============================ 提问 ============================ */

  async function ask(text) {
    text = String(text || '').trim();
    if (!text || pending) return;

    const input = $('#ask-input');
    const btn = $('#btn-ask');

    addUser(text);
    input.value = '';
    pending = true;
    btn.disabled = true;

    const bubble = addThinking();
    const t0 = performance.now();

    const r = await DS.api.post('/api/ai/ask', { question: text }, { timeout: DS.api.TIMEOUTS.ai });
    const ms = Math.round(performance.now() - t0);

    pending = false;
    btn.disabled = false;

    const wrap = bubble.parentElement;

    if (!r.ok) {
      bubble.innerHTML = '';
      bubble.appendChild(el('div.note.danger', {
        html: r.offline
          ? '后端未连接。请在 backend 目录执行 <code>uvicorn main:app --port 8000</code> 后重试。'
          : ('请求失败：' + DS.esc(r.msg || '未知错误'))
      }));
      return;
    }

    asked++;
    $('#meta-asked').textContent = String(asked);
    // 用正式答案替换占位气泡（保留头像，避免跳动）
    wrap.removeChild(bubble);
    const nb = addAnswer(r.data, ms);
    void nb;
  }

  /* ============================ 启动 ============================ */

  function init() {
    const form = $('#askbar');
    const input = $('#ask-input');

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      ask(input.value);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        ask(input.value);
      }
    });

    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(120, Math.max(42, input.scrollHeight)) + 'px';
    });

    const hot = $('#hotq');
    HOT.forEach((q) => {
      hot.appendChild(el('button', {
        type: 'button',
        text: q,
        onclick: () => ask(q)
      }));
    });

    // 开场白
    addMsg('ai', el('div', {}, [
      el('p', { text: '你好，我是这个站点的数据结构答疑助手。' }),
      el('p', {
        html: '可以问我 <b>KMP next 数组</b>、<b>循环队列判满</b>、<b>哈夫曼 WPL</b>、' +
          '<b>快排最坏复杂度</b> 这类 408 考点；命中本地知识库会直接给答案，' +
          '未命中会转大模型（当前返回占位回答）。'
      }),
      el('div.src', {}, [el('span.badge.info', { text: 'local_kb · 21 条' })])
    ]));

    input.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
