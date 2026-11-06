/* ==========================================================================
   pages/list/ops.js —— 七个操作的元数据
   --------------------------------------------------------------------------
   新增一个操作只需要在这里加一项：标签页、参数表单、代码面板、复杂度、
   易错点全部由后端 OPS 表或本表驱动，不用改 HTML。
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;

  /** 把 "3,1,4" / "3 1 4" 解析成整数数组 */
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
      DS.toast.warn('最多 ' + max + ' 个结点，多余部分已忽略');
    }
    return out;
  }

  const OPS = [
    {
      key: 'build',
      tab: '尾插建表',
      sub: '重建整条链',
      desc:
        '从 <em>head = NULL</em> 开始，每读入一个值就 malloc 一个新结点 s，' +
        '再挂到当前尾结点后面。空表时第一个结点要单独处理。',
      fields: [
        { name: 'values', label: '初始序列', type: 'text', value: '3,1,4,1,5', ph: '3,1,4,1,5' }
      ],
      path: '/api/linkedlist/trace/build',
      body: (f) => ({ values: parseNums(f.values, 12) }),
      cx: [['时间', 'O(n)'], ['空间', 'O(1)'], ['关键', 'tail 指针']],
      tips: [
        '建表前 <code>head</code> 必须是 NULL，否则会接到一条脏链上。',
        '新结点一定要写 <code>s->next = NULL</code>，否则末尾会指向随机地址。',
        '空表插入第一个结点时，<code>head = s</code> 与 <code>tail = s</code> 都要做。'
      ]
    },
    {
      key: 'insert-head',
      tab: '头插',
      sub: 'O(1)',
      desc:
        '新结点 <em>s</em> 先接住原来的头，再让 head 指回 s。' +
        '两步顺序不能反——先改 head 就再也找不到原链表了。',
      fields: [{ name: 'value', label: '数值', type: 'number', value: '7', ph: '整数' }],
      path: '/api/linkedlist/trace/insert-head',
      body: (f) => ({ value: parseInt(f.value, 10) }),
      cx: [['时间', 'O(1)'], ['空间', 'O(1)'], ['关键', '先接后改']],
      tips: [
        '顺序是铁律：<code>s->next = head;</code> 再 <code>head = s;</code>。',
        '头插不需要找尾，所以是 O(1)，也是逆转链表的基础操作。',
        '空表头插同样成立：<code>s->next = NULL</code>，<code>head = s</code>。'
      ]
    },
    {
      key: 'insert-tail',
      tab: '尾插',
      sub: 'O(n)',
      desc:
        '必须先从 head 走到 <em>p->next == NULL</em> 的那个结点，再把 s 接上去。' +
        '没有 tail 指针时，这一步逃不掉 O(n)。',
      fields: [{ name: 'value', label: '数值', type: 'number', value: '9', ph: '整数' }],
      path: '/api/linkedlist/trace/insert-tail',
      body: (f) => ({ value: parseInt(f.value, 10) }),
      cx: [['时间', 'O(n)'], ['空间', 'O(1)'], ['关键', '找尾结点']],
      tips: [
        '循环条件是 <code>p->next != NULL</code>，不是 <code>p != NULL</code>，否则会走过头。',
        '空表要单独判断：<code>if (head == NULL) { head = s; return; }</code>。',
        '带尾指针的链表可以把这里降到 O(1)，代价是删除时要维护 tail。'
      ]
    },
    {
      key: 'delete-pos',
      tab: '按位删除',
      sub: 'O(n)',
      desc:
        '删除第 <em>pos</em> 个结点，实际要找到它的<em>前驱</em>。' +
        '用 q 记住被删结点，先接链再 free。',
      fields: [{ name: 'pos', label: '位序', type: 'number', value: '3', ph: '从 1 开始', min: 1 }],
      path: '/api/linkedlist/trace/delete-pos',
      body: (f) => ({ pos: parseInt(f.pos, 10) }),
      cx: [['时间', 'O(n)'], ['空间', 'O(1)'], ['关键', '找前驱']],
      tips: [
        '删第一个结点要单独处理：<code>head = head->next</code>，没有前驱可找。',
        '顺序：<code>q = p->next; p->next = q->next; free(q);</code> 先接后断。',
        '位序从 1 开始，<code>pos > n</code> 或 <code>pos < 1</code> 都要报错。'
      ]
    },
    {
      key: 'delete-value',
      tab: '按值删除',
      sub: 'prev + p',
      desc:
        '双指针 <em>prev</em> 和 <em>p</em> 一起走：p 找值，prev 跟在后面。' +
        'prev 为 NULL 说明要删的是头结点。',
      fields: [{ name: 'value', label: '数值', type: 'number', value: '1', ph: '整数' }],
      path: '/api/linkedlist/trace/delete-value',
      body: (f) => ({ value: parseInt(f.value, 10) }),
      cx: [['时间', 'O(n)'], ['空间', 'O(1)'], ['关键', 'prev 判空']],
      tips: [
        '<code>prev == NULL</code> 等价于「删头结点」，此时改 head 而不是 prev->next。',
        '循环条件是 <code>p != NULL && p->data != x</code>，两个条件顺序别写反。',
        '只删第一个匹配值；要删全部就得在外层再套一层循环。'
      ]
    },
    {
      key: 'search',
      tab: '按值查找',
      sub: '返回位序',
      desc:
        '从 head 顺着 next 往下比，命中就返回当前位序，走到底返回 -1。' +
        '注意这里是<em>顺序存取</em>，不能像数组那样下标直达。',
      fields: [{ name: 'value', label: '数值', type: 'number', value: '4', ph: '整数' }],
      path: '/api/linkedlist/trace/search',
      body: (f) => ({ value: parseInt(f.value, 10) }),
      cx: [['时间', 'O(n)'], ['空间', 'O(1)'], ['关键', 'p != NULL']],
      tips: [
        '查找不修改链表，所以不需要 prev，一个 p 就够。',
        '返回值是<em>位序</em>（从 1 开始），不是下标；混用会差一。',
        '循环里 <code>pos++</code> 要和 <code>p = p->next</code> 同步，否则错位。'
      ]
    },
    {
      key: 'traverse',
      tab: '遍历',
      sub: 'visit 每个',
      desc:
        '最朴素的 <em>while (p != NULL)</em>。绝大多数链表题的第一步都是它，' +
        '把循环边界写对就成功了一半。',
      fields: [],
      path: '/api/linkedlist/trace/traverse',
      body: () => ({}),
      cx: [['时间', 'O(n)'], ['空间', 'O(1)'], ['关键', '边界']],
      tips: [
        '写成 <code>while (p->next != NULL)</code> 会漏掉最后一个结点。',
        '遍历时不要改 p 指向的链，否则会提前断链。',
        '空表时循环一次都不进，这是正确行为，不需要特判。'
      ]
    }
  ];

  /** 图例：全站同一语义同一颜色 */
  const LEGEND = [
    ['var(--node-idle)', '未访问'],
    ['var(--node-compare)', '正在比较'],
    ['var(--node-visited)', '已访问'],
    ['var(--node-new)', '新建结点'],
    ['var(--node-remove)', '待删除'],
    ['var(--node-ptr)', '指针所指'],
    ['var(--node-null)', 'NULL 端']
  ];

  DS.listOps = OPS;
  DS.listLegend = LEGEND;
  DS.parseNums = parseNums;
})();
