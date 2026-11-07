/* ==========================================================================
   engine/index.ts —— 轨迹引擎的统一出口
   --------------------------------------------------------------------------
   同构模块：浏览器（离线模式 / PWA）与 Node（parity 测试）用同一份实现。
   服务端仍是 Python（权威实现），这里是它的镜像，靠 tests/parity.test.js
   对 golden 快照逐字节比对来保证不漂移。
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
