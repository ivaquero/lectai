# server/ —— Node 服务端（Fastify）

站点唯一的后端：轨迹计算、题库、答疑、静态托管都在这里。轨迹引擎与前端离线版
共用 `web/src/engine/`，数据读仓库根 `data/`。

## 命令

```bash
pnpm install              # 仓库根
pnpm server:build         # esbuild → dist/server/server.mjs（仓库根；引擎内联，依赖 external）
pnpm server               # 启动，默认 127.0.0.1:8000
pnpm server:dev           # 监听 src/ 改动，重建后自动重启
pnpm test:http-contract   # 起一个全新进程，按固定顺序回放 HTTP 契约快照
pnpm --filter @lectai/server test:record   # 有意改契约后重录快照（见下文）
pnpm typecheck            # pnpm -r，前端与服务端一起检查
```

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `LECTAI_PORT` | `8000` | 监听端口（与前端 `core/api.js` 的默认地址一致） |
| `LECTAI_HOST` | `127.0.0.1` | 监听地址 |
| `LECTAI_SESSION_TTL` | `3600` | 会话闲置过期秒数 |
| `LECTAI_SESSION_MAX` | `10000` | 会话上限（LRU 淘汰） |
| `LECTAI_STATIC_DIR` | 自动 | `dist/web` 存在则用它，否则用 `web/` 源码 |
| `LECTAI_DATA_DIR` | `data/` | 题库 / 知识库目录（仓库根） |
| `ALLOWED_ORIGINS` | 本地 8000 / 5500 / `null` | CORS 白名单，逗号分隔 |

部署到反向代理后面时把 `LECTAI_HOST` 设成 `0.0.0.0`，其余变量按需覆盖；
代码里不写死任何路径，静态目录与数据目录都从 `import.meta.url` 推。

## 结构

```text
src/
├── engine.ts        与 web/src/engine 的唯一耦合点（export * 转出）
├── env.ts           路径与配置；按 import.meta.url 定位，不依赖 cwd
├── http.ts          {code,msg,data} 外壳 + 参数校验（422 也套同一外壳）
├── session.ts       TTL + LRU；容器一律空表起步
├── data.ts          题库 / 知识库懒加载 + mtime 热更新
├── routes/
│   ├── trace.ts     链 / 栈 / 队共用的注册逻辑（操作清单来自 OPS 表）
│   ├── quiz.ts      分类 / 取题 / 判题 / 统计
│   ├── ai.ts        知识库匹配 + 模拟回答（大模型预留位）
│   └── health.ts    /api/health
├── app.ts           装配顺序：处理器 → CORS → 路由 → 静态
└── main.ts          warm 数据 → listen → 信号处理
```

## HTTP 契约与快照

`tests/http-contract.golden.json` 是服务端对外的行为快照，按**固定顺序**记录
129 次请求的状态码 / content-type / Redirect / 应答体：

- 轨迹类接口体量大（与 `web/tests/` 重复），只锁规范化指纹；
- HTML 只锁「是 HTML」，改版不会碰红；
- 健康检查剔除 `uptime_sec` / `sessions` / `session_policy` 这些天然变化的字段；
- 422 只锁状态码，外壳由测试单独断言必须是 `code=1 + msg`。

**什么时候重录**：新增字段、改文案、加接口——凡是有意改契约，就 `--record` 重录，
并在 PR 里逐条 review 快照 diff。快照的变化就是契约的变化。
`CONTRACT_BASE=http://host:port` 可以对一个正在跑的实例录，不启动本地进程。

## 装配顺序的坑（别改回去）

`app.setErrorHandler` / `setNotFoundHandler` 必须在 `register(...)` **之前**调用，
并且装配期间不要 `await app.register(...)`：await 会触发 `ready()`，之后再设的
处理器被静默忽略，表现为参数校验虽然还是 422，但外壳退回 Fastify 默认的
`{statusCode,error,message}`。实测记录见 `src/app.ts` 文件头。

## 已知边界

- 结点 id 是进程内全局自增：两实例比对必须都是**全新进程**，否则 id 对不上
  （这也是契约测试坚持自起进程、并检查端口未被占用的原因）。
- 会话状态在进程内存，重启即清空、无法多实例横向扩容。要横向扩容再谈 Redis / KV。
- 本地引擎与离线快照是两套数据来源：断网后可视化走 `web/src/engine`，
  题库走 `web/data/offline.json`，两者都由 `tools/` 下的脚本产出。
