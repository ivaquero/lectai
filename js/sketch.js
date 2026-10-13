/* ==========================================================================
 * sketch.js —— p5.js 渲染层与交互
 *
 * 渲染完全不参与算法逻辑：它只读取 algorithms.js 生成的轨迹数组，
 * 按 state.cursor 找到当前步骤，把该步骤的数组快照与高亮信息画出来。
 * 因此「单步后退」只是把 cursor 减一，不需要任何逆操作。
 * ========================================================================== */
(function () {
  'use strict';

  const { ALGORITHMS, ORDER, buildTrace, randomPermutation } = window.SortLab;

  /* -------------------------------- 配色 -------------------------------- */
  const COLORS = {
    bg: '#ffffff',
    axis: '#dbe3ec',
    idle: '#94a3b8',
    inactive: '#dfe6ee',
    cmp: '#f59e0b',
    swap: '#ef4444',
    pivot: '#8b5cf6',
    sorted: '#22c55e',
    barText: '#31435a',
    bracket: '#2563eb',
    bracketText: '#2563eb',
    auxTrack: '#f4f8fc',
    aux: '#38bdf8',
    auxIdle: '#cfe6f7',
    auxCmp: '#f59e0b',
    auxText: '#31435a',
    ptrChip: '#1f2937',
    gapBg: '#eef4ff',
    gapText: '#2563eb',
    hover: '#0ea5e9',
    tooltipBg: '#1f2937',
    muted: '#8296ab',
  };

  /** 图例：与 COLORS 中同一套语义色 */
  const LEGEND = [
    ['idle', '未参与本次操作'],
    ['inactive', '活动区间之外'],
    ['cmp', '正在比较'],
    ['swap', '交换 / 写入'],
    ['pivot', '枢轴 / 当前最小值'],
    ['sorted', '已确定位置'],
    ['aux', '辅助数组 aux[]'],
  ];

  /* ------------------------------- 全局状态 ------------------------------ */
  const state = {
    values: [],
    algo: 'bubble',
    steps: [],
    cursor: 0,
    playing: false,
    speed: 24, // 每秒播放的步骤数
    acc: 0,
    scale: 1,
    hover: -1,
    dirty: true,
  };

  const SPEED_MIN = 1;
  const SPEED_MAX = 400;

  const dom = {};
  let pseudoLines = [];
  let p5instance = null;

  /* ============================ 工具函数 ============================ */
  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  /**
   * 解析用户输入：支持逗号、中文逗号、分号、空格、换行分隔。
   * 数值限定为 1–999 的整数，个数限定为 2–64。
   */
  function parseValues(text) {
    const parts = String(text).split(/[\s,，;；]+/).filter(Boolean);
    if (!parts.length) throw new Error('请输入数据');
    const out = [];
    for (const part of parts) {
      const v = Number(part);
      if (!Number.isFinite(v)) throw new Error('无法识别的数值：' + part);
      const iv = Math.round(v);
      if (iv < 1 || iv > 999) throw new Error('数值需在 1–999 之间：' + part);
      out.push(iv);
    }
    if (out.length < 2) throw new Error('至少需要 2 个数');
    if (out.length > 64) throw new Error('最多支持 64 个数（当前 ' + out.length + ' 个）');
    return out;
  }

  function sliderToSpeed(v) {
    const t = (v - 1) / 99;
    const sps = Math.round(Math.pow(10, t * Math.log10(SPEED_MAX)));
    return Math.max(SPEED_MIN, Math.min(SPEED_MAX, sps));
  }

  function speedToSlider(sps) {
    const t = Math.log10(sps) / Math.log10(SPEED_MAX);
    return Math.round(t * 99) + 1;
  }

  /** 近乎有序：升序后随机交换少量相邻元素 */
  function nearlySorted(n) {
    const a = [];
    for (let i = 1; i <= n; i++) a.push(i);
    const swaps = Math.max(1, Math.round(n * 0.08));
    for (let s = 0; s < swaps; s++) {
      const i = Math.floor(Math.random() * (n - 1));
      const tmp = a[i];
      a[i] = a[i + 1];
      a[i + 1] = tmp;
    }
    return a;
  }

  /* ============================ 轨迹与播放 ============================ */
  function rebuild() {
    setPlaying(false);
    let built;
    try {
      built = buildTrace(state.algo, state.values);
    } catch (err) {
      setHint(err.message, true);
      return;
    }
    state.steps = built.steps;
    state.cursor = 0;
    state.acc = 0;
    state.hover = -1;
    state.scale = Math.max.apply(null, state.values);
    state.dirty = true;
    setHint(
      state.values.length + ' 个数据 · 共 ' + state.steps.length + ' 个动画步骤 · ' +
        (state.algo === 'merge' ? '本算法会使用辅助数组 aux[]' : '无需额外数组'),
      false
    );
    renderDom();
    requestRedraw();
  }

  function loadValues(values) {
    state.values = values.slice();
    dom.input.value = values.join(', ');
    dom.size.value = String(Math.max(Number(dom.size.min), Math.min(Number(dom.size.max), values.length)));
    dom.sizeLabel.textContent = String(values.length);
    rebuild();
  }

  function setPlaying(on) {
    state.playing = !!on;
    if (state.playing) {
      state.acc = 0;
      if (p5instance && !p5instance.isLooping()) p5instance.loop();
    } else {
      requestRedraw();
    }
    dom.btnPlay.textContent = state.playing ? '⏸ 暂停' : '▶ 播放';
    dom.btnPlay.classList.toggle('playing', state.playing);
  }

  /** 暂停状态下让画布重绘一帧；播放状态下循环已经在跑，无需干预 */
  function requestRedraw() {
    if (p5instance && !state.playing) p5instance.redraw();
  }

  function setCursor(value, options) {
    const opts = options || {};
    if (opts.pause) setPlaying(false);
    const max = state.steps.length;
    const next = Math.max(0, Math.min(max, value));
    if (next !== state.cursor) state.dirty = true;
    state.cursor = next;
    state.acc = 0;
    requestRedraw();
  }

  function togglePlay() {
    if (!state.steps.length) return;
    if (!state.playing && state.cursor >= state.steps.length) state.cursor = 0;
    setPlaying(!state.playing);
  }

  function advance() {
    if (!state.playing) return;
    state.acc += (p5instance.deltaTime / 1000) * state.speed;
    let budget = Math.floor(state.acc);
    if (budget <= 0) return;
    state.acc -= budget;
    budget = Math.min(budget, 800); // 单帧上限，避免高倍速时长时间无响应
    const next = Math.min(state.cursor + budget, state.steps.length);
    if (next !== state.cursor) state.dirty = true;
    state.cursor = next;
    if (state.cursor >= state.steps.length) setPlaying(false);
  }

  /** 当前步骤；cursor 为 0 时返回「尚未开始」的合成视图 */
  function view() {
    if (state.cursor > 0) return state.steps[state.cursor - 1];
    return {
      line: null,
      lines: [],
      cmp: null,
      cmpAux: null,
      swap: null,
      pivot: null,
      range: null,
      gap: null,
      ptr: null,
      auxRange: null,
      array: state.values,
      aux: null,
      sorted: [],
      comparisons: 0,
      swaps: 0,
      writes: 0,
      info: '准备就绪：按「播放」自动演示，或用「上一步 / 下一步」逐帧观察。',
    };
  }

  /* ============================== DOM 渲染 ============================== */
  function setHint(text, isError) {
    dom.inputHint.textContent = text;
    dom.inputHint.classList.toggle('error', !!isError);
  }

  function buildTabs() {
    dom.tabs.innerHTML = '';
    for (const key of ORDER) {
      const def = ALGORITHMS[key];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'tab';
      btn.dataset.algo = key;
      btn.innerHTML = '<b>' + escapeHtml(def.name) + '</b><span>' + escapeHtml(def.brief) + '</span>';
      btn.addEventListener('click', () => selectAlgorithm(key));
      dom.tabs.appendChild(btn);
    }
    updateTabs();
  }

  function updateTabs() {
    for (const btn of dom.tabs.querySelectorAll('.tab')) {
      btn.classList.toggle('active', btn.dataset.algo === state.algo);
    }
  }

  function buildLegend() {
    dom.legend.innerHTML = LEGEND.map(
      (item) => '<span class="legend-item"><i style="background:' + COLORS[item[0]] + '"></i>' + escapeHtml(item[1]) + '</span>'
    ).join('');
  }

  function buildPseudo() {
    const def = ALGORITHMS[state.algo];
    const structural = new Set(def.structural || []);
    dom.pseudo.innerHTML = def.pseudo
      .map((text, i) => {
        const n = i + 1;
        const cls = ['pline'];
        if (structural.has(n)) cls.push('structural');
        if (!text.trim()) cls.push('blank');
        return (
          '<div class="' + cls.join(' ') + '"><span class="ln">' + n + '</span>' +
          '<span class="code">' + (text ? escapeHtml(text) : '&nbsp;') + '</span></div>'
        );
      })
      .join('');
    pseudoLines = Array.prototype.slice.call(dom.pseudo.querySelectorAll('.pline'));
  }

  function buildComplexity() {
    const meta = ALGORITHMS[state.algo].meta;
    const row = (label, value) =>
      '<span class="cx-row"><span class="cx-k">' + label + '</span><span class="cx-v">' + value + '</span></span>';
    dom.complexity.innerHTML =
      row('最好', escapeHtml(meta.best)) +
      row('平均', escapeHtml(meta.avg)) +
      row('最坏', escapeHtml(meta.worst)) +
      row('空间', escapeHtml(meta.space)) +
      row('方式', escapeHtml(meta.method)) +
      row('稳定性', meta.stable ? '<span class="badge ok">稳定</span>' : '<span class="badge warn">不稳定</span>');
  }

  function buildStats() {
    const chips = [
      ['比较次数', 'stat-cmp'],
      ['交换次数', 'stat-swap'],
      ['写入次数', 'stat-write'],
      ['动画进度', 'stat-step'],
    ];
    dom.stats.innerHTML = chips
      .map(
        (c) =>
          '<div class="chip"><span class="chip-label">' + c[0] + '</span><b class="chip-value mono" id="' + c[1] + '">0</b></div>'
      )
      .join('');
    dom.statCmp = $('stat-cmp');
    dom.statSwap = $('stat-swap');
    dom.statWrite = $('stat-write');
    dom.statStep = $('stat-step');
  }

  function renderDom() {
    const v = view();
    dom.statCmp.textContent = String(v.comparisons);
    dom.statSwap.textContent = String(v.swaps);
    dom.statWrite.textContent = String(v.writes);
    dom.statStep.textContent = state.cursor + ' / ' + state.steps.length;
    dom.info.textContent = v.info || '—';

    const active = new Set(v.lines || []);
    for (let i = 0; i < pseudoLines.length; i++) {
      pseudoLines[i].classList.toggle('active', active.has(i + 1));
    }
    // 只在当前行移出可视区时滚动，避免每一帧都抖动
    const first = pseudoLines.find((el) => el.classList.contains('active'));
    if (first && dom.pseudo.scrollHeight > dom.pseudo.clientHeight + 4) {
      const top = first.offsetTop;
      const bottom = top + first.offsetHeight;
      if (top < dom.pseudo.scrollTop + 4 || bottom > dom.pseudo.scrollTop + dom.pseudo.clientHeight - 4) {
        dom.pseudo.scrollTop = top - dom.pseudo.clientHeight / 2 + first.offsetHeight / 2;
      }
    }

    dom.btnPlay.textContent = state.playing ? '⏸ 暂停' : '▶ 播放';
    dom.btnPrev.disabled = state.cursor <= 0;
    dom.btnFirst.disabled = state.cursor <= 0;
    dom.btnNext.disabled = state.cursor >= state.steps.length;
    dom.btnLast.disabled = state.cursor >= state.steps.length;
  }

  /* ============================== 交互绑定 ============================== */
  function selectAlgorithm(key) {
    if (state.algo === key) return;
    state.algo = key;
    updateTabs();
    buildPseudo();
    buildComplexity();
    rebuild();
  }

  function applyInput() {
    let values;
    try {
      values = parseValues(dom.input.value);
    } catch (err) {
      setHint(err.message, true);
      return;
    }
    loadValues(values);
  }

  function randomize() {
    loadValues(randomPermutation(Number(dom.size.value)));
  }

  function bindEvents() {
    dom.btnPlay.addEventListener('click', togglePlay);
    dom.btnNext.addEventListener('click', () => setCursor(state.cursor + 1, { pause: true }));
    dom.btnPrev.addEventListener('click', () => setCursor(state.cursor - 1, { pause: true }));
    dom.btnFirst.addEventListener('click', () => setCursor(0, { pause: true }));
    dom.btnLast.addEventListener('click', () => setCursor(state.steps.length, { pause: true }));
    dom.btnReset.addEventListener('click', () => setCursor(0, { pause: true }));

    dom.btnApply.addEventListener('click', applyInput);
    dom.btnRandom.addEventListener('click', randomize);
    dom.btnAsc.addEventListener('click', () => {
      const n = Number(dom.size.value);
      const a = [];
      for (let i = 1; i <= n; i++) a.push(i);
      loadValues(a);
    });
    dom.btnDesc.addEventListener('click', () => {
      const n = Number(dom.size.value);
      const a = [];
      for (let i = n; i >= 1; i--) a.push(i);
      loadValues(a);
    });
    dom.btnNearly.addEventListener('click', () => loadValues(nearlySorted(Number(dom.size.value))));

    dom.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        applyInput();
      }
    });
    dom.input.addEventListener('input', () => setHint('回车或点「应用」生效：支持逗号、空格、换行分隔，2–64 个数', false));

    dom.size.addEventListener('input', () => {
      dom.sizeLabel.textContent = dom.size.value;
      randomize();
    });

    dom.speed.addEventListener('input', () => {
      state.speed = sliderToSpeed(Number(dom.speed.value));
      dom.speedLabel.textContent = state.speed + ' 步/秒';
    });

    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCursor(state.cursor + 1, { pause: true });
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCursor(state.cursor - 1, { pause: true });
      } else if (e.key === 'Home') {
        e.preventDefault();
        setCursor(0, { pause: true });
      } else if (e.key === 'End') {
        e.preventDefault();
        setCursor(state.steps.length, { pause: true });
      } else if (e.key === 'r' || e.key === 'R') {
        setCursor(0, { pause: true });
      } else if (e.key === 'n' || e.key === 'N') {
        randomize();
      }
    });
  }

  /* ============================== p5 渲染层 ============================= */
  function startSketch() {
    const sketch = (p) => {
      function fit() {
        const w = Math.max(320, dom.host.clientWidth);
        const h = Math.max(280, dom.host.clientHeight);
        p.resizeCanvas(w, h);
        state.dirty = true;
        requestRedraw();
      }

      p.setup = () => {
        p.createCanvas(dom.host.clientWidth || 720, dom.host.clientHeight || 440);
        p.pixelDensity(Math.min(2, window.devicePixelRatio || 1));
        p.noLoop();
        if (window.ResizeObserver) {
          new ResizeObserver(() => fit()).observe(dom.host);
        } else {
          window.addEventListener('resize', fit);
        }
      };

      function barX(i, L) {
        return L.padLeft + L.slot * (i + 0.5) - L.barW / 2;
      }

      function layout(n) {
        const W = p.width;
        const H = p.height;
        const padTop = 56;
        const padRight = 22;
        const padBottom = 54;
        const padLeft = 22;
        const showAux = state.algo === 'merge';
        const vgap = showAux ? 32 : 0;
        const avail = Math.max(80, H - padTop - padBottom - vgap);
        const mainH = showAux ? avail * 0.66 : avail;
        const auxH = showAux ? avail * 0.34 : 0;
        const plotW = Math.max(60, W - padLeft - padRight);
        const slot = plotW / n;
        const barW = Math.max(2, Math.min(slot * 0.76, 46));
        return {
          W: W,
          H: H,
          padTop: padTop,
          padRight: padRight,
          padBottom: padBottom,
          padLeft: padLeft,
          showAux: showAux,
          plotW: plotW,
          slot: slot,
          barW: barW,
          mainH: mainH,
          auxH: auxH,
          mainBase: padTop + mainH,
          auxTop: padTop + mainH + vgap,
          auxBase: padTop + mainH + vgap + auxH,
        };
      }

      function colorOf(v, i) {
        if (v.swap && (v.swap[0] === i || v.swap[1] === i)) return COLORS.swap;
        if (v.pivot === i) return COLORS.pivot;
        if (v.cmp && (v.cmp[0] === i || v.cmp[1] === i)) return COLORS.cmp;
        for (const s of v.sorted) if (s === i) return COLORS.sorted;
        if (v.range && (i < v.range[0] || i > v.range[1])) return COLORS.inactive;
        return COLORS.idle;
      }

      function chipWidth(label) {
        p.textSize(10);
        return p.textWidth(label) + 12;
      }

      function drawChipAt(x, cy, w, label, color) {
        const h = 16;
        p.noStroke();
        p.fill(color);
        p.rect(x, cy - h / 2, w, h, 4);
        p.fill('#ffffff');
        p.textSize(10);
        p.textAlign(p.CENTER, p.CENTER);
        p.text(label, x + w / 2, cy + 0.5);
      }

      /**
       * 指针标记。多个指针可能落在同一下标上（归并排序的 i / k 就经常重合），
       * 因此先按下标分组，再在同一行内横向排开，避免标签互相盖住。
       */
      function drawPtrs(v, L) {
        if (!v.ptr) return;
        const groups = new Map();
        for (const name in v.ptr) {
          const idx = v.ptr[name];
          if (idx === null || idx === undefined || idx < 0 || idx >= v.array.length) continue;
          if (!groups.has(idx)) groups.set(idx, []);
          groups.get(idx).push(name.toUpperCase());
        }
        const cy = L.mainBase + 34;
        for (const entry of groups) {
          const idx = entry[0];
          const names = entry[1].sort();
          const widths = names.map((n) => chipWidth(n));
          const gap = 3;
          const total = widths.reduce((a, b) => a + b, 0) + gap * (names.length - 1);
          let x = barX(idx, L) + L.barW / 2 - total / 2;
          for (let i = 0; i < names.length; i++) {
            drawChipAt(x, cy, widths[i], names[i], COLORS.ptrChip);
            x += widths[i] + gap;
          }
        }
      }

      function drawRange(v, L) {
        if (!v.range) return;
        const x0 = L.padLeft + L.slot * v.range[0];
        const x1 = L.padLeft + L.slot * (v.range[1] + 1);
        const y = 34;
        p.stroke(COLORS.bracket);
        p.strokeWeight(2);
        p.line(x0 + 3, y, x1 - 3, y);
        p.line(x0 + 3, y, x0 + 3, y + 7);
        p.line(x1 - 3, y, x1 - 3, y + 7);
        p.noStroke();
        p.fill(COLORS.bracketText);
        p.textSize(11);
        p.textAlign(p.LEFT, p.CENTER);
        p.text('range [' + v.range[0] + ', ' + v.range[1] + ']', x0 + 3, 22);
      }

      function drawBars(v, L) {
        const n = v.array.length;
        const showValue = L.barW >= 15 && L.slot >= 17;
        p.noStroke();
        for (let i = 0; i < n; i++) {
          const val = v.array[i];
          const h = Math.max(3, (val / state.scale) * L.mainH);
          const x = barX(i, L);
          const y = L.mainBase - h;
          p.fill(colorOf(v, i));
          p.rect(x, y, L.barW, h, Math.min(4, L.barW / 3));
          if (showValue) {
            p.fill(COLORS.barText);
            p.textAlign(p.CENTER, p.BOTTOM);
            p.textSize(Math.min(12, Math.max(9, L.barW * 0.58)));
            p.text(val, x + L.barW / 2, Math.min(y - 3, L.mainBase - h - 3));
          }
        }
        p.stroke(COLORS.axis);
        p.strokeWeight(1);
        p.line(L.padLeft, L.mainBase + 0.5, L.W - L.padRight, L.mainBase + 0.5);
      }

      function drawAxis(v, L) {
        const n = v.array.length;
        if (L.slot >= 16) {
          p.noStroke();
          p.fill(COLORS.muted);
          p.textAlign(p.CENTER, p.TOP);
          p.textSize(Math.min(11, Math.max(8, L.slot * 0.5)));
          for (let i = 0; i < n; i++) {
            p.text(i, barX(i, L) + L.barW / 2, L.mainBase + 6);
          }
        }
        drawPtrs(v, L);
      }

      function drawAux(v, L) {
        p.noStroke();
        p.fill(COLORS.auxTrack);
        p.rect(L.padLeft, L.auxTop, L.plotW, L.auxH, 6);
        p.fill(COLORS.muted);
        p.textSize(11);
        p.textAlign(p.RIGHT, p.BOTTOM);
        p.text('aux[]', L.W - L.padRight, L.auxTop - 5);

        if (!v.aux) return;
        const showValue = L.barW >= 14;
        for (let i = 0; i < v.aux.length; i++) {
          const val = v.aux[i];
          if (val === null || val === undefined) continue;
          const inRange = !v.auxRange || (i >= v.auxRange[0] && i <= v.auxRange[1]);
          const isCmp = v.cmpAux && (v.cmpAux[0] === i || v.cmpAux[1] === i);
          const h = Math.max(3, (val / state.scale) * L.auxH * 0.84);
          const x = barX(i, L);
          const y = L.auxBase - h;
          p.noStroke();
          p.fill(isCmp ? COLORS.auxCmp : inRange ? COLORS.aux : COLORS.auxIdle);
          p.rect(x, y, L.barW, h, Math.min(3, L.barW / 3));
          if (showValue) {
            p.fill(COLORS.auxText);
            p.textAlign(p.CENTER, p.BOTTOM);
            p.textSize(Math.min(11, Math.max(8, L.barW * 0.52)));
            p.text(val, x + L.barW / 2, y - 2);
          }
        }
      }

      function drawGapBadge(gap) {
        const txt = 'gap = ' + gap;
        p.textSize(12);
        const w = p.textWidth(txt) + 18;
        p.noStroke();
        p.fill(COLORS.gapBg);
        p.rect(p.width - 22 - w, 12, w, 24, 6);
        p.fill(COLORS.gapText);
        p.textAlign(p.CENTER, p.CENTER);
        p.text(txt, p.width - 22 - w / 2, 24.5);
      }

      function drawHover(v, L) {
        if (state.hover < 0 || state.hover >= v.array.length) return;
        const x = barX(state.hover, L);
        p.noFill();
        p.stroke(COLORS.hover);
        p.strokeWeight(1.5);
        p.rect(x - 1, L.padTop - 8, L.barW + 2, L.mainH + 16, 4);
        const txt = 'a[' + state.hover + '] = ' + v.array[state.hover];
        p.textSize(11);
        const w = p.textWidth(txt) + 16;
        const tx = Math.min(p.mouseX + 14, L.W - w - 6);
        const ty = Math.max(6, p.mouseY - 30);
        p.noStroke();
        p.fill(COLORS.tooltipBg);
        p.rect(tx, ty, w, 22, 5);
        p.fill('#ffffff');
        p.textAlign(p.CENTER, p.CENTER);
        p.text(txt, tx + w / 2, ty + 11.5);
      }

      p.draw = () => {
        advance();
        p.background(COLORS.bg);
        const v = view();
        const L = layout(v.array.length);

        drawRange(v, L);
        drawBars(v, L);
        if (L.showAux) drawAux(v, L);
        drawAxis(v, L);
        if (v.gap !== null) drawGapBadge(v.gap);
        drawHover(v, L);

        if (state.dirty) {
          state.dirty = false;
          renderDom();
        }
        // 暂停时停止循环，任何状态变化都由 requestRedraw() 触发单帧重绘
        if (!state.playing) p.noLoop();
      };

      p.mouseMoved = () => {
        const v = view();
        const L = layout(v.array.length);
        const x = p.mouseX - L.padLeft;
        const idx = Math.floor(x / L.slot);
        const inside = p.mouseY >= 0 && p.mouseY <= p.height;
        const next = inside && idx >= 0 && idx < v.array.length ? idx : -1;
        if (next !== state.hover) {
          state.hover = next;
          p.redraw();
        }
      };

      p.mouseOut = () => {
        if (state.hover !== -1) {
          state.hover = -1;
          p.redraw();
        }
      };
    };

    p5instance = new p5(sketch, dom.host);
    dom.host.classList.add('ready');
    p5instance.redraw();
  }

  /* ================================ 启动 ================================ */

  /** 显式列出 DOM 键名 → 元素 id，避免驼峰转换带来的隐式耦合 */
  const DOM_IDS = {
    host: 'canvas-host',
    tabs: 'algo-tabs',
    legend: 'legend',
    info: 'info',
    pseudo: 'pseudo',
    complexity: 'complexity',
    stats: 'stats',
    input: 'input',
    inputHint: 'input-hint',
    size: 'size',
    sizeLabel: 'size-label',
    speed: 'speed',
    speedLabel: 'speed-label',
    btnPlay: 'btn-play',
    btnNext: 'btn-next',
    btnPrev: 'btn-prev',
    btnFirst: 'btn-first',
    btnLast: 'btn-last',
    btnReset: 'btn-reset',
    btnApply: 'btn-apply',
    btnRandom: 'btn-random',
    btnAsc: 'btn-asc',
    btnDesc: 'btn-desc',
    btnNearly: 'btn-nearly',
  };

  function init() {
    for (const name in DOM_IDS) {
      const el = $(DOM_IDS[name]);
      if (!el) throw new Error('页面缺少元素 #' + DOM_IDS[name]);
      dom[name] = el;
    }

    buildTabs();
    buildLegend();
    buildPseudo();
    buildComplexity();
    buildStats();
    bindEvents();

    state.speed = sliderToSpeed(Number(dom.speed.value));
    dom.speedLabel.textContent = state.speed + ' 步/秒';
    dom.size.value = '24';
    dom.sizeLabel.textContent = '24';

    state.values = randomPermutation(24);
    dom.input.value = state.values.join(', ');
    rebuild();

    startSketch();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
