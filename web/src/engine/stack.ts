/* ==========================================================================
   engine/stack.ts —— 顺序栈轨迹生成器
   --------------------------------------------------------------------------
   逐行对应 backend/algo/stack_trace.py。算法跑完产出一串步骤快照，前端只移动
   游标回放，因此暂停 / 单步 / 回退都不需要任何逆操作。

   items[0] 是栈底，items[last] 是栈顶；结构指针只有 top，交给 SeqTracer 做
   粘性保持（P-003）。
   ========================================================================== */

import { OPS as OPS_ALL } from './ops';
import { OpError, SeqTracer, pyListRepr, seqMeta, seqStatePayload } from './seq';
import type { ItemView, SeqPayload, SeqState } from './types';

export { OpError };

const OPS = OPS_ALL.stack;

/** 教学演示容量：太大了画布装不下 */
export const MAX_ITEMS = 10;

const ANCHORS = ['top'] as const;

let idSeq = 1;

/** 重置 id 计数器（对齐 Python 每个场景前重置 Node._seq 的做法） */
export function resetIds(): void {
  idSeq = 1;
}

export class StackItem {
  id: string;
  value: number;

  constructor(value: number) {
    this.id = `k${idSeq++}`;
    this.value = value;
  }
}

/** 顺序栈：items[0] 是栈底，items[items.length-1] 是栈顶 */
export class TraceStack {
  items: StackItem[];

  constructor(values: readonly number[] = []) {
    this.items = values.map((v) => new StackItem(v));
  }

