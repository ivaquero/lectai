/* ==========================================================================
   engine/linkedlist.ts —— 单链表轨迹生成器
   --------------------------------------------------------------------------
   逐行对应 backend/algo/linkedlist_trace.py。三条不可改写的语义：

   ★ head 指针永不丢失 ★
     每个 op_* 习惯用 `t.ptr = {...}` 整体替换粘性字典，会顺手冲掉 head 键
     （比如头插讲解「head 还指着旧首元结点」那一步箭头就消失）。所以 push()
     统一以入参 head 为准写回 ptr["head"]，保证箭头永远指向当前真值。

   ★ mark 顺序 ★
     compare / visited / new / remove 一律按「链表顺序 + aside 顺序」过滤输出。

   ★ id 生成后永不变 ★
     前端靠 id 做高亮定位，所以结点即使被摘下来（进 aside）也保留原 id。
   ========================================================================== */

import { OPS as OPS_ALL } from './ops';
import { OpError } from './seq';
import type {
  ItemView,
  ListPayload,
  ListState,
  ListStep,
  Mark,
  PtrValue,
} from './types';

export { OpError };

const OPS = OPS_ALL.list;

/** 为了投影可读性限制结点数（超出后文字缩得太小） */
export const MAX_NODES = 12;

let idSeq = 1;

export function resetIds(): void {
  idSeq = 1;
}

/** 链表结点：value 数据域 + next 指针域 */
export class ListNode {
  id: string;
  value: number;
  next: ListNode | null = null;

  constructor(value: number) {
    this.id = `n${idSeq++}`;
    this.value = value;
  }
}

type PtrMap = Record<string, ListNode | string | null>;

export interface ListPushOptions {
  compare?: readonly string[];
  remove?: readonly string[];
  ptr?: PtrMap;
  aside?: readonly ListNode[];
}

/**
 * 轨迹记录器。算法函数只调用 push()；ptr / aside / visited / new 都是「粘性」
 * 状态，一步内不改就延续到下一步，减少重复样板。
 */
export class Tracer {
  steps: ListStep[] = [];
  visited = 0;
  moves = 0;
  compares = 0;
  ptr: PtrMap = {};
  aside: ListNode[] = [];
  visitedIds = new Set<string>();
  newIds = new Set<string>();

  /** 主链快照：顺序即逻辑顺序，标签 a1、a2… */
  static chain(head: ListNode | null): ItemView[] {
    const out: ItemView[] = [];
    let p = head;
    let i = 1;
    while (p) {
      out.push({ id: p.id, value: p.value, label: `a${i}` });
      p = p.next;
      i += 1;
    }
    return out;
  }

  /** aside 结点没有位序标签，label 留空 */
  static flat(nodes: readonly ListNode[]): ItemView[] {
    return nodes.map((n) => ({ id: n.id, value: n.value, label: null }));
  }

  private ptrJson(): Record<string, PtrValue> {
    const out: Record<string, PtrValue> = {};
    for (const key of Object.keys(this.ptr)) {
      const v = this.ptr[key];
      out[key] = typeof v === 'object' && v !== null ? v.id : v;
    }
    return out;
  }

  private mark(
    head: ListNode | null,
    compare: readonly string[] = [],
    remove: readonly string[] = [],
  ): Mark {
    // visited / new 按链表顺序输出，aside 里的结点排在最后
    const order: string[] = [];
    let p = head;
    while (p) {
      order.push(p.id);
      p = p.next;
    }
    for (const n of this.aside) order.push(n.id);

    const keep = (ids: Set<string>) => order.filter((id) => ids.has(id));
    return {
      compare: keep(new Set(compare)),
      visited: keep(this.visitedIds),
      new: keep(this.newIds),
      remove: keep(new Set(remove)),
    };
  }

