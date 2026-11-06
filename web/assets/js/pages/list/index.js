/* ==========================================================================
   pages/list/index.js —— 单链表页控制器
   --------------------------------------------------------------------------
   职责：拼 UI、发请求、把返回的整条轨迹交给 Trace 播放器。
   这里没有一行算法——结点怎么连、指针怎么走，全部由后端决定。
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;
  const $ = DS.$;
  const el = DS.el;

  /* ---------------------- 多模块：链表 / 栈 / 队列 ----------------------
     本控制器是通用的：换模块只换这张表（操作元数据、渲染器、接口前缀）。
     页面用 hash 指定模块：visual.html#stack、#queue；list.html 固定为 list。 */
  const MODULES = {
    list: {
      ops: 'listOps', render: 'listRender', legend: 'listLegend',
      api: '/api/linkedlist/trace', defaults: '3,1,4,1,5', max: 12,
      unit: '个结点', title: '单链表可视化',
      lede: '算法在后端跑完并生成整条步骤轨迹，这里只负责回放——所以能暂停、能单步、能回退，每一步都对应一行代码。'
    },
    stack: {
      ops: 'stackOps', render: 'stackRender', legend: 'seqLegend',
      api: '/api/stack/trace', defaults: '5,3,8', max: 10,
      unit: '个元素', title: '栈可视化',
      lede: '只在栈顶操作：push 先移指针再写入，pop 先取值再下移。顺序栈是 408 里唯一要求手写判空判满的线性表。'
    },
    queue: {
      ops: 'queueOps', render: 'queueRender', legend: 'seqLegend',
      api: '/api/queue/trace', defaults: '5,3,8', max: 9,
      unit: '个元素', title: '队列可视化',
      lede: '循环队列牺牲一个单元区分空与满：空是 front == rear，满是 (rear+1) % m == front。'
    }
  };

  const MODKEY = (location.hash || '').replace('#', '') ||
    document.body.dataset.visual || 'list';
  const MOD = MODULES[MODKEY] || MODULES.list;

  const OPS = DS[MOD.ops] || DS.listOps;
  const API = MOD.api;
  const DEFAULT_VALUES = MOD.defaults;

  /** 链表用 nodes、栈/队列用 items，这里统一取主结构 */
  function itemsOf(step) {
    return (step && (step.nodes || step.items)) || [];
  }

  /** 无轨迹时给渲染器构造一个指针快照 */
  function ptrFor(list) {
    if (!list.length) return MODKEY === 'stack' ? { top: 'NULL' }
      : MODKEY === 'queue' ? { front: 'NULL', rear: 'NULL' } : {};
    if (MODKEY === 'stack') return { top: list[list.length - 1].id };
    if (MODKEY === 'queue') {
      return { front: list[0].id, rear: list[list.length - 1].id };
    }
    return { head: list[0].id };
  }

  let trace = null;          // Trace 实例
  let current = OPS[1];      // 当前操作（默认头插）
  let lastIds = new Set();   // 上一步的结点集合（入场动画用）
  let booted = false;        // 后端是否可用
  let stepItems = [];        // 步骤列表 <li>

  /* ============================ 静态区块 ============================ */

  function buildTabs() {
    const host = $('#op-tabs');
    host.innerHTML = '';
    OPS.forEach((op) => {
      const b = el('button.tab', {
        type: 'button',
        role: 'tab',
        dataset: { op: op.key },
        onclick: () => selectOp(op)
      }, [el('b', { text: op.tab }), el('span', { text: op.sub })]);
      host.appendChild(b);
    });
  }

  function buildLegend() {
    const host = $('#legend');
    host.innerHTML = '';
    (DS[MOD.legend] || []).forEach(([color, label]) => {
      host.appendChild(
        el('span.legend-item', {}, [
          el('i', { style: 'background:' + color }),
          el('span', { text: label })
        ])
      );
    });
  }

  /* ============================ 操作面板 ============================ */

  function selectOp(op) {
    current = op;
    DS.$$('#op-tabs .tab').forEach((t) => {
      const on = t.dataset.op === op.key;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });

    $('#op-title').textContent = op.tab;
    $('#op-desc').innerHTML = op.desc;

    const form = $('#op-form');
    form.innerHTML = '';
    op.fields.forEach((f) => {
      const input = el('input', {
        id: 'f-' + f.name,
        name: f.name,
        type: f.type || 'text',
        value: f.value === undefined ? '' : f.value,
        placeholder: f.ph || '',
        autocomplete: 'off'
      });
      if (f.min !== undefined) input.min = f.min;
      form.appendChild(el('div.field-inline', {}, [el('label', { text: f.label }), input]));
    });

    if (!op.fields.length) {
      form.appendChild(el('p.hint.small', { text: '这个操作不需要参数，直接点执行。' }));
    }

    // 复杂度
    const cx = $('#complexity');
    cx.innerHTML = '';
    op.cx.forEach(([k, v]) => {
      cx.appendChild(el('span.cx-row', {}, [
        el('span.cx-k', { text: k }),
        el('span.cx-v', { text: v })
      ]));
    });

    // 易错点
    const tips = $('#tips');
    tips.innerHTML = '';
    op.tips.forEach((t) => tips.appendChild(el('li', { html: t })));

    // 代码面板：先清空，等执行后由后端返回的代码填充
    $('#code-title').textContent = '待执行';

    // 焦点给第一个输入框，方便直接改数值回车
    const first = form.querySelector('input');
    if (first) first.focus();
  }

  function readForm() {
    const out = {};
    DS.$$('#op-form input').forEach((i) => { out[i.name] = i.value; });
    return out;
  }

  /* ============================ 请求 ============================ */

  async function run() {
    if (!booted) {
      DS.toast.warn('后端未连接，轨迹需要后端生成');
      return;
    }
    const body = current.body(readForm());
    const btn = $('#btn-run');
    btn.disabled = true;
    btn.textContent = '执行中…';

    const r = await DS.api.post(current.path, body, { timeout: DS.api.TIMEOUTS.request });
    btn.disabled = false;
    btn.textContent = '执行';

    if (!r.ok) {
      if (r.offline) markOffline();
      else DS.toast.danger(r.msg || '执行失败');
      return;
    }
    loadTrace(r.data);
  }

  async function resetList() {
    if (!booted) { DS.toast.warn('后端未连接'); return; }
    const r = await DS.api.post(API + '/build', { values: DS.parseNums(DEFAULT_VALUES, MOD.max, MOD.unit) });
    if (!r.ok) {
      if (r.offline) markOffline();
      else DS.toast.danger(r.msg || '重置失败');
      return;
    }
    DS.toast.ok('已重置为 ' + DEFAULT_VALUES);
    loadTrace(r.data);
  }

  /** 拉取当前状态（不带轨迹），用于首屏与执行后对齐长度 */
  async function fetchState() {
    const r = await DS.api.get(API + '/state', { timeout: DS.api.TIMEOUTS.state });
    if (!r.ok) return null;
    const d = r.data;
    $('#meta-len').textContent = String(d.length);
    $('#meta-max').textContent = String(d.max_nodes);
    if (!trace || trace.isEmpty) {
      drawState(d.items || d.nodes || []);
      $('#c-len').textContent = String(d.length);
    }
    return d;
  }

  /* ============================ 轨迹装载 ============================ */

  let traceLoadSeq = 0;   // 每次装载递增（测试与调试可观测）

  function loadTrace(meta, autoplay) {
    if (!meta || !Array.isArray(meta.trace) || !meta.trace.length) {
      DS.toast.warn('后端没有返回轨迹');
      return;
    }
    trace.load(meta);
    $('#canvas-wrap').dataset.traceRun = String(++traceLoadSeq);
    $('#meta-len').textContent = String(meta.length);
    $('#meta-max').textContent = String(meta.max_nodes || 12);
    renderCode(meta.code);
    $('#code-title').textContent = meta.title || '对应代码';
    buildStepList(meta.trace);
    lastIds = new Set();
    if (autoplay === false) trace.last();   // 首屏默认序列：直接停在终态，不播动画
    else trace.play();
  }

  /** 无轨迹时的静态状态视图 */
  function drawState(list) {
    DS[MOD.render].draw($('#canvas-wrap'), {
      nodes: MODKEY === 'list' ? list : [],
      items: list,
      aside: [],
      ptr: ptrFor(list),
      mark: {},
      info: '当前状态'
    });
    $('#canvas-note').textContent = list.length ? list.length + ' ' + MOD.unit
      : (MODKEY === 'list' ? '空表' : (MODKEY === 'stack' ? '空栈' : '空队'));
  }

  /* ============================ 渲染 ============================ */

  function renderCode(code) {
    const host = $('#pseudo');
    host.innerHTML = '';
    if (!code || !code.lines) {
      host.appendChild(el('div.empty', {}, [
        el('span.empty-mark', { text: 'C' }),
        el('span', { text: '这个操作没有对应代码' })
      ]));
      return;
    }
    const structural = code.structural || [];
    code.lines.forEach((text, i) => {
      host.appendChild(el('div.pline' + (structural.indexOf(i) >= 0 ? ' structural' : ''), {
        dataset: { line: String(i) }
      }, [
        el('span.ln', { text: String(i + 1) }),
        el('span.code', { text: text })
      ]));
    });
  }

  function buildStepList(steps) {
    const host = $('#step-list');
    host.innerHTML = '';
    stepItems = steps.map((st, i) => {
      const li = el('li', { dataset: { i: String(i) }, onclick: () => trace.seek(i + 1, { force: true }) }, [
        el('span.n', { text: String(i + 1) }),
        el('span', { text: st.info })
      ]);
      host.appendChild(li);
      return li;
    });
  }

  function paint() {
    const step = trace.current;
    if (!step) return;

    // 入场动画：与上一步相比新出现的结点
    const ids = new Set(itemsOf(step).map((n) => n.id));
    DS[MOD.render].draw($('#canvas-wrap'), step, { prevIds: lastIds });
    lastIds = ids;

    const total = trace.total;
    const cur = trace.cursor;

    $('#readout-step').textContent = '步 ' + cur + '/' + total;
    $('#readout-text').textContent = step.info || '';
    $('#progress-bar').style.width = (total ? (cur / total) * 100 : 0) + '%';
    $('#canvas-note').textContent = itemsOf(step).length + ' ' + MOD.unit;

    const c = step.counters || {};
    $('#c-len').textContent = String(itemsOf(step).length);
    $('#c-cmp').textContent = String(c.compares || 0);
    $('#c-mov').textContent = String(c.moves || 0);
    $('#c-vis').textContent = String(c.visited || 0);

    // 代码高亮
    const lines = DS.$$('#pseudo .pline');
    lines.forEach((n) => n.classList.remove('active'));
    if (step.line !== null && step.line !== undefined && lines[step.line]) {
      lines[step.line].classList.add('active');
      DS.scrollIntoBox(lines[step.line], $('#pseudo'), 12);
    }

    // 步骤列表
    stepItems.forEach((li, i) => li.classList.toggle('on', i === cur - 1));
    const onLi = stepItems[cur - 1];
    if (onLi) DS.scrollIntoBox(onLi, $('#step-list'), 10);

    syncPlayBtn();
  }

  function syncPlayBtn() {
    const b = $('#btn-play');
    b.textContent = trace.playing ? '⏸ 暂停' : '▶ 播放';
    b.classList.toggle('primary', !trace.playing);
  }

  /* ============================ 播放器接线 ============================ */

  function wireTransport() {
    $('#btn-first').onclick = () => trace.first();
    $('#btn-prev').onclick = () => trace.prev();
    $('#btn-next').onclick = () => trace.next();
    $('#btn-last').onclick = () => trace.last();
    $('#btn-play').onclick = () => trace.toggle();
    $('#btn-run').onclick = run;
    $('#btn-reset').onclick = resetList;

    const slider = $('#speed');
    const applySpeed = () => {
      const v = parseInt(slider.value, 10);
      const sps = DS.Trace.sliderToSpeed(v);
      trace.setSpeed(sps);
      $('#speed-label').textContent = sps + ' 步/秒';
    };
    slider.addEventListener('input', applySpeed);
    slider.value = String(DS.Trace.speedToSlider(24));
    applySpeed();

    // 表单里回车 = 执行
    $('#op-form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
    $('#op-form').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); run(); }
    });

    trace.on('change', paint);
    trace.on('play', syncPlayBtn);

    DS.keys.bind({
      space: () => trace.toggle(),
      left: () => trace.prev(),
      right: () => trace.next(),
      home: () => trace.first(),
      end: () => trace.last(),
      esc: () => trace.pause()
    });

    // 窄屏「查看代码」抽屉
    const tg = $('#code-toggle');
    if (tg) {
      tg.onclick = () => {
        const open = $('#pseudo').classList.toggle('open');
        tg.textContent = open ? '收起代码' : '查看代码';
        tg.setAttribute('aria-expanded', String(open));
      };
    }

    // 窗口变宽变窄时重画一次（结点间距依赖容器宽度）
    let rt = 0;
    window.addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(paint, 160);
    });
  }

  /* ============================ 离线 ============================ */

  function markOffline() {
    booted = false;
    $('#canvas-wrap').innerHTML =
      '<div class="canvas-empty"><span class="mark" aria-hidden="true">!</span>' +
      '<span>后端未连接。' + MOD.title.replace('可视化', '') + '演示的轨迹由后端生成，' +
      '请在 backend 目录执行 <code>uvicorn main:app --port 8000</code> 后刷新。</span></div>';
    $('#btn-run').disabled = true;
    $('#btn-reset').disabled = true;
  }

  /* ============================ 启动 ============================ */

  /** 按当前模块改写页面标题、说明与导航高亮 */
  function applyModuleText() {
    const h1 = document.querySelector('.page-head h1');
    if (h1) h1.textContent = MOD.title;
    const lede = document.querySelector('.page-head .lede');
    if (lede) lede.textContent = MOD.lede;
    const bp = document.querySelector('.brand-page');
    if (bp) bp.textContent = MODKEY === 'list' ? '单链表' : (MODKEY === 'stack' ? '栈' : '队列');
    document.title = MOD.title + ' · 数据结构学习平台';
    DS.$$('[data-mod]').forEach((a) => {
      const on = a.dataset.mod === MODKEY;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }

  /* ============================ 注册表对账（P-004） ============================
     后端 GET /api/{mod}/ops 是「这个模块有哪些操作」的单一真相源。首屏拉一次，
     和本地 ops.js 的 OPS key 集合对账：漂移只在控制台 + toast 提示，绝不打断回放。
     对不上通常意味着有人在某一侧加了新操作却漏改另一侧——提示去补齐，而非硬失败。 */
  async function checkOpsRegistry() {
    const opsPath = MOD.api.replace(/\/trace$/, '') + '/ops';
    const r = await DS.api.get(opsPath, { timeout: DS.api.TIMEOUTS.state });
    if (!r.ok || !r.data || !Array.isArray(r.data.ops)) return;
    const serverKeys = r.data.ops.map((o) => o.key);
    const localKeys = OPS.map((o) => o.key);
    const onlyClient = localKeys.filter((k) => serverKeys.indexOf(k) === -1);
    const onlyServer = serverKeys.filter((k) => localKeys.indexOf(k) === -1);
    if (!onlyClient.length && !onlyServer.length) return;
    const parts = [];
    if (onlyClient.length) parts.push('前端多出：' + onlyClient.join('、'));
    if (onlyServer.length) parts.push('后端新增未接：' + onlyServer.join('、'));
    const msg = '操作清单与后端不一致（' + parts.join('；') + '），请同步 ops.js';
    DS.toast.warn(msg);
    if (window.console && console.warn) console.warn('[lectai] ' + msg);
  }

  /* 首屏：后端每个会话都以空容器起步（不在服务端预置初值，避免覆盖用户已改的状态），
     所以挂载时若当前为空，就显式载入本模块的默认演示序列，让画布一开始就有内容可看。 */
  async function bootDefaults() {
    const d = await fetchState();
    if (!d || d.length > 0) return;   // 非空：fetchState 已经画出当前状态
    const r = await DS.api.post(
      API + '/build',
      { values: DS.parseNums(DEFAULT_VALUES, MOD.max, MOD.unit) },
      { timeout: DS.api.TIMEOUTS.request }
    );
    if (r.ok) loadTrace(r.data, false);
    else if (r.offline) markOffline();
  }

  async function init() {
    trace = new DS.Trace();
    applyModuleText();
    buildTabs();
    buildLegend();
    selectOp(current);
    wireTransport();
    paint();

    $('#meta-sid').textContent = DS.api.sessionId().replace('web-', '');

    const b = await DS.api.probe();
    if (!b.online) {
      markOffline();
      return;
    }
    booted = true;
    bootDefaults();
    checkOpsRegistry();
  }

  // 同一页面内切换模块（顶部 tab 改 hash）：整页重载最简单可靠，
  // 因为每个模块的渲染器与操作元数据都要换一套。
  window.addEventListener('hashchange', () => {
    const k = (location.hash || '').replace('#', '') || 'list';
    if (k !== MODKEY && MODULES[k]) location.reload();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
