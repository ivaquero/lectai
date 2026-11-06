# 数据结构学习平台 · 后端服务（Python + FastAPI）

对接 `../web/` 前端学习站的后端服务：单链表轨迹接口、栈 / 队列操作接口、刷题题库接口、AI 答疑接口。
纯本地运行，无数据库（数据存内存），重启即清空。

## 一、目录结构

```
backend/
├── main.py                 # 主服务：栈/队列、题库、AI 答疑（按 §1~§9 分节注释）
├── algo/
│   └── linkedlist_trace.py # ★ 单链表算法 + 轨迹生成器（纯 Python，不依赖 FastAPI）
├── api/
│   └── trace.py            # /api/linkedlist/trace/* 路由（把 algo 的轨迹包装成响应）
├── core/
│   └── response.py         # 统一响应结构 {code, msg, data}
├── questions.json          # 题库（32 题，4 分类，与前端同源）
├── kb.json                 # AI 答疑本地知识库（21 条高频考点）
├── requirements.txt        # 依赖包列表
├── test_api.py             # 接口自动化测试（纯标准库）
└── tests/
    └── test_trace.py       # 轨迹生成器测试（715 项断言，直接跑 python 即可）
```

**架构要点**：算法只有一份，跑在 `algo/linkedlist_trace.py` 里。它不返回「最终状态」，
而是返回**整条步骤轨迹**（每步 = 结点快照 + 指针 + 高亮代码行 + 中文解说）。
前端因此退化成纯播放器，暂停 / 单步 / **回退**都不需要逆操作。
新增一个操作只需在 `algo/linkedlist_trace.py` 的 `OPS` 表里登记，前端标签页自动出现。

## 二、环境要求与安装依赖

- Python 3.10+（开发时使用 3.13）
- 安装依赖（在 `backend/` 目录下执行）：

```bash
pip install -r requirements.txt
```

只装两个包：`fastapi`（Web 框架）、`uvicorn[standard]`（ASGI 服务器）。

## 三、启动服务

```bash
cd backend
uvicorn main:app --reload --port 8000
```

或者：

```bash
python main.py        # 等价于 uvicorn main:app --reload --port 8000
```

启动成功后可访问：

| 地址 | 说明 |
| :--- | :--- |
| http://127.0.0.1:8000/api/health | 健康检查（确认服务已起） |
| http://127.0.0.1:8000/docs | **交互式接口文档（Swagger UI）**，可直接在网页里点按钮调试所有接口 |
| http://127.0.0.1:8000/ | 前端站点首页（后端检测到 `../web/` 存在时自动托管，前后端同源） |
| http://127.0.0.1:8000/list.html | 单链表可视化 |
| http://127.0.0.1:8000/quiz.html | 在线刷题 |
| http://127.0.0.1:8000/ai.html | AI 答疑 |

## 四、测试

### 方式一：一键自动化测试（推荐）

另开一个终端：

```bash
cd backend
python test_api.py
```

脚本会依次测试健康检查、链表增删查（含越界等异常路径）、栈/队列出入、
题库取题与判题（并断言取题接口不泄漏答案）、AI 答疑命中/未命中两种来源，
最后输出 `通过 N 项，失败 0 项`。

### 轨迹生成器测试（不需要起服务）

```bash
cd backend
python tests/test_trace.py     # 715 项断言，含 60 次随机操作的不变式校验
```

### 前端页面集成测试（需要 node + jsdom，服务需已启动）

```bash
cd 项目根目录
node web/tests/list-page.test.js     # 单链表页：7 个操作 + 播放器 + 暂离结点，45 项
node web/tests/quiz-ai.test.js       # 刷题页 + AI 答疑页，30 项
```

### 方式二：curl 手动测试

