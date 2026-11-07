/* ==========================================================================
   engine/queue.ts —— 循环队列轨迹生成器
   --------------------------------------------------------------------------
   逐行对应 backend/algo/queue_trace.py，快照 schema 与栈完全一致，只多一个
   ring 字段（环形缓冲示意）。

   循环队列牺牲一个单元来区分空与满：
     队空 Q.front == Q.rear
     队满 (Q.rear + 1) % MaxSize == Q.front
   ========================================================================== */

import { OPS as OPS_ALL } from './ops';
import { OpError, SeqTracer, pyListRepr, seqMeta, seqStatePayload } from './seq';
import type {
  ItemView,
  Ring,
  SeqPayload,
  SeqState,
} from './types';

export { OpError };

const OPS = OPS_ALL.queue;

/** 数组容量（含牺牲的一个单元，最多放 9 个） */
export const MAX_ITEMS = 10;
export const CAPACITY = MAX_ITEMS;

/** 队列有 front / rear 两个结构指针，交给 SeqTracer 做粘性保持（P-003） */
const ANCHORS = ['front', 'rear'] as const;

let idSeq = 1;

export function resetIds(): void {
  idSeq = 1;
}

export class QueueItem {
  id: string;
  value: number;

  constructor(value: number) {
    this.id = `q${idSeq++}`;
    this.value = value;
  }
}

/** 循环队列：items[0] 是队头，items[last] 是队尾 */
export class TraceQueue {
  items: QueueItem[];

  constructor(values: readonly number[] = []) {
    this.items = values.map((v) => new QueueItem(v));
  }

  front(): QueueItem | null {
    return this.items.length ? this.items[0] : null;
  }

  rear(): QueueItem | null {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }

  length(): number {
    return this.items.length;
  }

  values(): number[] {
    return this.items.map((it) => it.value);
  }

  toItems(): ItemView[] {
    return SeqTracer.flat(this.items);
  }

  /** 环形缓冲示意：front/rear 都按「数组下标」给出，便于前端画环 */
  ring(): Ring {
    const used = this.items.length;
    return {
      capacity: CAPACITY,
      used,
      front: 0,
      rear: used % CAPACITY,
      full: used >= CAPACITY - 1,
    };
  }
}

function meta(op: string, n: number): SeqPayload {
  return seqMeta(OPS, op, n, MAX_ITEMS - 1);
}

export function opBuild(q: TraceQueue, values: readonly number[]): SeqPayload {
  if (values.length > CAPACITY - 1) {
    throw new OpError(`最多支持 ${CAPACITY - 1} 个元素，收到 ${values.length} 个`);
  }

  const t = new SeqTracer(ANCHORS);
  q.items = [];
  t.ptr = { front: 'NULL', rear: 'NULL', x: null };
  t.push(
    q.items,
    0,
    `初始化：Q.front = Q.rear = 0，空队（容量 ${CAPACITY}，牺牲一个单元）`,
  );

  for (const x of values) {
    const item = new QueueItem(x);
    t.newIds.add(item.id);
    t.ptr = { x: item };
    t.push(q.items, 1, `准备入队：x = ${x}`, { aside: [item] });
    q.items.push(item);
    t.moves += 1;
    t.ptr = { front: q.front(), rear: item, x: null };
    t.push(q.items, 2, `Q.data[Q.rear] = ${x}：写入队尾`, {
      compare: [item.id],
    });
    t.aside = [];
    t.push(
      q.items,
      3,
      `Q.rear = (Q.rear + 1) % ${CAPACITY}；当前队列：${pyListRepr(q.values())}`,
    );
  }

  const out = meta('build', q.length());
  out.result = { values: q.values() };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}

export function opEnqueue(q: TraceQueue, value: number): SeqPayload {
  if (q.length() >= CAPACITY - 1) {
    throw new OpError(
      `队满：循环队列最多放 ${CAPACITY - 1} 个元素（容量 ${CAPACITY}，牺牲一个单元）`,
    );
  }

  const t = new SeqTracer(ANCHORS);
  const item = new QueueItem(value);
  t.newIds.add(item.id);

  t.ptr = { front: q.front(), rear: q.rear(), x: item };
  t.push(q.items, 0, `准备入队：x = ${value}`, { aside: [item] });
  t.compares += 1;
  t.push(
    q.items,
    0,
    `检查队满：(rear+1) % ${CAPACITY} != front，可入队（已用 ${q.length()}/${CAPACITY - 1}）`,
    { compare: [item.id] },
  );

  // ① 写入队尾
  q.items.push(item);
  t.ptr = { front: q.front(), rear: item, x: item };
  t.push(q.items, 1, `Q.data[Q.rear] = ${value}：写到队尾位置`, {
    compare: [item.id],
  });

  // ② rear 后移
  t.moves += 1;
  t.aside = [];
  t.ptr = { front: q.front(), rear: item, x: null };
  t.push(q.items, 2, `Q.rear = (Q.rear + 1) % ${CAPACITY}：队尾指针后移一格`, {
    compare: [item.id],
  });
  t.push(
    q.items,
    3,
    `入队完成，当前队列：${pyListRepr(q.values())}（左端为队头）`,
  );

  const out = meta('enqueue', q.length());
  out.result = { value, values: q.values() };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}

