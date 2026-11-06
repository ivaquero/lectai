/* ==========================================================================
   pages/visual/ops.js —— 栈 / 队列的操作元数据
   --------------------------------------------------------------------------
   与 pages/list/ops.js 同构：加一项就多一个标签页，不用改 HTML。
   path 直接写绝对接口地址，body 负责把表单值转成请求体。
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;

  function parseNums(text, max) {
    const out = [];
    String(text || '')
      .split(/[,，\s]+/)
      .forEach((t) => {
        if (!t) return;
        const v = parseInt(t, 10);
        if (!isNaN(v)) out.push(v);
      });
    if (max && out.length > max) {
      out.length = max;
      DS.toast.warn('最多 ' + max + ' 个元素，多余部分已忽略');
    }
    return out;
  }

  /* ------------------------------- 栈 ------------------------------- */

  const STACK_OPS = [
    {
      key: 'build',
      tab: '建栈',
      sub: '重建整个栈',
      desc:
        '从 <em>S.top = -1</em> 开始，逐个把元素压入。' +
        '顺序栈用数组存放，<em>top</em> 只是指向当前栈顶的下标。',
      fields: [
        { name: 'values', label: '初始序列', type: 'text', value: '5,3,8', ph: '5,3,8（右端为栈顶）' }
      ],
      path: '/api/stack/trace/build',
      body: (f) => ({ values: parseNums(f.values, 10) }),
      cx: [['入栈', 'O(1)'], ['出栈', 'O(1)'], ['关键', 'top 指针']],
      tips: [
        '判空 <code>S.top == -1</code>，判满 <code>S.top == MaxSize - 1</code>。',
        '入栈是 <code>S.data[++S.top] = x</code>：先加一再写入；出栈是 <code>x = S.data[S.top--]</code>：先取出再减一。',
        '出栈时元素其实还在数组里，只是 top 下移了——这叫"假删除"，下次入栈会覆盖它。'
      ]
    },
    {
      key: 'push',
      tab: '入栈',
      sub: 'O(1)',
      desc:
        '把 <em>x</em> 放到 top 的上一格：指针先上移，再写入。' +
        '顺序反了就会写到旧栈顶上，把原来的值覆盖掉。',
      fields: [{ name: 'value', label: '数值', type: 'number', value: '7', ph: '整数' }],
      path: '/api/stack/trace/push',
      body: (f) => ({ value: parseInt(f.value, 10) }),
      cx: [['时间', 'O(1)'], ['空间', 'O(1)'], ['关键', '先移指针']],
      tips: [
        '顺序是铁律：<code>S.top++;</code> 再 <code>S.data[S.top] = x;</code>。',
        '入栈前必须判满，否则会越界写入。',
        '栈顶永远是最后入栈的元素，这就是 LIFO。'
      ]
    },
    {
      key: 'pop',
      tab: '出栈',
      sub: 'O(1)',
      desc:
        '取走栈顶：先读 <em>S.data[S.top]</em>，再把 top 减一。' +
        '读与减的顺序反了，就会跳过真正的栈顶。',
      fields: [],
      path: '/api/stack/trace/pop',
      body: () => ({}),
      cx: [['时间', 'O(1)'], ['空间', 'O(1)'], ['关键', '先取值']],
      tips: [
        '出栈前必须判空：<code>S.top == -1</code> 时取元素是未定义行为。',
        '顺序：<code>x = S.data[S.top];</code> 再 <code>S.top--;</code>。',
        '出栈返回的必然是最近一次入栈的元素——可用这一点判断出栈序列是否合法。'
      ]
    },
    {
      key: 'peek',
      tab: '读栈顶',
      sub: '不改栈',
      desc: '只读 <em>S.data[S.top]</em>，指针不动。常用于"看一眼再决定要不要出栈"。',
      fields: [],
      path: '/api/stack/trace/peek',
      body: () => ({}),
      cx: [['时间', 'O(1)'], ['空间', 'O(1)'], ['关键', '只读']],
      tips: [
        'peek 与 pop 的差别只有一句 <code>S.top--</code>。',
        '括号匹配、表达式求值里的"看一眼栈顶"用的都是 peek。'
      ]
    },
    {
      key: 'traverse',
      tab: '遍历',
      sub: '顶 → 底',
      desc: '从栈顶往栈底依次访问。注意输出顺序与入栈顺序<em>相反</em>。',
      fields: [],
      path: '/api/stack/trace/traverse',
      body: () => ({}),
      cx: [['时间', 'O(n)'], ['空间', 'O(1)'], ['顺序', '栈底 ← 栈顶']],
      tips: [
        '遍历不会改变栈内容（这里没有出栈动作）。',
        '栈的输出序列是入栈序列的逆序，这是判断合法出栈序列的依据。'
      ]
    }
  ];

  /* ------------------------------- 队列 ------------------------------- */

  const QUEUE_OPS = [
    {
      key: 'build',
      tab: '建队',
      sub: '重建整个队列',
      desc:
        '从 <em>front = rear = 0</em> 开始逐个入队。' +
        '循环队列把数组首尾相接，用<em>牺牲一个单元</em>的办法区分空与满。',
      fields: [
        { name: 'values', label: '初始序列', type: 'text', value: '5,3,8', ph: '5,3,8（左端为队头）' }
      ],
      path: '/api/queue/trace/build',
      body: (f) => ({ values: parseNums(f.values, 9) }),
      cx: [['入队', 'O(1)'], ['出队', 'O(1)'], ['关键', '取模成环']],
      tips: [
        '判空 <code>front == rear</code>，判满 <code>(rear + 1) % MaxSize == front</code>。',
        '牺牲一个单元意味着容量 m 的数组最多放 m-1 个元素。',
        '求长度要写 <code>(rear - front + MaxSize) % MaxSize</code>，别忘了 +MaxSize。'
      ]
    },
    {
      key: 'enqueue',
      tab: '入队',
      sub: 'O(1)',
      desc: '写入 <em>rear</em> 指向的位置，然后 rear 后移一格（取模，走到末尾会绕回开头）。',
      fields: [{ name: 'value', label: '数值', type: 'number', value: '7', ph: '整数' }],
      path: '/api/queue/trace/enqueue',
      body: (f) => ({ value: parseInt(f.value, 10) }),
      cx: [['时间', 'O(1)'], ['空间', 'O(1)'], ['关键', '队尾插入']],
      tips: [
        '队列只允许在队尾插入，这是它与双端队列的区别。',
        'rear 的移动必须取模：<code>rear = (rear + 1) % MaxSize</code>。',
        '入队前判满——队满与队空的 front/rear 关系不同，靠牺牲的单元区分。'
      ]
    },
    {
      key: 'dequeue',
      tab: '出队',
      sub: 'O(1)',
      desc: '取走 <em>front</em> 指向的元素，然后 front 后移一格（同样取模）。',
      fields: [],
      path: '/api/queue/trace/dequeue',
      body: () => ({}),
      cx: [['时间', 'O(1)'], ['空间', 'O(1)'], ['关键', '队头删除']],
      tips: [
        '出队前判空：<code>front == rear</code> 时队列里没有元素。',
        '出队返回的必然是最早入队的元素——这就是 FIFO。',
        'front 后移后，原来的位置成为"废弃单元"，后续入队到那里才会被覆盖。'
      ]
    },
    {
      key: 'peek',
      tab: '读队头',
      sub: '不改队',
      desc: '只读 <em>Q.data[Q.front]</em>，指针不动。',
      fields: [],
      path: '/api/queue/trace/peek',
      body: () => ({}),
      cx: [['时间', 'O(1)'], ['空间', 'O(1)'], ['关键', '只读']],
      tips: [
        'peek 与 dequeue 只差一句 <code>front = (front + 1) % MaxSize</code>。',
        'BFS 里"取出队头看一下"就是 peek + dequeue 的组合。'
      ]
    },
    {
      key: 'traverse',
      tab: '遍历',
      sub: '头 → 尾',
      desc: '从队头到队尾依次访问，输出顺序与入队顺序<em>一致</em>。',
      fields: [],
      path: '/api/queue/trace/traverse',
      body: () => ({}),
      cx: [['时间', 'O(n)'], ['空间', 'O(1)'], ['顺序', '与入队相同']],
      tips: [
        '遍历用 <code>i = (i + 1) % MaxSize</code> 依次前进，直到 i == rear。',
        '队列保持原顺序，栈则相反——这是二者最直观的区别。'
      ]
    }
  ];

  /* ---------------------------- 共用的图例 ---------------------------- */

  const SEQ_LEGEND = [
    ['var(--node-new)', '本次新建 / 待入'],
    ['var(--node-compare)', '正在操作'],
    ['var(--node-remove)', '待删除 / 已摘下'],
    ['var(--node-visited)', '已访问'],
    ['var(--node-ptr)', '指针所指']
  ];

  DS.stackOps = STACK_OPS;
  DS.queueOps = QUEUE_OPS;
  DS.seqLegend = SEQ_LEGEND;
  DS.visualParseNums = parseNums;
})();