```bash
# 链表：尾插两个结点再查看
curl -X POST http://127.0.0.1:8000/api/linkedlist/insert-tail -H "Content-Type: application/json" -d "{\"value\": 12}"
curl -X POST http://127.0.0.1:8000/api/linkedlist/insert-tail -H "Content-Type: application/json" -d "{\"value\": 45}"
curl http://127.0.0.1:8000/api/linkedlist

# 栈：入栈、出栈
curl -X POST http://127.0.0.1:8000/api/stack/push -H "Content-Type: application/json" -d "{\"value\": 42}"
curl -X POST http://127.0.0.1:8000/api/stack/pop

# 队列：入队、出队
curl -X POST http://127.0.0.1:8000/api/queue/enqueue -H "Content-Type: application/json" -d "{\"value\": 23}"
curl -X POST http://127.0.0.1:8000/api/queue/dequeue

# 刷题：取题（不含答案）→ 提交答案 → 返回判题+解析
curl "http://127.0.0.1:8000/api/quiz/questions?category=list"
curl -X POST http://127.0.0.1:8000/api/quiz/submit -H "Content-Type: application/json" -d "{\"question_id\": \"list-1\", \"answer\": 1}"

# AI 答疑（命中知识库返回真实答案，未命中返回模拟回答）
curl -X POST http://127.0.0.1:8000/api/ai/ask -H "Content-Type: application/json" -d "{\"question\": \"快速排序为什么最坏 O(n2)\"}"
```

Windows PowerShell 用户请把 `\` 换成反引号或使用 `Invoke-RestMethod`；
最简单的方式是直接打开 http://127.0.0.1:8000/docs 在网页上点。

## 五、接口一览

统一响应格式：`{"code": 0, "msg": "ok", "data": {...}}`，`code=1` 表示业务错误（栈空、越界等）。
所有接口支持请求头 `X-Session-Id` 区分会话（不传则共用 `default`）。

### 5.1 单链表·步骤轨迹接口（新版可视化页使用）

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | /api/linkedlist/trace/state | 当前链表状态（无轨迹，首屏对齐用） |
| POST | /api/linkedlist/trace/build | 尾插建表 `{values:[...]}` |
| POST | /api/linkedlist/trace/insert-head | 头插 `{value}` |
| POST | /api/linkedlist/trace/insert-tail | 尾插 `{value}` |
| POST | /api/linkedlist/trace/delete-pos | 按位序删除 `{pos}` |
| POST | /api/linkedlist/trace/delete-value | 按值删除 `{value}` |
| POST | /api/linkedlist/trace/search | 按值查找 `{value}`（不修改链表） |
| POST | /api/linkedlist/trace/traverse | 遍历（不修改链表） |

返回体：`{op, title, code:{lines, structural}, length, max_nodes, trace:[...]}`，
`trace` 里每一步的形状：

```jsonc
{
  "seq": 0,
  "nodes": [{"id": "n3", "value": 3, "label": "a1"}],  // 主链快照
  "aside": [{"id": "n9", "value": 7, "label": null}],   // 暂离主链：新建的 s / 摘下的 q
  "head": "n3",
  "ptr": {"head": "n3", "p": "n5", "prev": "NULL"},     // 指针 → 结点id | "NULL" | null
  "mark": {"compare": ["n5"], "visited": [], "new": [], "remove": []},
  "line": 2,                                            // 高亮的代码行（0 开始）
  "counters": {"visited": 3, "moves": 2, "compares": 3},
  "info": "p->data = 1 ≠ 4，继续"                        // 这一步的中文解说
}
```

### 5.2 其余接口

| 方法 | 路径 | 说明 |
| :--- | :--- | :--- |
| GET | /api/health | 健康检查 |
| GET | /api/linkedlist | 查询链表状态（nodes/length/empty） |
| POST | /api/linkedlist/insert-head | 头插 `{value}` |
| POST | /api/linkedlist/insert-tail | 尾插 `{value}` |
| POST | /api/linkedlist/delete | 按位序删除 `{pos}`（1-based） |
| POST | /api/linkedlist/delete-value | 按值删除 `{value}` |
| POST | /api/linkedlist/search | 按值查找 `{value}` → 首个命中位序 |
| POST | /api/linkedlist/reset | 按序列重建链表 `{values:[...]}`（前端初始化/重置用） |
| DELETE | /api/linkedlist | 清空链表 |
| GET | /api/stack | 查询栈状态 |
| POST | /api/stack/push | 入栈 `{value}` |
| POST | /api/stack/pop | 出栈（栈空返回 code=1） |
| GET | /api/stack/peek | 查看栈顶（不出栈） |
| POST | /api/stack/reset | 按序列重建栈 `{values:[...]}` |
| DELETE | /api/stack | 清空栈 |
| GET | /api/queue | 查询队列状态 |
| POST | /api/queue/enqueue | 入队 `{value}` |
| POST | /api/queue/dequeue | 出队（队空返回 code=1） |
| GET | /api/queue/peek | 查看队头队尾（不出队） |
| POST | /api/queue/reset | 按序列重建队列 `{values:[...]}` |
| DELETE | /api/queue | 清空队列 |
| GET | /api/quiz/categories | 题库分类列表 |
| GET | /api/quiz/questions?category=list | 取题（**不含答案/解析**） |
| POST | /api/quiz/submit | 提交 `{question_id, answer}` → 判题 + 解析 + 记忆点 |
| GET | /api/quiz/stats | 当前会话刷题统计（正确率） |
| POST | /api/ai/ask | AI 答疑 `{question}` → `{answer, source}` |

## 六、前端对接说明（已完成）

前端**已经接上后端**，不需要再改任何代码。所有请求集中在 `web/script.js` 的 §0.5「后端 API 层」，
只有一个地址变量：

```js
const API_ORIGIN = 'http://127.0.0.1:8000';   // ← 唯一需要改的地方
```

地址策略（`API_BASE` 自动判断）：

| 打开方式 | 实际请求地址 | 说明 |
| :--- | :--- | :--- |
| 通过 `http://127.0.0.1:8000` 打开（推荐） | 相对路径 `/api/...` | 前后端同源，无跨域 |
| 双击 `index.html`（`file://`）或用 Live Server（其他端口） | `http://127.0.0.1:8000/api/...` | 跨域，后端已放开 CORS |

