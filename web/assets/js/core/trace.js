/* ==========================================================================
   core/trace.js —— 轨迹播放器
   --------------------------------------------------------------------------
   模板的核心思想：算法（在后端）先生成整条轨迹，这里只负责移动游标。
   播放 / 暂停 / 单步 / 回退 / 跳转都不需要逆操作。
   ========================================================================== */
(function () {
  'use strict';

  const DS = (window.DS = window.DS || {});

  class Trace {
    constructor() {
      this.meta = null;      // 后端返回体：{op,title,code,length,trace,...}
      this.steps = [];
      this.cursor = 0;       // 0 = 尚未开始；n = 已执行到第 n 步
      this.playing = false;
      this.speed = 24;       // 步/秒
      this._acc = 0;
      this._last = 0;
      this._raf = 0;
      this._subs = [];
    }

    load(meta) {
      this.pause();
      this.meta = meta || null;
      this.steps = (meta && meta.trace) || [];
      this.cursor = 0;
      this._acc = 0;
      this._emit('load');
      this._emit('change');
    }

    get total() { return this.steps.length; }

    get isEmpty() { return !this.steps.length; }

    /** cursor=0 时返回「尚未开始」的合成视图 */
    get current() {
      if (this.cursor > 0) return this.steps[this.cursor - 1];
      const first = this.steps[0];
      if (!first) return null;
      // 链表用 nodes、栈 / 队列用 items，这里都要照顾到
      const list = first.nodes || first.items || [];
      return {
        seq: -1,
        nodes: first.nodes,
        items: first.items,
        aside: [],
        head: list.length ? list[0].id : null,
        ptr: list.length ? { head: list[0].id } : {},
        mark: { compare: [], visited: [], new: [], remove: [] },
        line: null,
        counters: { visited: 0, moves: 0, compares: 0 },
        info: '准备就绪'
      };
    }

    on(event, fn) {
      this._subs.push({ event, fn });
      return () => this.off(event, fn);
    }

    off(event, fn) {
      this._subs = this._subs.filter((s) => !(s.event === event && s.fn === fn));
    }

    _emit(event) {
      this._subs.forEach((s) => { if (s.event === event) s.fn(this); });
    }

    /* ---------------------------- 游标移动 ---------------------------- */

    seek(i, opts) {
      const next = Math.max(0, Math.min(this.total, i));
      const jumped = next !== this.cursor;
      this.cursor = next;
      this._acc = 0;
      if (jumped || (opts && opts.force)) this._emit('change');
      return next;
    }

    next() { return this.seek(this.cursor + 1, { force: true }); }

    prev() { return this.seek(this.cursor - 1, { force: true }); }

    first() { return this.seek(0, { force: true }); }

    last() { return this.seek(this.total, { force: true }); }

    reset() {
      this.pause();
      this.first();
    }

    /* ------------------------------ 播放 ------------------------------ */

    play() {
      if (this.isEmpty || this.playing) return;
      if (this.cursor >= this.total) this.cursor = 0;
      this.playing = true;
      this._acc = 0;
      this._last = performance.now();
      const tick = (ts) => {
        if (!this.playing) return;
        const dt = ts - this._last;
        this._last = ts;
        this._acc += (dt / 1000) * this.speed;
        let budget = Math.floor(this._acc);
        if (budget > 0) {
          this._acc -= budget;
          budget = Math.min(budget, 400); // 单帧上限，防止高倍速卡顿
          this.cursor = Math.min(this.cursor + budget, this.total);
          this._emit('change');
          if (this.cursor >= this.total) { this.pause(); return; }
        }
        this._raf = requestAnimationFrame(tick);
      };
      this._raf = requestAnimationFrame(tick);
      this._emit('play');
    }

    pause() {
      if (!this.playing) return;
      this.playing = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      this._emit('play');
    }

    toggle() {
      if (this.playing) this.pause();
      else this.play();
    }

    setSpeed(sps) {
      this.speed = Math.max(1, Math.min(400, sps | 0));
      this._emit('speed');
    }
  }

  /** 滑杆值(1-100) ↔ 步/秒(1-400) 对数换算（与模板一致） */
  Trace.sliderToSpeed = function (v) {
    const t = (v - 1) / 99;
    return Math.max(1, Math.min(400, Math.round(Math.pow(10, t * Math.log10(400)))));
  };

  Trace.speedToSlider = function (sps) {
    const t = Math.log10(Math.max(1, sps)) / Math.log10(400);
    return Math.round(t * 99) + 1;
  };

  DS.Trace = Trace;
})();