export function opDequeue(q: TraceQueue): SeqPayload {
  if (!q.items.length) {
    throw new OpError('队空，无法出队');
  }

  const t = new SeqTracer(ANCHORS);
  const head = q.front() as QueueItem;
  t.ptr = { front: head, rear: q.rear(), x: null };
  t.push(q.items, 0, `准备出队：当前队头 = ${head.value}`);
  t.compares += 1;
  t.push(q.items, 0, '检查队空：front != rear，队非空', { compare: [head.id] });

  // ① 取队头
  t.ptr = { front: head, rear: q.rear(), x: head };
  t.push(q.items, 1, `x = Q.data[Q.front]：取到队头元素 ${head.value}`, {
    remove: [head.id],
  });

  // ② front 后移
  q.items.shift();
  t.moves += 1;
  const newHead = q.front();
  t.ptr = { front: newHead ?? 'NULL', rear: q.rear() ?? 'NULL', x: head };
  t.push(
    q.items,
    2,
    `Q.front = (Q.front + 1) % ${CAPACITY}：${
      newHead === null ? '队已空，front = rear' : `新队头为 ${newHead.value}`
    }`,
    { aside: [head], remove: [head.id] },
  );

  t.aside = [];
  t.ptr = { front: newHead ?? 'NULL', rear: q.rear() ?? 'NULL', x: null };
  t.push(
    q.items,
    3,
    `出队完成，返回 ${head.value}；当前队列：${pyListRepr(q.values())}`,
  );

  const out = meta('dequeue', q.length());
  out.result = { value: head.value, values: q.values() };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}

export function opPeek(q: TraceQueue): SeqPayload {
  if (!q.items.length) {
    throw new OpError('队空，读不到队头');
  }

  const t = new SeqTracer(ANCHORS);
  const head = q.front() as QueueItem;
  t.ptr = { front: head, rear: q.rear(), x: null };
  t.push(q.items, 0, '检查队空：front != rear，队非空', { compare: [head.id] });
  t.compares += 1;
  t.push(
    q.items,
    1,
    `return Q.data[Q.front]：队头是 ${head.value}；front 不动`,
    { compare: [head.id] },
  );

  const out = meta('peek', q.length());
  out.result = { value: head.value };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}

export function opTraverse(q: TraceQueue): SeqPayload {
  const t = new SeqTracer(ANCHORS);
  if (!q.items.length) {
    t.ptr = { front: 'NULL', rear: 'NULL' };
    t.push(q.items, null, '空队，没有可访问的元素');
    const out = meta('traverse', 0);
    out.result = { values: [] };
    out.trace = t.steps;
    stampRing(out, q);
    return out;
  }

  const seen: number[] = [];
  q.items.forEach((it, i) => {
    t.visited += 1;
    t.visitedIds.add(it.id);
    t.ptr = { front: q.front(), rear: q.rear(), x: it };
    t.push(q.items, 0, `i = ${i}：从队头数第 ${i + 1} 个`, {
      compare: [it.id],
    });
    seen.push(it.value);
    t.moves += 1;
    t.push(q.items, 1, `visit(Q.data[${i}])：访问到 ${it.value}`, {
      compare: [it.id],
    });
  });

  t.ptr = { front: q.front(), rear: q.rear(), x: null };
  t.push(
    q.items,
    null,
    `遍历完成（队头 → 队尾）：${seen.join(' → ')}`,
  );
  const out = meta('traverse', q.length());
  out.result = { values: seen };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}

/** 给轨迹每一步补上环形缓冲信息（前端可选使用） */
function stampRing(out: SeqPayload, q: TraceQueue): void {
  const ring = q.ring();
  out.ring = ring;
  for (const s of out.trace ?? []) {
    s.ring = ring;
  }
}

export function statePayload(q: TraceQueue): SeqState {
  return seqStatePayload(q, MAX_ITEMS - 1, { ring: q.ring() });
}