  top(): StackItem | null {
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
}

function meta(op: string, n: number): SeqPayload {
  return seqMeta(OPS, op, n, MAX_ITEMS);
}

export function opBuild(st: TraceStack, values: readonly number[]): SeqPayload {
  if (values.length > MAX_ITEMS) {
    throw new OpError(`最多支持 ${MAX_ITEMS} 个元素，收到 ${values.length} 个`);
  }

  const t = new SeqTracer(ANCHORS);
  st.items = [];
  t.ptr = { top: 'NULL', x: null };
  t.push(st.items, 0, '初始化：S.top = -1，空栈');

  for (const x of values) {
    const item = new StackItem(x);
    t.newIds.add(item.id);
    t.ptr = { x: item };
    t.push(st.items, 1, `准备入栈：x = ${x}`, { aside: [item] });
    t.compares += 1;
    t.push(
      st.items,
      2,
      `栈未满（top = ${st.items.length - 1}，容量 ${MAX_ITEMS}）`,
      { compare: [item.id] },
    );
    st.items.push(item);
    t.moves += 1;
    t.ptr = { top: item, x: null };
    t.push(st.items, 3, `S.data[++S.top] = ${x}：${x} 成为新栈顶`, {
      compare: [item.id],
    });
    t.aside = [];
    t.push(
      st.items,
      3,
      `入栈完成，当前栈：${pyListRepr(st.values())}（右端为栈顶）`,
      { ptr: { x: null } },
    );
  }

  const out = meta('build', st.length());
  out.result = { values: st.values() };
  out.trace = t.steps;
  return out;
}

export function opPush(st: TraceStack, value: number): SeqPayload {
  if (st.length() >= MAX_ITEMS) {
    throw new OpError(`栈满：已达上限 ${MAX_ITEMS} 个元素，请先出栈`);
  }

  const t = new SeqTracer(ANCHORS);
  const item = new StackItem(value);
  t.newIds.add(item.id);

  t.ptr = { top: st.top(), x: item };
  t.push(st.items, 0, `准备入栈：x = ${value}`, { aside: [item] });
  t.compares += 1;
  t.push(
    st.items,
    0,
    `检查栈满：top = ${st.length() - 1} < ${MAX_ITEMS - 1}，未满`,
    { compare: [item.id] },
  );

  // ① 指针上移
  t.moves += 1;
  t.ptr = { top: item, x: item };
  t.push(st.items, 1, 'S.top++：栈顶指针先上移一格', { compare: [item.id] });

  // ② 写入
  st.items.push(item);
  t.ptr = { top: item, x: null };
  t.push(st.items, 2, `S.data[S.top] = ${value}：写入新栈顶`, {
    compare: [item.id],
  });
  t.aside = [];
  t.push(
    st.items,
    3,
    `入栈完成，当前栈：${pyListRepr(st.values())}（右端为栈顶）`,
  );

  const out = meta('push', st.length());
  out.result = { value, values: st.values() };
  out.trace = t.steps;
  return out;
}

export function opPop(st: TraceStack): SeqPayload {
  if (!st.items.length) {
    throw new OpError('栈空，无法出栈');
  }

  const t = new SeqTracer(ANCHORS);
  const top = st.top() as StackItem;
  t.ptr = { top, x: null };
  t.push(st.items, 0, `准备出栈：当前栈顶 = ${top.value}`);
  t.compares += 1;
  t.push(st.items, 0, '检查栈空：top != -1，栈非空', { compare: [top.id] });

  // ① 取出
  t.ptr = { top, x: top };
  t.push(st.items, 1, `x = S.data[S.top]：取到栈顶元素 ${top.value}`, {
    remove: [top.id],
  });

  // ② 指针下移（元素仍在数组里，但已不在栈内 —— 这是「假删除」）
  st.items.pop();
  t.moves += 1;
  const newTop = st.top();
  t.ptr = { top: newTop ?? 'NULL', x: top };
  t.push(
    st.items,
    2,
    `S.top--：${newTop === null ? '栈已空，top = -1' : `新栈顶为 ${newTop.value}`}`,
    { aside: [top], remove: [top.id] },
  );

  t.aside = [];
  t.ptr = { top: newTop ?? 'NULL', x: null };
  t.push(
    st.items,
    3,
    `出栈完成，返回 ${top.value}；当前栈：${pyListRepr(st.values())}`,
  );

  const out = meta('pop', st.length());
  out.result = { value: top.value, values: st.values() };
  out.trace = t.steps;
  return out;
}

export function opPeek(st: TraceStack): SeqPayload {
  if (!st.items.length) {
    throw new OpError('栈空，读不到栈顶');
  }

  const t = new SeqTracer(ANCHORS);
  const top = st.top() as StackItem;
  t.ptr = { top, x: null };
  t.push(st.items, 0, '检查栈空：top != -1，栈非空', { compare: [top.id] });
  t.compares += 1;
  t.push(st.items, 1, `return S.data[S.top]：栈顶是 ${top.value}；top 指针不动`, {
    compare: [top.id],
  });

  const out = meta('peek', st.length());
  out.result = { value: top.value };
  out.trace = t.steps;
  return out;
}

export function opTraverse(st: TraceStack): SeqPayload {
  const t = new SeqTracer(ANCHORS);
  if (!st.items.length) {
    t.ptr = { top: 'NULL' };
    t.push(st.items, null, '空栈，没有可访问的元素');
    const out = meta('traverse', 0);
    out.result = { values: [] };
    out.trace = t.steps;
    return out;
  }

  const seen: number[] = [];
  for (let i = st.items.length - 1; i >= 0; i -= 1) {
    const it = st.items[i];
    t.visited += 1;
    t.visitedIds.add(it.id);
    t.ptr = { top: st.top(), x: it };
    t.push(
      st.items,
      0,
      `i = ${i}：从栈顶往栈底数第 ${seen.length + 1} 个`,
      { compare: [it.id] },
    );
    seen.push(it.value);
    t.moves += 1;
    t.push(st.items, 1, `visit(S.data[${i}])：访问到 ${it.value}`, {
      compare: [it.id],
    });
  }

  t.ptr = { top: st.top(), x: null };
  t.push(
    st.items,
    null,
    `遍历完成（栈顶 → 栈底）：${seen.join(' → ')}`,
  );

  const out = meta('traverse', st.length());
  out.result = { values: seen };
  out.trace = t.steps;
  return out;
}

/** 无轨迹的当前状态（首屏对齐 / 快速自检） */
export function statePayload(st: TraceStack): SeqState {
  return seqStatePayload(st, MAX_ITEMS);
}