  push(
    head: ListNode | null,
    line: number | null,
    info: string,
    opts: ListPushOptions = {},
  ): ListStep {
    if (opts.ptr) this.ptr = { ...this.ptr, ...opts.ptr };
    if (opts.aside !== undefined) this.aside = [...opts.aside];

    // head 是链表的基本参照物：每一步都必须画出，且始终等于本步实际传入的 head
    this.ptr.head = head;

    const snap: ListStep = {
      seq: this.steps.length,
      nodes: Tracer.chain(head),
      aside: Tracer.flat(this.aside),
      head: head ? head.id : null,
      ptr: this.ptrJson(),
      mark: this.mark(head, opts.compare, opts.remove),
      line,
      counters: {
        visited: this.visited,
        moves: this.moves,
        compares: this.compares,
      },
      info,
    };
    this.steps.push(snap);
    return snap;
  }
}

function countNodes(head: ListNode | null): number {
  let n = 0;
  let p = head;
  while (p) {
    n += 1;
    p = p.next;
  }
  return n;
}

function lastLength(t: Tracer): number {
  return t.steps[t.steps.length - 1].nodes.length;
}

/** 组一条完整的返回体：元数据 + 轨迹 + 最终长度 */
function meta(op: string, head: ListNode | null): ListPayload {
  const m = OPS[op];
  return {
    op,
    title: m.title,
    code: { lines: [...m.lines], structural: [...m.structural] },
    length: countNodes(head),
    max_nodes: MAX_NODES,
    trace: null,
  };
}

function checkCapacity(head: ListNode | null): void {
  if (countNodes(head) >= MAX_NODES) {
    throw new OpError(`结点数已达上限 ${MAX_NODES}，请先删除一些结点`);
  }
}

/** 目标结点在主链中的位序（1 开始）；找不到返回 -1 */
function posOf(head: ListNode | null, target: ListNode): number {
  let i = 1;
  let p = head;
  while (p) {
    if (p === target) return i;
    p = p.next;
    i += 1;
  }
  return -1;
}

// ==========================================================================
// 六个操作
// ==========================================================================

/** 尾插法建表：head 从 NULL 开始，逐个接到尾部 */
export function opBuild(lst: TraceList, values: readonly number[]): ListPayload {
  if (values.length > MAX_NODES) {
    throw new OpError(`最多支持 ${MAX_NODES} 个结点，收到 ${values.length} 个`);
  }

  const t = new Tracer();
  lst.head = null;
  t.ptr = { head: null };
  t.push(null, 0, '从空表开始：head = NULL');

  let tail: ListNode | null = null;
  for (const x of values) {
    const s = new ListNode(x);
    t.newIds.add(s.id);
    t.aside = [s];
    t.ptr = { s };
    t.push(lst.head, 1, `申请新结点 s，写入数据 ${x}，next 置为 NULL`);

    if (tail === null) {
      lst.head = s;
      t.aside = [];
      t.ptr = { head: s, s: null };
      t.push(lst.head, 2, '链表为空：head 直接指向 s', { compare: [s.id] });
    } else {
      tail.next = s;
      t.aside = [];
      t.ptr = { s: null };
      t.push(lst.head, 2, `尾结点的 next 接上 s（${tail.value} → ${x}）`, {
        compare: [s.id],
      });
    }
    tail = s;
    t.push(lst.head, 3, `${x} 已入链，tail 后移`, { ptr: { tail: s } });
  }

  t.ptr = { tail: null };
  t.push(lst.head, null, `建表完成，共 ${values.length} 个结点`);
  const out = meta('build', lst.head);
  out.trace = t.steps;
  return out;
}

