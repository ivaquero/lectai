# lectai · 数据结构学习平台

面向 408 / 数据结构课程的本地学习站点：**算法在后端跑，前端只做纯播放器**——每一步都对应一行 C 代码、一条中文解说、一份结点快照，可暂停、单步、回退。

无数据库、无外部服务：Python 3.14 + FastAPI + 原生 ES2020 + SVG；Python 版本与依赖都用 [uv](https://docs.astral.sh/uv/) 管理（`backend/.python-version` 固定 3.14）。前端源码是原生 ES2020，后端直接托管即可运行；`web/` 另带一条**可选**的 Vite 构建链，只用于产出发布物。JS 侧依赖统一由 **pnpm** 管理（仓库根 `pnpm-workspace.yaml`，成员只有 `web`），锁文件是根目录的 `pnpm-lock.yaml`，pnpm 版本由 `package.json` 的 `packageManager` 固定为 12.18.0——不要再用 npm / yarn 装依赖。

**离线可用**：后端不可达时自动降级——题库 / 答疑 / 统计走本地快照，链表 / 栈 / 队列的逐步可视化走 `web/src/engine/` 的 TS 引擎（Python 实现的逐字节镜像，由 golden 快照把关）。

## 快速开始

```bash
cd backend
uv sync
uv run uvicorn main:app --reload --port 8000
```

浏览器打开 <http://127.0.0.1:8000/>——前端由后端一并托管，同源无跨域；`/docs` 是交互式接口文档。

```bash
cd backend
uv run python tests/test_trace.py             # 单链表轨迹：715 项断言（无需起服务）
uv run python tests/test_stackqueue_trace.py  # 栈 / 队列轨迹：10599 项断言（无需起服务）
uv run python test_api.py                     # 接口端到端：30 项（需先起服务）
node web/tests/list-page.test.js              # 前端集成（需 jsdom + 后端已启动）
node web/tests/quiz-ai.test.js                # 刷题 + 答疑页（需后端已启动）
node web/tests/offline.test.js                # 离线自动降级(本地判题/答疑/本地轨迹引擎)+无障碍（需后端托管静态，测试内 fetch 被置为失败）
node web/tests/offline-engine.test.js         # 离线轨迹的 REST 适配层 ↔ golden 逐字段比对（不需要后端）
```

前端测试也可一次跑完（含引擎对齐基线；JS 依赖由 **pnpm** 管理，先在仓库根 `pnpm install` 一次）：

```bash
pnpm install            # 仓库根；pnpm 版本由 package.json 的 packageManager 固定（12.18.0）
pnpm test               # 全部套件：sw + parity + offline-engine + list-page + quiz-ai + offline + visual-stackqueue
pnpm test:parity        # 只跑「TS 引擎 ↔ Python 引擎」逐字段比对（不需要后端）
pnpm typecheck          # 引擎与契约类型的静态检查
pnpm build              # 逐页构建到 web/dist（含 sw.js）
pnpm dev                # Vite dev server，/api 反代到 8000
```

## 目录结构

```text
lectai/
├── backend/                    FastAPI 服务（内存态，重启即清空）
│   ├── main.py                 app 组装 + 兼容 REST 层 + 题库 / 答疑接口
│   ├── algo/*_trace.py         ★ 链表 / 栈 / 队列算法 + 轨迹生成器（纯 Python，可直接测）
│   ├── api/*_trace.py          /api/{linkedlist,stack,queue}/trace/* 路由
│   ├── core/session.py         统一会话存储：TTL + LRU + sid 正则
│   ├── core/response.py        ok/err 唯一定义点 {code,msg,data}
│   ├── data/questions.json     题库(6 类 112，每题带 diff 难度标签)
│   ├── data/kb.json            答疑本地知识库(21 条)
│   ├── tools/build_questions.py    分章题合并成主库
│   ├── tools/gen_offline_data.py   生成前端离线快照(改数据后重跑)
│   └── pyproject.toml / uv.lock    uv 项目定义 + 锁文件
└── web/                        前端：原生 ES2020 源码 + 可选 Vite 构建链
    ├── *.html                  首页 / 单链表 / 刷题 / 答疑 / 栈队列
    ├── vite.config.mjs         dev 代理(/api→8000) + 相对 base（产物可部署到子路径）
    ├── scripts/build.mjs       逐页构建：每页单 chunk，避免共享 chunk 打乱执行顺序
    ├── src/engine/             ★ 轨迹引擎的 TS 镜像（Python 的逐行移植，纯计算、不碰 DOM）
    │   └── offline.ts          离线桥：REST 路径 → 本地引擎（容器 / 持久化 / err 外壳）
    ├── tests/                  集成测试 + scenarios/ 场景脚本 + golden/ 对齐基线
    ├── assets/css/tokens.css        换配色只动这个
    └── assets/js/
        ├── entries/*.js        每页单入口：按原 <script> 顺序做副作用导入
        ├── core/api.js         后端地址 API_ORIGIN 单点 + fetch 封装 + 自动降级
        ├── core/offline-data.js 本地快照(题含答案/知识库/统计，自动生成勿手改)
        ├── core/offline.js     离线应答器：题库快照 + 轨迹本地引擎的调度与按需加载
        ├── core/sanitize.js    后端富文本白名单清洗
        ├── core/trace.js       轨迹播放器（游标单步 / 回退）
        └── pages/list/ops.js   新增链表操作只动这个（tabs 自动生成）
```

## 架构与设计取舍

三句话：**算法只有一份**（`algo/*_trace.py`），每个 `op_*()` 返回**整条步骤轨迹**而非最终状态；**前端是纯播放器**（游标前后移动 = 单步 / 回退，无需逆操作）；**会话按 `X-Session-Id` 隔离**，链表 / 栈 / 队列 / 刷题统计共用一个 store。

- **自动离线降级（题库 / 答疑 / 首页统计 / 可视化）**：后端不可达时，`core/api.js` 的 `probe()`/`request()` 先把请求交给 `core/offline.js`：
  - 题库类（`/api/health`、`/api/quiz/*`、`/api/ai/ask`）走本地快照 `core/offline-data.js`（由 `backend/tools/gen_offline_data.py` 从 `data/questions.json`+`data/kb.json` 生成），应答与线上完全同形，取题、判题、解析、答疑、首页指标均可用；
  - 轨迹类（`/api/linkedlist|stack|queue/trace/*` 与 `/ops`）走本地引擎 `web/src/engine/offline.ts`，**链表 / 栈 / 队列的逐步可视化在断网时照常演示**，含单步、回退、C 代码高亮。
  页面顶部挂「离线模式已启用」信息横幅并保留启动命令与重试。**线上取题接口依旧不返回答案**（答案只存在于离线段，供本地测试），防作弊原则不变。
- **算法权威只有一份（Python）**：`algo/*_trace.py` 是唯一权威实现，语义不在此之外独立演进。`web/src/engine/` 是它的**逐行 TS 镜像**（纯计算、无 DOM，浏览器与 Node 共用），由 `web/tests/scenarios/trace-cases.json` 这一份脚本同时喂给两端，再用 `backend/tools/export_golden.py` 从 Python 导出的 golden 快照逐字段比对（36 个场景 / 569 个快照，含 10 个错误用例）。改完 `algo/` 必须重导 golden，否则 `pnpm test:parity` 立刻报红——这就是防漂移的机制，而不是靠自觉。
- **离线状态的交接**：在线期间 `api.js` 把后端每次应答里的容器值记到 `offline.js`（仅内存，不触发任何下载）；探测到离线时才 `import()` 引擎 chunk（约 25KB，独立分包），并把最近一次后端状态灌进本地容器，断网那一刻画布不会重置成空表。本地容器只存值序列，写 `sessionStorage`，所以离线刷新、切 `#stack` / `#queue` 这些整页重载都不丢状态。**已知差异**：本地容器没有服务端的历史轨迹（回放从当前离线后的操作开始）。
- **两道验收关**：`tests/parity.test.js` 验「引擎函数 = Python 函数」；`tests/offline-engine.test.js` 验「REST 路径 + 请求体 → 引擎 → 载荷 = Python 载荷」（同一批 golden，覆盖 `/ops`、`/trace/state`、全部 12 个操作、错误外壳与持久化）。
- **加操作的改动面**：`algo/*.py` 的 `OPS` + `op_*` → 重导 golden → 同步 `web/src/engine/` 镜像 → 前端 `pages/list/ops.js`。四步中漏掉重导，parity 会指着具体字段路径告诉你差在哪。
- **富文本白名单**：`/api/ai/ask`、`/api/quiz/submit` 的 HTML 字段带 `*_content_type`（`trusted_html` / `plain_text`）；只有 `trusted_html` 才经 `DS.sanitize()`（DOMParser + 标签 / 属性 / URL 协议白名单）后走 `innerHTML`，其余一律 `textContent`。
- **安全**：CORS 走 `ALLOWED_ORIGINS` 白名单且 `allow_credentials=False`；sid 校验 `^[A-Za-z0-9_-]{1,64}$`（非法归 `default`）；会话 TTL 3600s + LRU 上限 10000（`LECTAI_SESSION_TTL/MAX` 可覆盖）。

## 接口一览

统一响应 `{"code":0,"msg":"ok","data":{...}}`，`code=1` 为业务错误（栈空、越界等）；所有接口按请求头 `X-Session-Id` 区分会话（不传共用 `default`）。

轨迹接口（可视化页使用）：链表在 `/api/linkedlist/trace/{state,build,insert-head,insert-tail,delete-pos,delete-value,search,traverse}`，栈 / 队列对称地在 `/api/{stack,queue}/trace/{state,build,push|enqueue,pop|dequeue,peek,traverse}`。返回体 `{op,title,code,length,max_nodes,trace:[...]}`，`trace` 每一步的形状：

```jsonc
{
  "seq": 0,
  "nodes": [{"id":"n3","value":3,"label":"a1"}],   // 主链快照
  "aside": [{"id":"n9","value":7,"label":null}],    // 暂离主链：新建的 s / 摘下的 q
  "head": "n3",
  "ptr": {"head":"n3","p":"n5","prev":"NULL"},      // 指针 → 结点id | "NULL" | null
  "mark": {"compare":["n5"],"visited":[],"new":[],"remove":[]},
  "line": 2,                                        // 高亮代码行（0 起）
  "counters": {"visited":3,"moves":2,"compares":3},
  "info": "p->data = 1 ≠ 4，继续"                    // 中文解说
}
```

其余 REST 接口：

| 路径                                                                           | 说明                                                                                             |
| :----------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- |
| GET /api/health                                                                | `quiz_total` / `quiz_categories` / `kb_entries` / `sessions` / `session_policy` / `data_ok`      |
| /api/linkedlist                                                                | GET 查询 · POST insert-head / insert-tail / delete / delete-value / search / reset · DELETE 清空 |
| /api/stack · /api/queue                                                        | GET 查询 · POST push/enqueue、pop/dequeue、reset · GET peek · DELETE 清空                        |
| GET /api/quiz/categories · /api/quiz/questions?category=list · /api/quiz/stats | 分类 / 取题（不含答案解析） / 会话正确率                                                         |
| POST /api/quiz/submit                                                          | `{question_id,answer}` → 判题 + 解析 + 记忆点（带 `*_content_type`）                             |
| POST /api/ai/ask                                                               | `{question}` → `{answer,source,answer_content_type}`                                             |

> `/reset` 兼容层保留，但新版可视化页改用 `/trace/state` 做首屏对齐。前端所有请求集中在 `web/assets/js/core/api.js` 的 `API_ORIGIN`（默认 `http://127.0.0.1:8000`），改后端地址只动这一处。

## 接入大模型（预留位）

编辑 `backend/main.py`：`call_llm()` 填入 OpenAI 兼容调用 → 取消 `ask_ai()`「② 大模型」注释并把 `answer_content_type` 改 `plain_text` → 重启。接口不变、前端零改动。未接入时命中返回 `source=local_kb`，未命中返回 `source=mock`。

## 前端要点

- **脚本加载**：每页只有一个 `<script type="module">` 入口（`assets/js/entries/<page>.js`），入口内按原顺序做副作用导入——顺序即依赖顺序。**代价**：ES module 受 CORS 约束，不能再双击 HTML 用 `file://` 打开；照常由后端托管（`http://127.0.0.1:8000/`）即可，或仓库根 `pnpm dev`（dev 把 `/api` 反代到 8000）、`pnpm preview`。
- **离线开关**：页面用 `<body data-offline-snapshot>`（题库快照）与 `data-offline-trace`（本地轨迹引擎）声明支持的降级类型；两块资源都是按需 `import()` 的独立 chunk（75KB / 25KB），在线时一个字节都不下载。新增可视化页时两件事要做：入口里 `import '../core/offline.js'`，body 上标 `data-offline-trace`。
- **响应式断点**：≥1080px 双栏（stage + 348px side）；760–1080px 单栏、统计 chip 2×2；<760px 导航折行横滚、C 代码收成抽屉、答题卡移到题下。
- **无障碍**：Tab 首下即「跳到主要内容」；播放 / 单步是真 `<button>` 带 `aria-label`；画布 `<svg role="img">` 每步更新 `<title>`；高亮不只看颜色（待删斜线 + 虚线、比较描边）；尊重 `prefers-reduced-motion`。
- **溢出探针**：`web/tests/overflow-probe.html` 在浏览器里用 1440 / 900 / 620 三档测横向溢出。

## 其他

- 审计报告（33 项发现 + P0/P1 修复记录）：[docs/performance/](docs/performance/)。
- 许可：保留所有权利（未指定 OSI 许可证前按私有处理）。
