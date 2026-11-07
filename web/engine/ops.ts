/* ==========================================================================
   engine/ops.ts —— 操作注册表（C 代码行 / 标题）
   --------------------------------------------------------------------------
   真相源是冻结参考实现里的 OPS 表：前端只认「后端说有哪些操作、每步高亮哪行
   代码」。ops.table.json 由迁移期的脚本一次性导出，参考实现退场后不再重生成
   ——要改就直接改这份 JSON，并同步重建 golden 快照。

   漂移检测：golden 快照里每个操作的 title / code 都参与逐字节比对，所以改了
   这份 JSON 却忘了同步 golden，parity 测试会立刻红。
   ========================================================================== */

import raw from './ops.table.json';
import type { OpTable } from './types';

export const OPS = raw as unknown as {
  list: OpTable;
  stack: OpTable;
  queue: OpTable;
};