/** 头插：s->next = head; head = s —— 顺序不能颠倒 */
export function opInsertHead(lst: TraceList, value: number): ListPayload {
  checkCapacity(lst.head);
  const t = new Tracer();
  const oldHead = lst.head;

  const s = new ListNode(value);
  t.newIds.add(s.id);
  t.aside = [s];
  t.ptr = { s };
  t.push(lst.head, 0, '申请新结点 s（还没接入链表）');

  t.push(lst.head, 1, `s->data = ${value}`);

  // 接链：s 进入主链，但 head 还没动 —— 这是本操作的教学重点
  s.next = oldHead;
  t.ptr = { s };
  t.push(
    lst.head,
    2,
    's->next = head：s 已接上原链，但 head 还指着旧首元结点',
    { compare: [s.id] },
  );

  lst.head = s;
  t.aside = [];
  t.ptr = { s: null, head: s };
  t.push(lst.head, 3, 'head = s：头插完成，s 成为新的首元结点', {
    compare: [s.id],
  });

  t.push(lst.head, null, `头插 ${value} 完成，当前表长 ${lastLength(t)}`);
  const out = meta('insert-head', lst.head);
  out.trace = t.steps;
  return out;
}

/** 尾插：先沿 next 走到最后一个结点，再接上 */
export function opInsertTail(lst: TraceList, value: number): ListPayload {
  checkCapacity(lst.head);
  const t = new Tracer();

  const s = new ListNode(value);
  t.newIds.add(s.id);
  t.aside = [s];
  t.ptr = { s };
  t.push(lst.head, 0, '申请新结点 s，data 与 next 都已就绪');

  if (lst.head === null) {
    lst.head = s;
    t.aside = [];
    t.ptr = { head: s, s: null };
    t.push(lst.head, 2, '链表为空：head 直接指向 s', { compare: [s.id] });
  } else {
    t.push(lst.head, 3, 'p = head，从头开始找尾结点', { ptr: { p: lst.head } });
    let p = lst.head;
    while (p.next !== null) {
      const nxt = p.next;
      t.moves += 1;
      t.visitedIds.add(p.id);
      t.ptr = { p: nxt };
      t.push(
        lst.head,
        4,
        `p->next 不为空，p 后移到第 ${posOf(lst.head, nxt)} 个结点`,
        { compare: [p.id], ptr: { p: nxt } },
      );
      p = nxt;
    }
    // p 已是尾结点：p->next 为 NULL
    t.push(lst.head, 4, 'p->next == NULL：p 就是尾结点', { compare: [p.id] });

    p.next = s;
    t.aside = [];
    t.ptr = { p, s: null };
    t.push(lst.head, 5, `p->next = s：${p.value} 接上 ${value}`, {
      compare: [p.id, s.id],
    });
  }

  t.push(lst.head, null, `尾插 ${value} 完成，当前表长 ${lastLength(t)}`);
  const out = meta('insert-tail', lst.head);
  out.trace = t.steps;
  return out;
}

