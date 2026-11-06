/* ==========================================================================
   pages/list/render.js —— 单链表 SVG 渲染
   --------------------------------------------------------------------------
   输入是后端轨迹里的一个「步骤快照」，输出一段 SVG。
   渲染层不做任何算法判断：颜色来自 step.mark，指针来自 step.ptr。

   步骤快照形状（见 backend/algo/linkedlist_trace.py: Tracer.push）
     nodes  [{id, value, label}]   主链，从头到尾
     aside  [{id, value, label}]   暂离主链的结点（新建的 s、被摘下的 q）
     head   主链头结点 id | null
     ptr    {名字: 结点id | "NULL" | null}
     mark   {compare/visited/new/remove: [结点id]}
     line   高亮代码行
     info   中文解说
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;
  const esc = DS.esc;

  /* ------------------------------ 版式常量 ------------------------------ */
  const PADX = 16;          // 左右留白
  const ROW1 = 44;          // 主链矩形顶边
  const NH = 46;            // 结点高
  const ALBL = ROW1 + NH + 15;   // 位序标签基线 a1 a2 …
  const ROW2_PTR = 134;     // 暂离结点的指针标签基线
  const ROW2 = 154;         // 暂离结点矩形顶边
  const MAX_PITCH = 84;     // 稀疏时的步距
  const MIN_PITCH = 60;     // 拥挤时的步距
  const TERM_W = 34;        // 末端 ∅ 占位
  const NULL_W = 88;        // 右侧 "p=NULL" 标签预留宽度

  /* ------------------------------ 小工具 -------------------------------- */

  function has(list, id) {
    return !!list && list.indexOf(id) >= 0;
  }

  /** 结点配色优先级：删除 > 新建 > 比较 > 已访问 */
  function stateOf(id, mark) {
    if (has(mark.remove, id)) return 'rm';
    if (has(mark.new, id)) return 'new';
    if (has(mark.compare, id)) return 'cmp';
    if (has(mark.visited, id)) return 'vis';
    return '';
  }

  /** 主链与暂离区各自的 x 坐标 */
  function planX(nodes, aside, avail) {
    const n = nodes.length;
    let pitch = MAX_PITCH;
    let nw = 58;
    let gap = MAX_PITCH - 58;

    if (n > 1) {
      const budget = avail - PADX * 2 - TERM_W;
      pitch = Math.floor(budget / n);
      if (pitch > MAX_PITCH) pitch = MAX_PITCH;
      if (pitch < MIN_PITCH) pitch = MIN_PITCH;
      nw = Math.max(34, pitch - 24);
      gap = pitch - nw;
    }

    const xs = [];
    for (let i = 0; i < n; i++) xs.push(PADX + i * pitch);

    let contentW;
    if (n === 0) contentW = PADX * 2 + TERM_W;
    else contentW = PADX * 2 + (n - 1) * pitch + nw + gap + TERM_W;

    // 暂离结点紧挨主链起点下方排布
    const axs = [];
    for (let j = 0; j < aside.length; j++) axs.push(PADX + j * (nw + gap));

    return { xs: xs, axs: axs, nw: nw, gap: gap, pitch: pitch, contentW: contentW };
  }

  /* ------------------------------ 绘制 ---------------------------------- */

  /**
   * @param {HTMLElement} host 画布容器
   * @param {Object} step      步骤快照
   * @param {Object} opt       {prevIds:Set<string>} 上一步的结点集合，用于入场动画
   */
  function draw(host, step, opt) {
    const o = opt || {};
    if (!host) return;

    if (!step) {
      host.innerHTML =
        '<div class="canvas-empty"><span class="mark" aria-hidden="true">∅</span>' +
        '<span>执行任意操作后这里会出现结点</span></div>';
      return;
    }

    const nodes = step.nodes || [];
    const aside = step.aside || [];
    const mark = step.mark || {};
    const ptr = step.ptr || {};
    const n = nodes.length;

    const avail = Math.max(280, (host.clientWidth || 720) - 14);
    const g = planX(nodes, aside, avail);

    // 指针按目标分组：指向主链 / 指向暂离区 / 显式 NULL
    const toMain = [];   // {name, idx}
    const toAside = [];  // {name, idx}
    const toNull = [];   // {name}
    const idxOf = {};
    nodes.forEach((nd, i) => { idxOf[nd.id] = i; });
    const aidxOf = {};
    aside.forEach((nd, j) => { aidxOf[nd.id] = j; });

    Object.keys(ptr).forEach((name) => {
      const v = ptr[name];
      if (v === null || v === undefined) return;      // 指针已清除，不画
      if (v === 'NULL') { toNull.push({ name: name }); return; }
      if (v in idxOf) toMain.push({ name: name, idx: idxOf[v] });
      else if (v in aidxOf) toAside.push({ name: name, idx: aidxOf[v] });
    });

    // 同一目标上叠放多个指针时错开高度
    const stack = {};
    function level(key) {
      stack[key] = (stack[key] || 0);
      const l = stack[key];
      stack[key]++;
      return l;
    }

    const nullsOn = toNull.length > 0;
    const width = Math.max(avail, g.contentW + (nullsOn ? NULL_W : 0));
    const height = aside.length ? ROW2 + NH + 26 : ALBL + 12;
    const termX = n === 0 ? PADX + 4 : g.xs[n - 1] + g.nw + g.gap + 10;

    const s = [];
    const desc = '单链表：' + (n === 0 ? '空表' : nodes.map((nd) => nd.value).join(' → ')) +
      ' → NULL。' + (step.info || '');

    s.push(
      '<svg class="ll-svg" width="' + width + '" height="' + height + '" ' +
      'viewBox="0 0 ' + width + ' ' + height + '" role="img" ' +
      'aria-label="' + esc(desc) + '">' +
      '<title>' + esc(desc) + '</title>'
    );

    /* ---- 连线：主链 ---- */
    if (n > 0) {
      s.push('<g fill="none">');
      for (let i = 0; i < n - 1; i++) {
        const x1 = g.xs[i] + g.nw;
        const x2 = g.xs[i + 1];
        s.push('<path class="link" d="M' + x1 + ' ' + (ROW1 + NH / 2) +
          ' L' + (x2 - 2) + ' ' + (ROW1 + NH / 2) + '" marker-end="url(#ll-arr)"/>');
      }
      s.push('<path class="link" d="M' + (g.xs[n - 1] + g.nw) + ' ' + (ROW1 + NH / 2) +
        ' L' + (termX - 8) + ' ' + (ROW1 + NH / 2) + '" marker-end="url(#ll-arr)"/>');
      s.push('</g>');
    }

    /* ---- 末端 ∅ ---- */
    s.push('<text class="term" x="' + (termX + 4) + '" y="' + (ROW1 + NH / 2 + 5) + '">∅</text>');

    /* ---- 主链结点 ---- */
    s.push('<defs><marker id="ll-arr" viewBox="0 0 10 10" refX="8" refY="5" ' +
      'markerWidth="6" markerHeight="6" orient="auto-start-reverse">' +
      '<path d="M2 1L8 5L2 9" fill="none" stroke="currentColor" stroke-width="1.7" ' +
      'stroke-linecap="round" stroke-linejoin="round"/></marker></defs>');

    nodes.forEach((nd, i) => {
      const x = g.xs[i];
      const st = stateOf(nd.id, mark);
      const fresh = o.prevIds && !o.prevIds.has(nd.id) && has(mark.new, nd.id);
      s.push('<g class="nd ' + st + (fresh ? ' pop' : '') + '">');
      s.push('<rect class="nd-box" x="' + x + '" y="' + ROW1 + '" width="' + g.nw +
        '" height="' + NH + '" rx="7"/>');
      s.push('<text class="nd-val" x="' + (x + g.nw / 2) + '" y="' + (ROW1 + NH / 2 + 5) + '">' +
        esc(nd.value) + '</text>');
      if (nd.label) {
        s.push('<text class="nd-tag" x="' + (x + g.nw / 2) + '" y="' + ALBL + '">' +
          esc(nd.label) + '</text>');
      }
      // 高亮不只靠颜色：待删除结点加斜线，色盲用户也能分辨
      if (st === 'rm') {
        s.push('<line class="nd-slash" x1="' + (x + 4) + '" y1="' + (ROW1 + NH - 4) +
          '" x2="' + (x + g.nw - 4) + '" y2="' + (ROW1 + 4) + '"/>');
      }
      s.push('</g>');
    });

    /* ---- 指向主链的指针 ---- */
    toMain.forEach((p) => {
      const lv = level('m' + p.idx);
      const cx = g.xs[p.idx] + g.nw / 2;
      const ty = ROW1 - 8 - lv * 13;
      const ly = ty - 6;
      s.push('<text class="ptr-tag' + (p.name === 'head' ? ' head' : '') + '" x="' + cx +
        '" y="' + ly + '">' + esc(p.name) + '</text>');
      s.push('<path class="ptr-stem' + (p.name === 'head' ? ' head' : '') + '" d="M' + cx +
        ' ' + (ly + 3) + ' L' + cx + ' ' + ty + '"/>');
    });

    /* ---- 指向 NULL 的指针：标签放在 ∅ 右侧 ---- */
    toNull.forEach((p, i) => {
      s.push('<text class="ptr-null" x="' + (termX + 16) + '" y="' + (ROW1 + 8 + i * 14) + '">' +
        esc(p.name) + ' = NULL</text>');
    });

    /* ---- 暂离结点（s / q） ---- */
    aside.forEach((nd, j) => {
      const x = g.axs[j];
      const owners = toAside.filter((p) => p.idx === j).map((p) => p.name);
      const hot = owners.length > 0;
      s.push('<g class="nd">');
      s.push('<rect class="aside-box' + (hot ? ' hot' : '') + '" x="' + x + '" y="' + ROW2 +
        '" width="' + g.nw + '" height="' + NH + '" rx="7"/>');
      s.push('<text class="nd-val" x="' + (x + g.nw / 2) + '" y="' + (ROW2 + NH / 2 + 5) + '">' +
        esc(nd.value) + '</text>');
      s.push('<text class="nd-tag" x="' + (x + g.nw / 2) + '" y="' + (ROW2 + NH + 16) + '">' +
        esc(owners.join('/') || '游离') + '</text>');
      s.push('</g>');
      owners.forEach((nm, k) => {
        const cx = x + g.nw / 2;
        const ly = ROW2_PTR + (k % 2) * 13;
        s.push('<text class="ptr-tag" x="' + cx + '" y="' + ly + '">' + esc(nm) + '</text>');
        s.push('<path class="ptr-stem" d="M' + cx + ' ' + (ly + 3) + ' L' + cx +
          ' ' + (ROW2 - 6) + '"/>');
      });
    });

    /* ---- 空表提示 ---- */
    if (n === 0 && aside.length === 0) {
      s.push('<text class="nd-tag" x="' + (termX + 4) + '" y="' + (ROW1 + NH / 2 + 26) +
        '">空表</text>');
    }

    s.push('</svg>');

    host.innerHTML = s.join('');
  }

  DS.listRender = { draw: draw, stateOf: stateOf };
})();
