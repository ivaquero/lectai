/* ==========================================================================
   engine/seq.ts —— 顺序结构（栈 / 循环队列）轨迹记录的公共底座
   --------------------------------------------------------------------------
   逐行对应 backend/algo/_seq_base.py。三处不可改写的语义：

   1. 标签 a1、a2…  按容器既有顺序编号（栈：栈底→栈顶；队列：队头→队尾）
   2. 粘性指针（P-003）  anchorKeys 里的指针名，即使某步被整体重赋 ptr 时漏掉，
      也会用「最近一次看到的值」回填；从没出现过则回填 "NULL"。
      注意 null 不算有效值，不进入 anchorLast —— 只有这样「空结构时 top/front/rear
      就是 NULL」这条约定才能一路保持。
   3. mark 顺序  compare/visited/new/remove 一律按 [主结构顺序 … aside 顺序] 过滤后
      输出，不是按加入集合的先后。
   ========================================================================== */

import type {
  ItemView,
  Mark,
  OpMeta,
  OpTable,
  PtrValue,
  Ring,
  SeqState,
  SeqStep,
} from './types';

/** 业务错误：栈满 / 队空等。路由层把它转成 code=1（HTTP 仍为 200） */
export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}

/** 容器元素的最小形状（栈的 Item / 队列的 Item 都满足） */
export interface SeqNode {
  id: string;
  value: number;
}

/** 指针字典的值：元素本身、或 "NULL" 字面量、或 null */
export type PtrValueRaw = SeqNode | string | null;

export interface PushOptions {
  compare?: readonly string[];
  remove?: readonly string[];
  ptr?: Record<string, PtrValueRaw>;
  aside?: readonly SeqNode[];
}

export class SeqTracer {
  steps: SeqStep[] = [];
  visited = 0;
  moves = 0;
  compares = 0;
  ptr: Record<string, PtrValueRaw> = {};
  aside: SeqNode[] = [];
  /** 与 Python 的 _visited_ids / _new_ids 同义，供各 op_* 直接 add */
  visitedIds = new Set<string>();
  newIds = new Set<string>();

  private anchorKeys: string[];
  private anchorLast: Record<string, SeqNode | string> = {};

  constructor(anchorKeys: readonly string[] = []) {
    this.anchorKeys = [...anchorKeys];
  }

  /** 按容器既有顺序编号 a1, a2, … */
  static flat(items: readonly SeqNode[]): ItemView[] {
    return items.map((it, i) => ({ id: it.id, value: it.value, label: `a${i + 1}` }));
  }

  /** aside 里的元素没有位序，label 留空 */
  static asideFlat(items: readonly SeqNode[]): ItemView[] {
    return items.map((it) => ({ id: it.id, value: it.value, label: null }));
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
    items: readonly SeqNode[],
    compare: readonly string[] = [],
    remove: readonly string[] = [],
  ): Mark {
    const order = [
      ...items.map((it) => it.id),
      ...this.aside.map((it) => it.id),
    ];
    const keep = (ids: Set<string>) => order.filter((id) => ids.has(id));
    return {
      compare: keep(new Set(compare)),
      visited: keep(this.visitedIds),
      new: keep(this.newIds),
      remove: keep(new Set(remove)),
    };
  }

  /** 补齐被整体重赋 ptr 时漏掉的锚点键（粘性回填） */
  private reconcileAnchors(): void {
    for (const key of this.anchorKeys) {
      if (key in this.ptr) {
        const v = this.ptr[key];
        if (v !== null) {
          this.anchorLast[key] = v as SeqNode | string;
        }
      } else {
        this.ptr[key] = this.anchorLast[key] ?? 'NULL';
      }
    }
  }

  push(
    items: readonly SeqNode[],
    line: number | null,
    info: string,
    opts: PushOptions = {},
  ): SeqStep {
    if (opts.ptr) this.ptr = { ...this.ptr, ...opts.ptr };
    if (opts.aside !== undefined) this.aside = [...opts.aside];
    this.reconcileAnchors();

    const step: SeqStep = {
      seq: this.steps.length,
      items: SeqTracer.flat(items),
      aside: SeqTracer.asideFlat(this.aside),
      ptr: this.ptrJson(),
      mark: this.mark(items, opts.compare, opts.remove),
      line,
      counters: {
        visited: this.visited,
        moves: this.moves,
        compares: this.compares,
      },
      info,
    };
    this.steps.push(step);
    return step;
  }
}

/** 元数据 + 空 trace 骨架；调用方随后填入 trace / result */
export function seqMeta(
  OPS: OpTable,
  op: string,
  n: number,
  maxNodes: number,
): OpMeta<SeqStep> {
  const meta = OPS[op];
  return {
    op,
    title: meta.title,
    code: { lines: [...meta.lines], structural: [...meta.structural] },
    length: n,
    max_nodes: maxNodes,
    trace: null,
  };
}

/** 无轨迹的当前状态（首屏对齐 / 快速自检） */
export function seqStatePayload(
  container: { length(): number; toItems(): ItemView[] },
  maxNodes: number,
  extra?: { ring?: Ring },
): SeqState {
  const payload: SeqState = {
    op: 'state',
    length: container.length(),
    max_nodes: maxNodes,
    items: container.toItems(),
    trace: [],
  };
  if (extra) {
    return { ...payload, ...extra };
  }
  return payload;
}

/** Python 的 str(list[int])：`[1, 2, 3]`。解说文案里带完整列表，格式必须一致 */
export function pyListRepr(values: readonly number[]): string {
  return `[${values.join(', ')}]`;
}