### 各模块的对接方式

1. **链路 / 栈 / 队列可视化**：每个操作按钮（头插、尾插、按位删除、入栈、出栈、入队、出队…）
   都是「先请求后端 → 再用返回的 `data.nodes / data.items` 生成动画帧」。
   真正的插入删除算法跑在后端，前端只负责把结果渲染成可分步播放的动画。
   切换模块时会调 `POST /api/{linkedlist,stack,queue}/reset` 把后端状态对齐到页面初始值。
2. **刷题页**：切分类时 `GET /api/quiz/questions?category=...` 取题（返回体不含答案），
   提交时 `POST /api/quiz/submit`，用返回的 `correct / answer_letter / explanation / key_point` 渲染判题与解析。
3. **AI 答疑**：`askAi()` 走 `POST /api/ai/ask`，带「思考中」占位气泡；命中知识库返回 `source="local_kb"`。
4. **导航栏状态徽标**：页面加载时探测一次 `/api/health`，右上角显示「后端已连接 / 离线模式」，
   鼠标悬停可看到当前后端地址与题库数量。

### 离线降级

后端没启动时前端**不会报错、不会白屏**，`api()` 统一捕获异常并自动降级：

- 可视化模块回落到本地 JS 算法，动画照常可播放；
- 刷题回落到前端内置 `QUIZ_BANK`，判题与解析仍可用；
- AI 答疑回落到本地 `AI_KB` 关键词匹配；
- 顶部徽标显示「离线模式」，并 toast 提示一次。

因此先开前端、后开后端，或只开前端做演示，都是可以的。

## 七、接入大模型（预留位）

编辑 `main.py` §8：

1. 在 `call_llm()` 中按注释示例填入大模型 API 调用（OpenAI 兼容接口即可）；
2. 取消 `ask_ai()` 中「② 大模型」分支的注释；
3. 重启服务。接口出入参格式不变，前端零改动。

当前未接入时：命中本地知识库返回 `source="local_kb"` 的真实答案，
未命中返回 `source="mock"` 的模拟回答。
