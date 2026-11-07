/* ==========================================================================
   engine/types.ts —— 轨迹快照契约（唯一定义处）
   --------------------------------------------------------------------------
   这里的类型对应 backend/algo/*_trace.py 生成并返回给前端的 JSON 结构。
   移植原则：字段名、层级、可空性与 Python 侧逐字对齐，一个都不可「优化」——
   前端渲染层只按这些字段上色和定位，字段错了不会抛异常，只会静默画错。
   ========================================================================== */

/** 指针值：结点 id / "NULL" 字面量 / null（尚未指向任何东西） */
export type PtrValue = string | null;

/** 容器中的一个元素（主结构或 aside） */
export interface ItemView {
  id: string;
  value: number;
  /** 主结构内为 a1、a2…；aside 内恒为 null */
  label: string | null;
}

/** 高亮标记；四个数组的顺序都按容器既有顺序输出 */
export interface Mark {
  compare: string[];
  visited: string[];
  new: string[];
  remove: string[];
}

export interface Counters {
  visited: number;
  moves: number;
  compares: number;
}

/** 循环队列的环形缓冲示意（容量 10，牺牲一个单元） */
export interface Ring {
  capacity: number;
  used: number;
  front: number;
  rear: number;
  full: boolean;
}

/** 栈 / 队列的单个步骤快照 */
export interface SeqStep {
  seq: number;
  items: ItemView[];
  aside: ItemView[];
  ptr: Record<string, PtrValue>;
  mark: Mark;
  line: number | null;
  counters: Counters;
  info: string;
  /** 仅队列：建/入/出/读/遍历都会给每一步补上（值取操作结束后的环形状态） */
  ring?: Ring;
}

/** 单链表的单个步骤快照 */
export interface ListStep {
  seq: number;
  nodes: ItemView[];
  aside: ItemView[];
  head: string | null;
  ptr: Record<string, PtrValue>;
  mark: Mark;
  line: number | null;
  counters: Counters;
  info: string;
}

export interface OpCode {
  lines: string[];
  structural: number[];
}

/** 操作注册表条目（对应 Python 各 *_trace.py 的 OPS 字典） */
export interface OpEntry {
  title: string;
  lines: string[];
  structural: number[];
}

export type OpTable = Record<string, OpEntry>;

/** 元数据 + 轨迹骨架；trace 由各 op_* 填入 */
export interface OpMeta<TStep> {
  op: string;
  title: string;
  code: OpCode;
  length: number;
  max_nodes: number;
  trace: TStep[] | null;
}

export interface ListResult {
  values?: number[];
  value?: number;
  found?: boolean;
  pos?: number;
}

export interface SeqResult {
  values?: number[];
  value?: number;
}

/**
 * 操作返回体。trace 在构造中途为 null（先取元数据、再填轨迹），返回给调用方时
 * 一定已填入——消费方仍按 `payload.trace ?? []` 处理，别假设它非空。
 */
export type ListPayload = OpMeta<ListStep> & {
  result?: ListResult;
};

export type SeqPayload = OpMeta<SeqStep> & {
  result?: SeqResult;
  ring?: Ring;
};

/** 无轨迹的当前状态（首屏对齐 / 快速自检） */
export interface ListState {
  op: 'state';
  length: number;
  max_nodes: number;
  nodes: ItemView[];
  trace: [];
}

export interface SeqState {
  op: 'state';
  length: number;
  max_nodes: number;
  items: ItemView[];
  trace: [];
  ring?: Ring;
}
