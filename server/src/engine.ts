/* ==========================================================================
   server/src/engine.ts —— 与前端共用同一份轨迹引擎的唯一耦合点
   --------------------------------------------------------------------------
   web/engine/ 是纯计算模块（不碰 DOM、不读 storage），浏览器离线版与
   Node 服务端都直接用它。这里是服务端唯一的 import 入口：

     · 只有一个相对路径要维护，将来把引擎抽成独立包时只改这一行；
     · 两侧跑的是同一份字节码来源：离线模式与在线服务不会算出两种结果，
       配合 tests/http-contract.test.js 的契约快照可证明 HTTP 层没有语义漂移。
   ========================================================================== */

export * from '../../web/engine/index';

// 引擎把三个容器以 namespace 形式导出（list/stack/queue），类型名不在 index 里，
// 这里补一层显式再导出，服务端只认 './engine' 一个入口。
export type { TraceList } from '../../web/engine/linkedlist';
export type { TraceStack } from '../../web/engine/stack';
export type { TraceQueue } from '../../web/engine/queue';