/** 按位序删除：走到前驱（或直接动 head），摘链，再释放 */
export function opDeletePos(lst: TraceList, pos: number): ListPayload {
  const n = countNodes(lst.head);
  if (pos < 1 || pos > n) {
    throw new OpError(`位序 ${pos} 越界，当前链表长度为 ${n}`);
  }

  const t = new Tracer();
  t.push(lst.head, null, `删除第 ${pos} 个结点：先找到它（或它的前驱）`);

  if (pos === 1) {
    const q = lst.head as ListNode;
    t.ptr = { q, head: lst.head };
    t.push(lst.head, 1, 'pos = 1：删的是首元结点，q = head', {
      compare: [q.id],
      remove: [q.id],
    });

    lst.head = q.next;
    t.ptr = { q, head: q.next };
    t.aside = [q];
    t.push(lst.head, 1, 'head = head->next：head 越过 q，q 已离开主链', {
      remove: [q.id],
    });

    t.ptr = { q: null };
    t.aside = [];
    t.push(lst.head, 1, 'free(q)：结点占用的内存归还系统');
  } else {
    let p = lst.head as ListNode;
    t.ptr = { p };
    t.push(lst.head, 2, 'p = head，准备走到前驱（第 pos-1 个结点）');
    for (let i = 1; i < pos - 1; i += 1) {
      const nxt = p.next as ListNode;
      t.moves += 1;
      t.visitedIds.add(p.id);
      t.ptr = { p: nxt };
      t.push(lst.head, 3, `p 后移到第 ${i + 1} 个结点`, { compare: [p.id] });
      p = nxt;
    }
    t.push(lst.head, 3, `p 停在前驱（第 ${pos - 1} 个结点）`, {
      compare: [p.id],
    });

    const q = p.next as ListNode;
    t.ptr = { p, q };
    t.push(lst.head, 4, `q = p->next：q 指向待删除的第 ${pos} 个结点`, {
      compare: [p.id, q.id],
      remove: [q.id],
    });

    p.next = q.next;
    t.ptr = { p, q };
    t.aside = [q];
    t.push(lst.head, 5, 'p->next = q->next：摘链完成，q 已离开主链', {
      remove: [q.id],
    });

    t.ptr = { q: null };
    t.aside = [];
    t.push(
      lst.head,
      6,
      'free(q)：先摘链，再释放——顺序反了会丢掉后面的链',
    );
  }

  t.push(lst.head, null, `删除完成，当前表长 ${lastLength(t)}`);
  const out = meta('delete-pos', lst.head);
  out.trace = t.steps;
  return out;
}

/** 按值删除：prev / p 双指针同行，找到即摘链 */
export function opDeleteValue(lst: TraceList, value: number): ListPayload {
  const t = new Tracer();

  let prev: ListNode | null = null;
  let p = lst.head;
  t.ptr = { prev: null, p };
  t.push(lst.head, 0, 'prev = NULL，p = head，双指针开始找值');

  let found: ListNode | null = null;
  let pos = 1;
  while (p !== null) {
    t.compares += 1;
    if (p.value === value) {
      t.push(
        lst.head,
        2,
        `p->data == ${value}：命中，是第 ${pos} 个结点`,
        { compare: [p.id], remove: [p.id] },
      );
      found = p;
      break;
    }
    t.visitedIds.add(p.id);
    t.push(lst.head, 2, `第 ${pos} 个结点是 ${p.value} ≠ ${value}，继续`, {
      compare: [p.id],
    });
    prev = p;
    p = p.next;
    pos += 1;
    t.moves += 1;
    t.ptr = { prev, p: p ?? 'NULL' };
    t.push(
      lst.head,
      3,
      p ? 'prev = p，p = p->next：双指针同步后移' : 'p 已走到 NULL，链里没有这个值',
      { ptr: { prev, p: p ?? 'NULL' } },
    );
  }

  if (found === null) {
    t.push(lst.head, 4, `链表中不存在值为 ${value} 的结点，删除失败`);
    throw new OpError(`链表中不存在值为 ${value} 的结点`);
  }

  if (prev === null) {
    lst.head = found.next;
    t.ptr = { prev: null, p: found };
    t.aside = [found];
    t.push(lst.head, 5, 'prev 为空：删的是首元结点，head = p->next', {
      remove: [found.id],
    });
  } else {
    prev.next = found.next;
    t.ptr = { prev, p: found };
    t.aside = [found];
    t.push(lst.head, 6, 'prev->next = p->next：摘链，p 离开主链', {
      remove: [found.id],
    });
  }

  t.ptr = { p: null };
  t.aside = [];
  t.push(lst.head, 7, 'free(p)：释放已摘下的结点');

  t.push(lst.head, null, `删除值 ${value} 完成，当前表长 ${lastLength(t)}`);
  const out = meta('delete-value', lst.head);
  out.trace = t.steps;
  return out;
}

