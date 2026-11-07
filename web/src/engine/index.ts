/* ==========================================================================
   engine/index.ts —— 轨迹引擎的统一出口
   --------------------------------------------------------------------------
   同构模块：浏览器（离线模式 / PWA）与 Node（server/）用同一份实现。
   语义来自**冻结的参考实现**——迁移期由 Python 版 algo/*_trace.py 提供，该实现
   已随 Node 迁移退场；它产出的行为快照留在 web/tests/，tests/parity.test.js
   逐字节比对，这就是防漂移的机制。
   ========================================================================== */

import { OPS as OPS_ALL } from './ops';

export * as list from './linkedlist';
export * as queue from './queue';
export * as stack from './stack';
export { OpError, SeqTracer, pyListRepr, seqMeta, seqStatePayload } from './seq';
export { OPS } from './ops';

export type {
  Counters,
  ItemView,
  ListPayload,
  ListResult,
  ListState,
  ListStep,
  Mark,
  OpCode,
  OpEntry,
  OpMeta,
  OpTable,
  PtrValue,
  Ring,
  SeqPayload,
  SeqResult,
  SeqState,
  SeqStep,
} from './types';

/** 容器类型 → 该容器的 OPS 子表 */
export const OP_TABLES = OPS_ALL;
