# 前端站点（web/）

数据结构学习平台的四个页面。原生 HTML + CSS + JS，无构建步骤，无框架。
页面自己不实现算法——算法在 `backend/algo/` 里跑完并生成整条步骤轨迹，前端只负责回放。

## 目录

```
web/
├── index.html            首页：入口卡 + 学习路径
├── list.html             单链表可视化（7 个操作，可单步/回退）
├── quiz.html             在线刷题（4 类题库、判题、解析、答题卡）
├── ai.html               AI 答疑（本地知识库 + 预留大模型）
├── legacy/               旧版多模块页面（栈/队列/二叉树/排序），页脚有入口
├── assets/
│   ├── css/
│   │   ├── tokens.css        设计变量：配色、间距、圆角、字体、时长
│   │   ├── base.css          元素重置、排版、skip-link、离线横幅
│   │   ├── layout.css        顶栏、page、split/side 双栏、断点
│   │   ├── components.css    卡片、按钮、chips、tabs、toast
│   │   └── pages/            home / list / quiz / ai 各自的样式
│   └── js/
│       ├── shell.js          全站外壳：导航高亮、后端徽标、skip-link、离线横幅
│       ├── core/
│       │   ├── dom.js        $ / $$ / el / esc
│       │   ├── api.js        fetch 封装：会话头、超时、离线标记
│       │   ├── toast.js      轻提示
│       │   ├── keys.js       键盘绑定
│       │   └── trace.js      轨迹播放器（游标 + 速度 + 事件）
│       └── pages/
│           ├── home.js
│           ├── quiz.js
│           ├── ai.js
│           └── list/         index(控制器) / ops(操作元数据) / render(SVG)
└── tests/                    jsdom 集成测试 + 浏览器溢出探针
```

换配色只动 `tokens.css`；新增一个链表操作只动 `pages/list/ops.js`（tabs 自动生成）。

## 运行

后端必须在 8000 端口运行，且**通过后端地址打开页面**（同源，免跨域）：

```bash
cd backend
uvicorn main:app --reload --port 8000
```

然后打开 <http://127.0.0.1:8000/>。

后端没起时四页都会在顶部挂一条横幅，写明启动命令，并把依赖后端的按钮禁用；
直接双击 `index.html` 走 `file://` 也能打开，接口会自动指向 `http://127.0.0.1:8000`。

## 测试

需要 jsdom（装在托管 node 工作区）：

```bash
export NODE_PATH=C:/Users/Rjx17/.workbuddy/binaries/node/workspace/node_modules
```

| 脚本 | 覆盖 | 结果 |
| :--- | :--- | :--- |
| `tests/list-page.test.js` | 链表页：7 个操作真实点击、播放器单步/回退/跳转、快捷键、暂离结点、越界报错 | 45 项 |
| `tests/quiz-ai.test.js` | 刷题取题/判题/解析/答题卡 + 答疑命中与未命中两条路径 | 30 项 |
| `tests/offline.test.js` | 后端不可用时四页的降级提示 + 无障碍基础（jsdom，不需要后端） | 19 项 |

```bash
node web/tests/list-page.test.js     # 需要后端已启动
node web/tests/quiz-ai.test.js       # 需要后端已启动
node web/tests/offline.test.js       # 不需要后端
```

### 响应式溢出探针

`tests/overflow-probe.html` 不是单元测试，需要在浏览器里跑：它用 iframe 逐个加载四个页面，
在 1440 / 900 / 620 三档宽度下测 `scrollWidth - clientWidth`，结果写进页面上的 `<pre>`。

```bash
msedge.exe --headless=new --window-size=1500,1200 --virtual-time-budget=25000 \
  --dump-dom http://127.0.0.1:8000/tests/overflow-probe.html
```

输出形如 `三档宽度均无横向溢出，共 12 项。`

## 断点

| 宽度 | 变化 |
| :--- | :--- |
| ≥1080px | 双栏 `stage + 348px side`；统计 chip 一行四列 |
| 760–1080px | 单栏，side 变两列；统计 chip 2×2；画布高度 `clamp(300px,42vh,460px)` |
| <760px | 顶栏导航折到第二行横向滚动；操作/分类 tabs 两列；C 代码收成「查看代码」抽屉；刷题答题卡移到题目下方横排 |

## 无障碍

- 顶栏按 Tab 第一下就是「跳到主要内容」；
- 播放/单步按钮是真正的 `<button>` 且带 `aria-label`；
- 画布 `<svg role="img">`，每步更新 `<title>` 与 `aria-label`（把当前链表写全）；
- 高亮不只靠颜色：待删除结点加斜线 + 虚线框，当前比较结点加粗描边；
- 尊重 `prefers-reduced-motion: reduce`。
