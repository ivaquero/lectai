/* 单链表页入口：仅按原 <script> 顺序做副作用导入，不含任何业务逻辑。

   core/offline.js 是第三步新加的：本页原本没有离线层，现在后端不可达时由它
   把 /api/linkedlist/** 交给 src/engine 本地生成轨迹。位置与其它页保持一致：
   紧跟在 api.js 之后。 */
import '../core/dom.js';
import '../core/sanitize.js';
import '../core/toast.js';
import '../core/parse.js';
import '../core/api.js';
import '../core/offline.js';
import '../core/sw.js';
import '../core/keys.js';
import '../core/trace.js';
import '../shell.js';
import '../pages/list/render.js';
import '../pages/list/ops.js';
import '../pages/list/index.js';
