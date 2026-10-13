/* ==========================================================================
 * algorithms.js —— 排序算法「轨迹生成器」
 *
 * 设计思路：把每个排序算法写成生成器函数，算法每执行一个「有教学意义的动作」
 * 就 yield 一个步骤描述对象。调用方（sketch.js 或 Node 测试脚本）把整条轨迹
 * 收集成数组后，就可以任意地播放、暂停、单步前进 / 后退、跳到末尾 ——
 * 渲染层完全不需要理解算法本身。
 *
 * 每个步骤对象的字段：
 *   line        需要高亮的伪代码行号（1 开始）；可以是数组，表示一步对应多行
 *   lines       规范化后的行号数组
 *   array       该步骤结束后整个数组的快照
 *   cmp         正在比较的两个下标 [i, j]
 *   cmpAux      正在比较的两个辅助数组下标 [i, j]（归并排序）
 *   swap        正在交换的两个下标 [i, j]
 *   pivot       枢轴 / 当前最小值下标
 *   range       当前活动区间 [lo, hi]，闭区间
 *   gap         当前增量（希尔排序）
 *   ptr         指针标记，形如 { i: 3, j: 7, k: 5 }
 *   auxRange    辅助数组的显示区间 [lo, hi]
 *   aux         辅助数组快照（归并排序）
 *   sorted      已经确定最终位置的下标数组
 *   comparisons 累计比较次数
 *   swaps       累计交换次数
 *   writes      累计写入次数
 *   info        中文说明，直接显示在页面上
 *
 * 关于「暂存洞」：插入类（希尔排序）与归并排序在移动元素时，会把待移动的值
 * 先暂存起来（temp 或 aux[]），因此中间有几帧主数组里会出现重复值 —— 这是
 * 这两种算法实现方式本身的固有性质，不是缺陷。页面用 temp 指针标记和辅助
 * 数组行把它显示出来。
 * ========================================================================== */
