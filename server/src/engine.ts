/* ==========================================================================
   server/src/engine.ts —— 与前端共用同一份轨迹引擎的唯一耦合点
   --------------------------------------------------------------------------
   web/src/engine/ 是纯计算模块（不碰 DOM、不读 storage），浏览器离线版与
   Node 服务端都直接用它。这里是服务端唯一的 import 入口：

     · 只有一个相对路径要维护，将来把引擎抽成独立包时只改这一行；
     · 两侧跑的是同一份字节码来源，配合 tests/http-parity.test.js 的
       「Python 服务 ↔ Node 服务逐字段比对」，可证明迁移没有语义漂移。
   ========================================================================== */

export * from '../../web/src/engine/index';

// 引擎把三个容器以 namespace 形式导出（list/stack/queue），类型名不在 index 里，
// 这里补一层显式再导出，服务端只认 './engine' 一个入口。
export type { TraceList } from '../../web/src/engine/linkedlist';
export type { TraceStack } from '../../web/src/engine/stack';
export type { TraceQueue } from '../../web/src/engine/queue';