/** 按值查找：p 沿 next 逐个比较；p 走到 NULL 即未找到 */
export function opSearch(lst: TraceList, value: number): ListPayload {
  const t = new Tracer();
  let p = lst.head;
  t.ptr = { p };
  let pos = 1;
  t.push(lst.head, 0, `p = head，从第 1 个结点开始找 ${value}`);

  while (p !== null) {
    t.compares += 1;
    if (p.value === value) {
      t.push(
        lst.head,
        2,
        `p->data == ${value}：在第 ${pos} 个结点找到，返回 ${pos}`,
        { compare: [p.id] },
      );
      t.push(lst.head, 2, `查找成功：${value} 位于第 ${pos} 个结点`, {
        compare: [p.id],
      });
      const out = meta('search', lst.head);
      out.result = { found: true, pos };
      out.trace = t.steps;
      return out;
    }
    t.visitedIds.add(p.id);
    t.push(lst.head, 2, `第 ${pos} 个结点是 ${p.value} ≠ ${value}，继续`, {
      compare: [p.id],
    });
    p = p.next;
    pos += 1;
    t.moves += 1;
    t.ptr = { p: p ?? 'NULL' };
    t.push(
      lst.head,
      3,
      p ? `p = p->next，走到第 ${pos} 个` : 'p = p->next，p 变成 NULL',
      { ptr: { p: p ?? 'NULL' } },
    );
  }

  t.push(lst.head, 5, `p 走到 NULL 仍未命中：返回 -1，链表中没有 ${value}`);
  const out = meta('search', lst.head);
  out.result = { found: false, pos: -1 };
  out.trace = t.steps;
  return out;
}

/** 遍历：逐个访问并收集 */
export function opTraverse(lst: TraceList): ListPayload {
  const t = new Tracer();
  let p = lst.head;
  t.ptr = { p };
  t.push(lst.head, 0, 'p = head，从头开始遍历');

  const seen: number[] = [];
  while (p !== null) {
    seen.push(p.value);
    t.visitedIds.add(p.id);
    t.push(lst.head, 2, `visit(p->data)：访问第 ${seen.length} 个结点，值 ${p.value}`, {
      compare: [p.id],
    });
    p = p.next;
    t.moves += 1;
    t.ptr = { p: p ?? 'NULL' };
    t.push(
      lst.head,
      3,
      p ? 'p = p->next' : 'p = p->next，p 为 NULL，遍历结束',
      { ptr: { p: p ?? 'NULL' } },
    );
  }

  const done = seen.length
    ? `遍历完成：${seen.join(' → ')} → NULL`
    : '空表，无结点可访问';
  t.push(lst.head, null, done);
  const out = meta('traverse', lst.head);
  out.result = { values: seen };
  out.trace = t.steps;
  return out;
}

// ==========================================================================
// 会话容器 + 工具
// ==========================================================================

/** 只带一个 head 指针的链表（轨迹由各 op* 函数生成） */
export class TraceList {
  head: ListNode | null = null;

  constructor(values: readonly number[] = []) {
    let tail: ListNode | null = null;
    for (const v of values) {
      const node = new ListNode(v);
      if (tail === null) this.head = node;
      else tail.next = node;
      tail = node;
    }
  }

  appendRaw(value: number): void {
    const node = new ListNode(value);
    if (this.head === null) {
      this.head = node;
      return;
    }
    let p = this.head;
    while (p.next) p = p.next;
    p.next = node;
  }

  toNodes(): ItemView[] {
    return Tracer.chain(this.head);
  }

  length(): number {
    return countNodes(this.head);
  }

  values(): number[] {
    const out: number[] = [];
    let p = this.head;
    while (p) {
      out.push(p.value);
      p = p.next;
    }
    return out;
  }

  clear(): void {
    this.head = null;
  }
}

/** 无轨迹的当前状态（供前端对齐 / 快速自检） */
export function statePayload(lst: TraceList): ListState {
  return {
    op: 'state',
    length: lst.length(),
    max_nodes: MAX_NODES,
    nodes: lst.toNodes(),
    trace: [],
  };
}
