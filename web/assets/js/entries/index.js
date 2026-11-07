/* 首页入口：仅按原 <script> 顺序做副作用导入，不含任何业务逻辑。
   顺序即依赖顺序——这些文件都是 IIFE，通过 window.DS 互相通信。 */
import '../core/dom.js';
import '../core/sanitize.js';
import '../core/toast.js';
import '../core/api.js';
import '../core/offline.js';
import '../core/sw.js';
import '../shell.js';
import '../pages/home.js';
