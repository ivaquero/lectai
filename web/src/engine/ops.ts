/* ==========================================================================
   engine/ops.ts —— 操作注册表（C 代码行 / 标题）
   --------------------------------------------------------------------------
   真相源仍然是 backend/algo/*_trace.py 里的 OPS 字典：前端只认「后端说有哪些
   操作、每步高亮哪行代码」。这份 JSON 由 tools/export_golden.py 生成，不要手改。

   漂移检测：golden 快照里每个操作的 title / code 都参与逐字节比对，所以一旦
   Python 侧改了 OPS 却忘了重新生成，parity 测试会立刻红。
   ========================================================================== */

import raw from './ops.generated.json';
import type { OpTable } from './types';

export const OPS = raw as unknown as {
  list: OpTable;
  stack: OpTable;
  queue: OpTable;
};
