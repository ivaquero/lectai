/* ==========================================================================
   pages/visual/render.js —— 栈（竖式）与队列（横排）的 SVG 渲染
   --------------------------------------------------------------------------
   与 pages/list/render.js 同构：输入一步快照，输出一屏 SVG，不含任何算法。
   栈：底部是栈底、顶部是栈顶，top 指针画在右侧。
   队列：左端是队头、右端是队尾，front / rear 指针画在上方。
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;
  const esc = DS.esc;

  const NW = 64;    // 格子宽
  const NH = 38;    // 格子高
  const GAP = 8;    // 间距
  const PAD = 16;

  function stateOf(id, mark) {
    if (!mark) return '';
    if ((mark.remove || []).indexOf(id) >= 0) return 'rm';
    if ((mark.new || []).indexOf(id) >= 0) return 'new';
    if ((mark.compare || []).indexOf(id) >= 0) return 'cmp';
    if ((mark.visited || []).indexOf(id) >= 0) return 'vis';
    return '';
  }

  function rect(x, y, cls, value, tag) {
    const s = [];
    s.push('<g class="nd ' + cls + '">');
    s.push('<rect class="nd-box" x="' + x + '" y="' + y +
      '" width="' + NW + '" height="' + NH + '" rx="7"/>');
    if (cls === 'rm') {
      s.push('<line class="nd-slash" x1="' + (x + 4) + '" y1="' + (y + NH - 4) +
        '" x2="' + (x + NW - 4) + '" y2="' + (y + 4) + '"/>');
    }
    s.push('<text class="nd-val" x="' + (x + NW / 2) + '" y="' + (y + NH / 2 + 5) + '">' +
      esc(value) + '</text>');
    if (tag) {
      s.push('<text class="nd-tag" x="' + (x + NW / 2) + '" y="' + (y + NH + 13) + '">' +
        esc(tag) + '</text>');
    }
    s.push('</g>');
    return s.join('');
  }

  /** 指针：标签 + 短杆，指向某个格子的一侧 */
  function pointer(label, tx, ty, from, cls) {
    const s = [];
    s.push('<text class="ptr-tag' + (cls ? ' ' + cls : '') + '" x="' + tx +
      '" y="' + ty + '">' + esc(label) + '</text>');
    s.push('<path class="ptr-stem' + (cls ? ' ' + cls : '') + '" d="M' + tx +
      ' ' + (ty + 3) + ' L' + tx + ' ' + (from > ty ? from : from) + '"/>');
    return s.join('');
  }

  /* ============================== 栈 ============================== */

  function drawStack(host, step, o) {
    o = o || {};
    const items = step.items || step.nodes || [];
    const aside = step.aside || [];
    const mark = step.mark || {};
    const ptr = step.ptr || {};

    const avail = (host.clientWidth || 720) - PAD * 2;
    const rows = Math.max(items.length, 1);
    const baseY = PAD + rows * (NH + GAP) + 6;      // 栈底基线
    const height = baseY + 34;
    const stackX = 34;

    const s = [];
    s.push('<svg class="ll-svg" width="' + Math.max(avail, 420) + '" height="' + height +
      '" viewBox="0 0 ' + Math.max(avail, 420) + ' ' + height + '" role="img" ' +
      'aria-label="栈：' + (items.length ? items.map((i) => i.value).join(' → ') : '空') +
      '（左为栈底、上为栈顶）' + esc(step.info || '') + '">' +
      '<title>栈（自顶向下）：' +
      (items.length ? items.slice().reverse().map((i) => i.value).join(' → ') : '空栈') +
      '</title>');

    /* 栈底基线 */
    s.push('<line class="link" x1="' + (stackX - 8) + '" y1="' + (baseY + 4) +
      '" x2="' + (stackX + NW + 8) + '" y2="' + (baseY + 4) + '"/>');
    s.push('<text class="nd-tag" x="' + (stackX + NW / 2) + '" y="' + (baseY + 22) +
      '">栈底 base</text>');

    /* 元素：数组下标 0 在底部 */
    items.forEach((it, i) => {
      const y = baseY - (i + 1) * (NH + GAP) + 4;
      const cls = stateOf(it.id, mark);
      s.push(rect(stackX, y, cls, it.value, it.label));
    });

    /* top 指针：指向栈顶（最上面那个） */
    if (items.length) {
      const topY = baseY - items.length * (NH + GAP) + 4 - 6;
      const tx = stackX + NW + 22;
      s.push('<text class="ptr-tag head" x="' + tx + '" y="' + (topY - 2) + '">top</text>');
      s.push('<path class="ptr-stem head" d="M' + tx + ' ' + (topY + 3) + ' L' + tx +
        ' ' + (topY + NH / 2) + '"/>');
      s.push('<path class="ptr-stem head" d="M' + tx + ' ' + (topY + NH / 2) +
        ' L' + (stackX + NW + 2) + ' ' + (topY + NH / 2) + '"/>');
    } else {
      s.push('<text class="nd-tag" x="' + (stackX + NW + 22) + '" y="' + (baseY - 6) +
        '">top = -1（空栈）</text>');
    }

    /* 暂离元素：待入栈的 x / 已弹出的 x */
    aside.forEach((it) => {
      const x = stackX + NW + 78;
      const y = PAD + 10;
      s.push('<rect class="aside-box hot" x="' + x + '" y="' + y +
        '" width="' + NW + '" height="' + NH + '" rx="7"/>');
      s.push('<text class="nd-val" x="' + (x + NW / 2) + '" y="' + (y + NH / 2 + 5) + '">' +
        esc(it.value) + '</text>');
      s.push('<text class="ptr-tag" x="' + (x + NW / 2) + '" y="' + (y - 6) + '">x</text>');
    });

    s.push('</svg>');
    host.innerHTML = s.join('');
  }

  /* ============================== 队列 ============================== */

  function drawQueue(host, step, o) {
    o = o || {};
    const items = step.items || step.nodes || [];
    const aside = step.aside || [];
    const mark = step.mark || {};
    const ptr = step.ptr || {};
    const ring = step.ring || {};

    const avail = (host.clientWidth || 720) - PAD * 2;
    const cols = Math.max(items.length + 1, 4);        // 末尾留一个空槽给 rear
    const width = Math.max(avail, PAD * 2 + cols * (NW + GAP));
    const y0 = 46;
    const height = y0 + NH + 56;

    const s = [];
    s.push('<svg class="ll-svg" width="' + width + '" height="' + height +
      '" viewBox="0 0 ' + width + ' ' + height + '" role="img" ' +
      'aria-label="队列：' + (items.length ? items.map((i) => i.value).join(' → ') : '空') +
      '（左为队头）' + esc(step.info || '') + '">' +
      '<title>队列（队头 → 队尾）：' +
      (items.length ? items.map((i) => i.value).join(' → ') : '空队') + '</title>');

    /* 队头 / 队尾 说明 */
    s.push('<text class="nd-tag" x="' + PAD + '" y="16">队头 front（只出不进）◀</text>');

    /* 元素 */
    items.forEach((it, i) => {
      const x = PAD + i * (NW + GAP);
      const cls = stateOf(it.id, mark);
      s.push(rect(x, y0, cls, it.value, it.label));
    });

    /* rear 写入位置：队尾右侧的空槽（虚线） */
    const slotX = PAD + items.length * (NW + GAP);
    s.push('<rect class="aside-box" x="' + slotX + '" y="' + y0 +
      '" width="' + NW + '" height="' + NH + '" rx="7"/>');
    s.push('<text class="nd-tag" x="' + (slotX + NW / 2) + '" y="' + (y0 + NH / 2 + 4) +
      '">下一入队位</text>');

    /* front / rear 指针 */
    if (items.length) {
      const fx = PAD + NW / 2;
      s.push('<text class="ptr-tag head" x="' + fx + '" y="' + (y0 - 20) + '">front</text>');
      s.push('<path class="ptr-stem head" d="M' + fx + ' ' + (y0 - 17) + ' L' + fx +
        ' ' + (y0 - 4) + '"/>');
      const rx = slotX + NW / 2;
      s.push('<text class="ptr-tag" x="' + rx + '" y="' + (y0 - 20) + '">rear</text>');
      s.push('<path class="ptr-stem" d="M' + rx + ' ' + (y0 - 17) + ' L' + rx + ' ' + (y0 - 4) + '"/>');
    } else {
      s.push('<text class="nd-tag" x="' + PAD + '" y="' + (y0 + NH / 2 + 4) +
        '">空队：front == rear</text>');
    }

    /* 底部容量条 */
    const cap = ring.capacity || 10;
    const used = items.length;
    s.push('<text class="nd-tag" x="' + PAD + '" y="' + (y0 + NH + 26) + '">' +
      '已用 ' + used + ' / 可放 ' + (cap - 1) + '（数组容量 ' + cap + '，牺牲一个单元区分空满）</text>');

    /* 暂离元素 */
    aside.forEach((it) => {
      const x = PAD + (items.length + 2) * (NW + GAP);
      const y = y0;
      s.push('<rect class="aside-box hot" x="' + x + '" y="' + y +
        '" width="' + NW + '" height="' + NH + '" rx="7"/>');
      s.push('<text class="nd-val" x="' + (x + NW / 2) + '" y="' + (y + NH / 2 + 5) + '">' +
        esc(it.value) + '</text>');
      s.push('<text class="ptr-tag" x="' + (x + NW / 2) + '" y="' + (y - 8) + '">x</text>');
    });

    s.push('</svg>');
    host.innerHTML = s.join('');
  }

  DS.stackRender = { draw: drawStack, stateOf: stateOf };
  DS.queueRender = { draw: drawQueue, stateOf: stateOf };
})();