(function (global) {
  'use strict';

  /** 单次运行允许的最大步骤数，防止异常输入把页面卡死 */
  const MAX_STEPS = 300000;

  /* ----------------------------------------------------------------------
   * 复杂度与稳定性元数据
   * 冒泡 / 选择 / 快速 / 归并 的数值取自 data/algo-sort.csv，保持一致。
   * 希尔排序不在该 CSV 中，此处按教科书常见取值补充（步长取 n/2 折半序列）。
   * -------------------------------------------------------------------- */
  const META = {
    bubble: { best: 'O(n)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)', method: '交换', stable: true },
    selection: { best: 'O(n²)', avg: 'O(n²)', worst: 'O(n²)', space: 'O(1)', method: '选择', stable: false },
    quick: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n²)', space: 'O(log n)', method: '分治', stable: false },
    merge: { best: 'O(n log n)', avg: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)', method: '分治', stable: true },
    shell: { best: 'O(n log n)', avg: '≈O(n^1.3)', worst: 'O(n²)', space: 'O(1)', method: '插入', stable: false },
  };

  /* ======================================================================
   * Tracer —— 轨迹记录器
   * 算法只调用这里的方法，所有计数与快照都在此处统一完成。
   * ==================================================================== */
  class Tracer {
    constructor(input) {
      this.n = input.length;
      this.a = input.slice();
      this.steps = [];
      this.comparisons = 0;
      this.swaps = 0;
      this.writes = 0;
      this.sorted = new Set();
      this.aux = null;
      // 「粘性」显示状态：算法赋值一次，之后每个步骤都会带上，直到再次修改
      this.range = null;
      this.gap = null;
      this.pivot = null;
      this.ptr = null;
      this.auxRange = null;
    }

    /** 记录一个步骤。opts 中出现的字段会覆盖粘性状态（仅作用于本步骤） */
    push(step) {
      if (this.steps.length >= MAX_STEPS) {
        throw new Error('排序步骤超过上限（' + MAX_STEPS + '），请减少数据规模');
      }
      if (step.mark) {
        for (const i of step.mark) this.sorted.add(i);
      }
      const lines = normalizeLines(step.line);
      const pick = (name, fallback) => (step[name] === undefined ? fallback : step[name]);
      const snapshot = {
        line: lines.length ? lines[0] : null,
        lines: lines,
        cmp: pick('cmp', null),
        cmpAux: pick('cmpAux', null),
        swap: pick('swap', null),
        pivot: pick('pivot', this.pivot),
        range: pick('range', this.range),
        gap: pick('gap', this.gap),
        ptr: step.ptr === undefined ? this.ptr : step.ptr,
        auxRange: pick('auxRange', this.auxRange),
        array: this.a.slice(),
        aux: this.aux ? this.aux.slice() : null,
        sorted: Array.from(this.sorted),
        comparisons: this.comparisons,
        swaps: this.swaps,
        writes: this.writes,
        info: step.info || '',
      };
      snapshot.ptr = snapshot.ptr ? Object.assign({}, snapshot.ptr) : null;
      this.steps.push(snapshot);
      return snapshot;
    }

    /** 一次比较：计数 + 高亮 */
    cmp(i, j, line, opts) {
      this.comparisons++;
      return this.push(Object.assign({ line: line, cmp: [i, j] }, opts));
    }

    /** 辅助数组中的一次比较（归并排序） */
    cmpAux(i, j, line, opts) {
      this.comparisons++;
      return this.push(Object.assign({ line: line, cmpAux: [i, j] }, opts));
    }

    /** 交换两个元素 */
    swap(i, j, line, opts) {
      const tmp = this.a[i];
      this.a[i] = this.a[j];
      this.a[j] = tmp;
      this.swaps++;
      this.writes += 2;
      return this.push(Object.assign({ line: line, swap: [i, j] }, opts));
    }

    /** 写入单个位置（不交换） */
    set(i, v, line, opts) {
      if (this.a[i] !== v) this.writes++;
      this.a[i] = v;
      return this.push(Object.assign({ line: line }, opts));
    }

    /** 只高亮 / 只说明，不改变数据 */
    note(line, opts) {
      return this.push(Object.assign({ line: line }, opts));
    }

    /** 全部就位，收尾 */
    finish(line, opts) {
      this.range = null;
      this.pivot = null;
      this.ptr = null;
      this.gap = null;
      this.auxRange = null;
      for (let i = 0; i < this.n; i++) this.sorted.add(i);
      return this.push(Object.assign({ line: line === undefined ? null : line, info: '排序完成' }, opts));
    }
  }

  /** 把 line 参数规范成数组，顺便校验行号 */
  function normalizeLines(value) {
    if (value === null || value === undefined || value === false) return [];
    const list = Array.isArray(value) ? value.slice() : [value];
    const out = [];
    for (const n of list) {
      if (!Number.isInteger(n) || n < 1) throw new Error('非法的伪代码行号：' + n);
      if (!out.includes(n)) out.push(n);
    }
    return out.sort((x, y) => x - y);
  }

  /* ======================================================================
   * 一、冒泡排序
   * ==================================================================== */
  function* bubbleSort(t) {
    const n = t.n;
    for (let i = 0; i < n - 1; i++) {
      let swapped = false;
      t.range = [0, n - 1 - i];
      t.pivot = null;
      yield t.note(2, { info: '第 ' + (i + 1) + ' 轮开始，先假定本轮没有发生交换' });
      for (let j = 0; j < n - 1 - i; j++) {
        yield t.cmp(j, j + 1, 4, {
          info: '比较 a[' + j + ']=' + t.a[j] + ' 与 a[' + (j + 1) + ']=' + t.a[j + 1],
        });
        if (t.a[j] > t.a[j + 1]) {
          yield t.swap(j, j + 1, [5, 6], { info: '左边较大，交换后把标记置为 true' });
          swapped = true;
        }
      }
      if (!swapped) {
        const rest = [];
        for (let k = 0; k <= n - 1 - i; k++) rest.push(k);
        yield t.note(7, { mark: rest, range: null, info: '本轮没有发生交换，剩余部分已经有序，提前结束' });
        break;
      }
      yield t.note(8, { mark: [n - 1 - i], info: '本轮最大值冒泡到 a[' + (n - 1 - i) + ']，已归位' });
    }
    yield t.finish(null, { info: '排序完成：每一轮都把当前最大值冒泡到未排序区间的末尾' });
  }

  /* ======================================================================
   * 二、选择排序
   * ==================================================================== */
  function* selectionSort(t) {
    const n = t.n;
    for (let i = 0; i < n - 1; i++) {
      let minIdx = i;
      t.range = [i, n - 1];
      yield t.note(2, { pivot: i, info: '第 ' + (i + 1) + ' 轮：先假定 a[' + i + '] 是未排序区间的最小值' });
      for (let j = i + 1; j < n; j++) {
        yield t.cmp(minIdx, j, 4, {
          pivot: minIdx,
          info: '比较当前最小 a[' + minIdx + ']=' + t.a[minIdx] + ' 与 a[' + j + ']=' + t.a[j],
        });
        if (t.a[j] < t.a[minIdx]) {
          minIdx = j;
          yield t.note(5, { pivot: minIdx, info: '发现更小的 ' + t.a[j] + '，更新 minIdx = ' + j });
        }
      }
      t.pivot = null;
      if (minIdx !== i) {
        yield t.swap(i, minIdx, 6, {
          info: '把最小值 a[' + minIdx + ']=' + t.a[minIdx] + ' 交换到位置 ' + i,
        });
      }
      yield t.note(7, { mark: [i], info: 'a[' + i + '] 已归位，未排序区间缩短为 [' + (i + 1) + ', ' + (n - 1) + ']' });
    }
    yield t.finish(null, { info: '排序完成：每一轮从未排序区间中选出最小值放到区间头部' });
  }

  /* ======================================================================
   * 三、快速排序（Lomuto 分区，取区间末尾元素为枢轴）
   * ==================================================================== */
  function* quickSort(t) {
    yield* qsort(t, 0, t.n - 1);
    yield t.finish(null, { info: '排序完成：所有子区间都收缩到长度不超过 1' });
  }

  function* qsort(t, lo, hi) {
    if (lo > hi) return;
    if (lo === hi) {
      yield t.note(2, { mark: [lo], range: [lo, hi], info: '子区间只剩下 a[' + lo + ']，天然有序，直接返回' });
      return;
    }
    t.range = [lo, hi];
    t.pivot = hi;
    yield t.note([3, 8, 9], {
      info: '递归处理子区间 [' + lo + ', ' + hi + ']：选取枢轴 pivot = a[' + hi + '] = ' + t.a[hi],
    });

    let i = lo - 1;
    for (let j = lo; j < hi; j++) {
      yield t.cmp(j, hi, 11, {
        ptr: { i: i >= lo ? i : null, j: j },
        info: '比较 a[' + j + ']=' + t.a[j] + ' 与枢轴 ' + t.a[hi],
      });
      if (t.a[j] <= t.a[hi]) {
        i++;
        if (i !== j) {
          yield t.swap(i, j, [12, 13], { ptr: { i: i, j: j }, info: '不大于枢轴，i 自增后换到左区 a[' + i + ']' });
        }
      }
    }
    if (i + 1 !== hi) {
      yield t.swap(i + 1, hi, 14, { info: '把枢轴交换到分界位置 a[' + (i + 1) + ']' });
    }
    t.pivot = null;
    yield t.note(15, {
      mark: [i + 1],
      range: [lo, hi],
      info: 'a[' + (i + 1) + '] 已确定最终位置，返回 p = ' + (i + 1) + '，继续递归左右两个子区间',
    });
    yield* qsort(t, lo, i);
    yield* qsort(t, i + 2, hi);
  }

  /* ======================================================================
   * 四、归并排序（自顶向下，使用辅助数组 aux[]）
   * ==================================================================== */
  function* mergeSort(t) {
    t.aux = new Array(t.n).fill(null);
    yield* msort(t, 0, t.n - 1);
    yield t.finish(null, { info: '排序完成：所有相邻有序区间自底向上两两合并完毕' });
  }

  function* msort(t, lo, hi) {
    if (lo > hi) return;
    t.range = [lo, hi];
    if (lo === hi) {
      yield t.note(2, { range: null, info: '区间 [' + lo + ', ' + hi + '] 长度不足 2，无需排序，直接返回' });
      return;
    }
    const mid = (lo + hi) >> 1;
    yield t.note(3, {
      info: '拆分区间 [' + lo + ', ' + hi + '] → [' + lo + ', ' + mid + '] 与 [' + (mid + 1) + ', ' + hi + ']',
    });
    yield* msort(t, lo, mid);
    yield* msort(t, mid + 1, hi);

    // 先把待合并区间整体复制到辅助数组。后续比较都基于 aux[]，
    // 这样即使 a[] 中的位置被写坏，读到的仍是本轮开始时的原始值。
    const buf = t.a.slice(lo, hi + 1);
    for (let x = 0; x < buf.length; x++) t.aux[lo + x] = buf[x];
    t.auxRange = [lo, hi];
    t.range = [lo, hi];
    yield t.note([9, 10], { info: '把 a[' + lo + '..' + hi + '] 复制到辅助数组 aux[]，并令 i=' + lo + '、j=' + (mid + 1) + '、k=' + lo });

    let i = lo;
    let j = mid + 1;
    let k = lo;
    while (i <= mid && j <= hi) {
      yield t.cmpAux(i, j, 12, {
        ptr: { i: i, j: j, k: k },
        info: '比较 aux[' + i + ']=' + buf[i - lo] + ' 与 aux[' + j + ']=' + buf[j - lo],
      });
      if (buf[i - lo] <= buf[j - lo]) {
        yield t.set(k, buf[i - lo], 13, { ptr: { i: i, j: j, k: k }, info: '左半的 ' + buf[i - lo] + ' 较小，写回 a[' + k + ']' });
        i++;
      } else {
        yield t.set(k, buf[j - lo], 15, { ptr: { i: i, j: j, k: k }, info: '右半的 ' + buf[j - lo] + ' 较小，写回 a[' + k + ']' });
        j++;
      }
      k++;
    }
    while (i <= mid) {
      yield t.set(k, buf[i - lo], 16, { ptr: { i: i, j: j, k: k }, info: '左半仍有剩余 ' + buf[i - lo] + '，直接写回 a[' + k + ']' });
      i++;
      k++;
    }
    while (j <= hi) {
      yield t.set(k, buf[j - lo], 16, { ptr: { i: i, j: j, k: k }, info: '右半仍有剩余 ' + buf[j - lo] + '，直接写回 a[' + k + ']' });
      j++;
      k++;
    }
    t.ptr = null;
    t.auxRange = null;
    for (let x = lo; x <= hi; x++) t.aux[x] = null;
  }

  /* ======================================================================
   * 五、希尔排序（增量 n/2、n/4 … 折半，组内做插入排序）
   * ==================================================================== */
  function* shellSort(t) {
    const n = t.n;
    let gap = Math.floor(n / 2);
    let round = 0;
    t.range = null;
    while (gap > 0) {
      t.gap = gap;
      yield t.note(round === 0 ? [1, 2] : [2, 9], {
        info: '本轮增量 gap = ' + gap + '，把相隔 ' + gap + ' 的元素视为同一组，组内做插入排序',
      });
      for (let i = gap; i < n; i++) {
        const temp = t.a[i];
        let j = i;
        yield t.note(4, { ptr: { i: i, j: j }, info: '取出 a[' + i + '] = ' + temp + ' 暂存到 temp，位置 ' + i + ' 空出' });
        while (j >= gap) {
          yield t.cmp(j - gap, j, 5, {
            ptr: { i: i, j: j },
            info: '比较 a[' + (j - gap) + ']=' + t.a[j - gap] + ' 与暂存值 temp = ' + temp,
          });
          if (t.a[j - gap] > temp) {
            yield t.set(j, t.a[j - gap], [6, 7], { ptr: { i: i, j: j }, info: '比 temp 大的元素后移到 a[' + j + ']，空位前移 ' + gap });
            j -= gap;
          } else {
            break;
          }
        }
        if (j !== i) {
          yield t.set(j, temp, 8, { ptr: { i: i, j: j }, info: '把 temp = ' + temp + ' 插入到空位 a[' + j + ']' });
        }
        t.ptr = null;
      }
      gap = Math.floor(gap / 2);
      round++;
    }
    yield t.finish(null, { info: '排序完成：gap 降到 0，最后一次 gap = 1 相当于整体插入排序收尾' });
  }

  /* ======================================================================
   * 算法注册表
   * pseudo     伪代码，每行一条，行号即数组下标 + 1
   * structural 仅作结构性说明、不单独高亮的行号（函数签名、循环头、空行等）
   * ==================================================================== */
  const ALGORITHMS = {
    bubble: {
      key: 'bubble',
      name: '冒泡排序',
      brief: '相邻两两比较，大的往后冒',
      meta: META.bubble,
      pseudo: [
        'for i ← 0 to n - 2 do',
        '    swapped ← false',
        '    for j ← 0 to n - 2 - i do',
        '        if a[j] > a[j + 1] then',
        '            swap(a[j], a[j + 1])',
        '            swapped ← true',
        '    if not swapped then break    // 本轮无交换，提前结束',
        '    mark a[n - 1 - i] as sorted',
      ],
      structural: [1, 3],
      run: bubbleSort,
    },
    selection: {
      key: 'selection',
      name: '选择排序',
      brief: '每轮选出最小值放到区间头部',
      meta: META.selection,
      pseudo: [
        'for i ← 0 to n - 2 do',
        '    minIdx ← i',
        '    for j ← i + 1 to n - 1 do',
        '        if a[j] < a[minIdx] then',
        '            minIdx ← j',
        '    if minIdx ≠ i then swap(a[i], a[minIdx])',
        '    mark a[i] as sorted',
      ],
      structural: [1, 3],
      run: selectionSort,
    },
    quick: {
      key: 'quick',
      name: '快速排序',
      brief: '选枢轴分区，再递归两侧',
      meta: META.quick,
      pseudo: [
        'quickSort(lo, hi):',
        '    if lo ≥ hi then return',
        '    p ← partition(lo, hi)',
        '    quickSort(lo, p - 1)',
        '    quickSort(p + 1, hi)',
        '',
        'partition(lo, hi):                    // Lomuto 分区',
        '    pivot ← a[hi]',
        '    i ← lo - 1',
        '    for j ← lo to hi - 1 do',
        '        if a[j] ≤ pivot then',
        '            i ← i + 1',
        '            swap(a[i], a[j])',
        '    swap(a[i + 1], a[hi])             // 枢轴归位',
        '    return i + 1',
      ],
      structural: [1, 4, 5, 6, 7, 10],
      run: quickSort,
    },
    merge: {
      key: 'merge',
      name: '归并排序',
      brief: '先拆分到底，再两两合并',
      meta: META.merge,
      pseudo: [
        'mergeSort(lo, hi):',
        '    if lo ≥ hi then return',
        '    mid ← ⌊(lo + hi) / 2⌋',
        '    mergeSort(lo, mid)',
        '    mergeSort(mid + 1, hi)',
        '    merge(lo, mid, hi)',
        '',
        'merge(lo, mid, hi):',
        '    copy a[lo..hi] into aux[]',
        '    i ← lo, j ← mid + 1, k ← lo',
        '    while i ≤ mid and j ≤ hi do',
        '        if aux[i] ≤ aux[j] then',
        '            a[k] ← aux[i]; i ← i + 1',
        '        else',
        '            a[k] ← aux[j]; j ← j + 1',
        '    copy the rest of aux[] into a[]',
      ],
      structural: [1, 4, 5, 6, 7, 8, 11, 14],
      run: mergeSort,
    },
    shell: {
      key: 'shell',
      name: '希尔排序',
      brief: '按增量分组，组内插入排序',
      meta: META.shell,
      pseudo: [
        'gap ← ⌊n / 2⌋',
        'while gap > 0 do',
        '    for i ← gap to n - 1 do',
        '        temp ← a[i], j ← i',
        '        while j ≥ gap and a[j - gap] > temp do',
        '            a[j] ← a[j - gap]',
        '            j ← j - gap',
        '        a[j] ← temp',
        '    gap ← ⌊gap / 2⌋',
      ],
      structural: [3],
      run: shellSort,
    },
  };

  /** 按注册顺序返回算法列表，供页面生成按钮 */
  const ORDER = ['bubble', 'selection', 'quick', 'merge', 'shell'];

  /**
   * 生成完整轨迹。
   * @param {string} key 算法键名
   * @param {number[]} values 输入数据
   * @returns {{steps: object[], result: number[], metrics: object, input: number[]}}
   */
  function buildTrace(key, values) {
    const def = ALGORITHMS[key];
    if (!def) throw new Error('未知算法：' + key);
    // 单个元素天然有序，各算法都能正常收尾；页面层另有限制（至少 2 个）
    if (!values || values.length < 1) throw new Error('输入数据为空');

    const t = new Tracer(values);
    const gen = def.run(t);
    while (true) {
      const r = gen.next();
      if (r.done) break;
    }
    return {
      input: values.slice(),
      steps: t.steps,
      result: t.a.slice(),
      metrics: { comparisons: t.comparisons, swaps: t.swaps, writes: t.writes },
    };
  }

  /** 生成 1..n 的一个随机排列，保证每根柱子高度互不相同，视觉更清晰 */
  function randomPermutation(n) {
    const a = [];
    for (let i = 1; i <= n; i++) a.push(i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  const api = {
    Tracer: Tracer,
    ALGORITHMS: ALGORITHMS,
    ORDER: ORDER,
    META: META,
    buildTrace: buildTrace,
    randomPermutation: randomPermutation,
  };

  global.SortLab = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
