var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/app.ts
import { existsSync as existsSync2 } from "node:fs";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";

// src/env.ts
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
var HERE = dirname(fileURLToPath(import.meta.url));
var SERVER_ROOT = resolve(HERE, "..");
var REPO_ROOT = resolve(SERVER_ROOT, "..");
var HOST = process.env.LECTAI_HOST ?? "127.0.0.1";
var PORT = Number(process.env.LECTAI_PORT ?? 8e3);
var DATA_DIR = process.env.LECTAI_DATA_DIR ?? resolve(REPO_ROOT, "data");
function resolveStaticDir() {
  const explicit = process.env.LECTAI_STATIC_DIR;
  if (explicit) return resolve(REPO_ROOT, explicit);
  const dist = resolve(REPO_ROOT, "web", "dist");
  if (existsSync(resolve(dist, "index.html"))) return dist;
  return resolve(REPO_ROOT, "web");
}
var STATIC_DIR = resolveStaticDir();
var SESSION_TTL_SEC = Number(process.env.LECTAI_SESSION_TTL ?? 3600);
var SESSION_MAX = Number(process.env.LECTAI_SESSION_MAX ?? 1e4);
function allowedOrigins() {
  const raw = (process.env.ALLOWED_ORIGINS ?? "").trim();
  if (!raw) {
    return [
      "http://127.0.0.1:8000",
      "http://localhost:8000",
      "http://127.0.0.1:5500",
      // VSCode Live Server 常用端口
      "http://localhost:5500",
      "null"
      // file:// 打开时浏览器的 Origin
    ];
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
var LOG_LEVEL = (process.env.LECTAI_LOG_LEVEL ?? "info").toLowerCase();

// src/http.ts
function ok(data, msg = "ok") {
  return { code: 0, msg, data };
}
function err(msg) {
  return { code: 1, msg, data: null };
}
var HttpError = class extends Error {
  status;
  detail;
  constructor(status, message, detail = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.detail = detail;
  }
};
var BadRequest = class extends HttpError {
  constructor(message, loc) {
    super(422, message, [{ loc, msg: message, type: "value_error" }]);
  }
};
function asBody(raw) {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
function intField(raw, name, opts = {}) {
  const body = asBody(raw);
  const v = body[name];
  if (v === void 0 || v === null) {
    throw new BadRequest(`\u53C2\u6570\u7F3A\u5931\uFF1A${name}`, ["body", name]);
  }
  let n;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string" && v.trim() !== "") {
    n = Number(v);
  } else {
    throw new BadRequest(`\u53C2\u6570\u4E0D\u5408\u6CD5\uFF1A${name} \u5FC5\u987B\u662F\u6574\u6570`, ["body", name]);
  }
  if (!Number.isInteger(n)) {
    throw new BadRequest(`\u53C2\u6570\u4E0D\u5408\u6CD5\uFF1A${name} \u5FC5\u987B\u662F\u6574\u6570`, ["body", name]);
  }
  if (opts.min !== void 0 && n < opts.min) {
    throw new BadRequest(`\u53C2\u6570\u8D8A\u754C\uFF1A${name} \u4E0D\u80FD\u5C0F\u4E8E ${opts.min}`, ["body", name]);
  }
  if (opts.max !== void 0 && n > opts.max) {
    throw new BadRequest(`\u53C2\u6570\u8D8A\u754C\uFF1A${name} \u4E0D\u80FD\u5927\u4E8E ${opts.max}`, ["body", name]);
  }
  return n;
}
function intArrayField(raw, name, maxLen) {
  const body = asBody(raw);
  const v = body[name];
  if (v === void 0 || v === null) return [];
  if (!Array.isArray(v)) {
    throw new BadRequest(`\u53C2\u6570\u4E0D\u5408\u6CD5\uFF1A${name} \u5FC5\u987B\u662F\u6574\u6570\u6570\u7EC4`, ["body", name]);
  }
  if (v.length > maxLen) {
    throw new BadRequest(`\u6700\u591A\u652F\u6301 ${maxLen} \u4E2A\u5143\u7D20\uFF0C\u6536\u5230 ${v.length} \u4E2A`, ["body", name]);
  }
  return v.map((item, i) => {
    if (typeof item === "number" && Number.isInteger(item)) return item;
    if (typeof item === "string" && item.trim() !== "" && Number.isInteger(Number(item))) {
      return Number(item);
    }
    throw new BadRequest(`\u53C2\u6570\u4E0D\u5408\u6CD5\uFF1A${name}[${i}] \u5FC5\u987B\u662F\u6574\u6570`, ["body", name, i]);
  });
}
function stringField(raw, name, opts = {}) {
  const body = asBody(raw);
  const v = body[name];
  if (typeof v !== "string") {
    throw new BadRequest(`\u53C2\u6570\u7F3A\u5931\u6216\u7C7B\u578B\u9519\u8BEF\uFF1A${name}`, ["body", name]);
  }
  const len = [...v].length;
  if (opts.minLength !== void 0 && len < opts.minLength) {
    throw new BadRequest(`\u53C2\u6570\u8FC7\u77ED\uFF1A${name} \u81F3\u5C11 ${opts.minLength} \u4E2A\u5B57\u7B26`, ["body", name]);
  }
  if (opts.maxLength !== void 0 && len > opts.maxLength) {
    throw new BadRequest(`\u53C2\u6570\u8FC7\u957F\uFF1A${name} \u6700\u591A ${opts.maxLength} \u4E2A\u5B57\u7B26`, ["body", name]);
  }
  return v;
}
function queryField(query, name) {
  const q = asBody(query);
  const v = q[name];
  if (typeof v !== "string" || v === "") {
    throw new BadRequest(`\u67E5\u8BE2\u53C2\u6570\u7F3A\u5931\uFF1A${name}`, ["query", name]);
  }
  return v;
}

// src/data.ts
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
var QUIZ_PATH = join(DATA_DIR, "questions.json");
var KB_PATH = join(DATA_DIR, "kb.json");
var quizCache = null;
var kbCache = null;
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error(
        `required data file missing: ${path}. \u8BF7\u68C0\u67E5\u4ED3\u5E93\u662F\u5426\u5B8C\u6574 clone\uFF0C\u6216\u8BBE\u7F6E\u6B63\u786E\u7684\u76F8\u5BF9\u8DEF\u5F84\u3002`
      );
    }
    throw e;
  }
}
function buildIndex(raw) {
  const index = {};
  for (const [category, cat] of Object.entries(raw)) {
    (cat.questions ?? []).forEach((q, i) => {
      const id = `${category}-${i + 1}`;
      index[id] = { ...q, id, category };
    });
  }
  return index;
}
function loadQuiz() {
  const mtimeMs = statSync(QUIZ_PATH).mtimeMs;
  if (quizCache && quizCache.mtimeMs === mtimeMs) return quizCache;
  const bank = readJson(QUIZ_PATH);
  quizCache = { mtimeMs, bank, index: buildIndex(bank) };
  return quizCache;
}
function quizBank() {
  return loadQuiz().bank;
}
function questionIndex() {
  return loadQuiz().index;
}
function aiKb() {
  let mtimeMs;
  try {
    mtimeMs = statSync(KB_PATH).mtimeMs;
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error(
        `required data file missing: ${KB_PATH}. \u8BF7\u68C0\u67E5\u4ED3\u5E93\u662F\u5426\u5B8C\u6574 clone\uFF0C\u6216\u8BBE\u7F6E\u6B63\u786E\u7684\u76F8\u5BF9\u8DEF\u5F84\u3002`
      );
    }
    throw e;
  }
  if (kbCache && kbCache.mtimeMs === mtimeMs) return kbCache.entries;
  const entries = readJson(KB_PATH);
  kbCache = { mtimeMs, entries };
  return entries;
}
function warmData() {
  const index = questionIndex();
  const bank = quizBank();
  const entries = aiKb();
  return {
    quizTotal: Object.keys(index).length,
    categories: Object.keys(bank).length,
    kbEntries: entries.length
  };
}
function dataStats() {
  try {
    const index = questionIndex();
    return {
      quiz_total: Object.keys(index).length,
      quiz_categories: Object.keys(quizBank()).length,
      kb_entries: aiKb().length,
      data_ok: true
    };
  } catch (e) {
    console.warn("health: data file issue -> %s", e.message);
    return { quiz_total: 0, quiz_categories: 0, kb_entries: 0, data_ok: false };
  }
}

// src/routes/ai.ts
function kbMatch(question) {
  const q = question.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const item of aiKb()) {
    const score = (item.keywords ?? []).filter((k) => q.includes(k.toLowerCase())).length;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}
function registerAiRoutes(app2) {
  app2.post("/api/ai/ask", async (req) => {
    const raw = stringField(req.body, "question", { minLength: 1, maxLength: 500 });
    const question = raw.trim();
    const hit = kbMatch(question);
    if (hit) {
      return ok({
        answer: hit.answer,
        answer_content_type: "trusted_html",
        // 来自仓库内置 kb.json
        title: hit.title ?? null,
        source: "local_kb",
        model: null
      });
    }
    const mock = `<p>\u3010\u6A21\u62DF\u56DE\u7B54\u3011\u5DF2\u6536\u5230\u4F60\u7684\u63D0\u95EE\uFF1A\u300C${question}\u300D\u3002</p><p>\u5927\u6A21\u578B\u63A5\u53E3\u5C1A\u672A\u63A5\u5165\u3002\u5F53\u524D\u540E\u7AEF\u5185\u7F6E\u4E86\u672C\u5730\u77E5\u8BC6\u5E93\uFF0C\u4F60\u53EF\u4EE5\u6362\u4E2A\u5305\u542B<b>\u6570\u636E\u7ED3\u6784\u672F\u8BED</b>\u7684\u95EE\u6CD5\uFF08\u4F8B\u5982\u300CKMP \u7684 next \u6570\u7EC4\u600E\u4E48\u6C42\u300D\u300C\u5FEB\u901F\u6392\u5E8F\u4E3A\u4EC0\u4E48\u6700\u574F O(n\xB2)\u300D\u300C\u5FAA\u73AF\u961F\u5217\u600E\u4E48\u5224\u6EE1\u300D\uFF09\uFF0C\u5C31\u80FD\u547D\u4E2D\u771F\u5B9E\u7B54\u6848\u3002</p><p class='text-muted'>\u63A5\u5165\u5927\u6A21\u578B\u540E\uFF0C\u672C\u63A5\u53E3\u5C06\u8FD4\u56DE\u771F\u5B9E\u89E3\u7B54\uFF0C\u524D\u7AEF\u65E0\u9700\u6539\u52A8\u3002</p>`;
    return ok({
      answer: mock,
      answer_content_type: "trusted_html",
      // 本函数硬编码生成，可信
      title: null,
      source: "mock",
      model: null
    });
  });
}

// ../web/src/engine/ops.table.json
var ops_table_default = {
  list: {
    build: {
      lines: [
        "head = NULL;",
        "s = malloc(...); s->data = x; s->next = NULL;",
        "tail->next = s;   // \u7A7A\u8868\u65F6: head = s",
        "tail = s;"
      ],
      structural: [
        0
      ],
      title: "\u5C3E\u63D2\u6CD5\u5EFA\u8868"
    },
    "delete-pos": {
      lines: [
        "if (pos < 1 || pos > n) error;",
        "if (pos == 1) { q = head; head = head->next; free(q); return; }",
        "p = head;",
        "for (i = 1; i < pos - 1; i++) p = p->next;   // \u8D70\u5230\u524D\u9A71",
        "q = p->next;",
        "p->next = q->next;      // \u6458\u94FE\uFF1A\u5148\u63A5\u540E\uFF0C\u518D\u91CA\u653E",
        "free(q);"
      ],
      structural: [],
      title: "\u6309\u4F4D\u5E8F\u5220\u9664"
    },
    "delete-value": {
      lines: [
        "prev = NULL;  p = head;",
        "while (p != NULL && p->data != x) {",
        "    prev = p;  p = p->next;",
        "}",
        "if (p == NULL) return NOT_FOUND;",
        "if (prev == NULL) head = p->next;",
        "else prev->next = p->next;",
        "free(p);"
      ],
      structural: [],
      title: "\u6309\u503C\u5220\u9664"
    },
    "insert-head": {
      lines: [
        "s = (Node *)malloc(sizeof(Node));",
        "s->data = x;",
        "s->next = head;",
        "head = s;"
      ],
      structural: [],
      title: "\u5934\u63D2\u6CD5\u63D2\u5165"
    },
    "insert-tail": {
      lines: [
        "s = (Node *)malloc(sizeof(Node));",
        "s->data = x;  s->next = NULL;",
        "if (head == NULL) { head = s; return; }",
        "p = head;",
        "while (p->next != NULL) p = p->next;",
        "p->next = s;"
      ],
      structural: [],
      title: "\u5C3E\u63D2\u6CD5\u63D2\u5165"
    },
    search: {
      lines: [
        "p = head;  pos = 1;",
        "while (p != NULL) {",
        "    if (p->data == x) return pos;",
        "    p = p->next;  pos++;",
        "}",
        "return -1;   // \u672A\u627E\u5230"
      ],
      structural: [],
      title: "\u6309\u503C\u67E5\u627E"
    },
    traverse: {
      lines: [
        "p = head;",
        "while (p != NULL) {",
        "    visit(p->data);",
        "    p = p->next;",
        "}"
      ],
      structural: [],
      title: "\u904D\u5386\u94FE\u8868"
    }
  },
  queue: {
    build: {
      lines: [
        "Q.front = Q.rear = 0;                     // \u7A7A\u961F",
        "for each x in \u8F93\u5165\u5E8F\u5217:",
        "    Q.data[Q.rear] = x;",
        "    Q.rear = (Q.rear + 1) % MaxSize;      // \u53D6\u6A21\u6210\u73AF"
      ],
      structural: [
        0
      ],
      title: "\u5EFA\u961F\uFF08\u9010\u4E2A\u5165\u961F\uFF09"
    },
    dequeue: {
      lines: [
        "if (Q.front == Q.rear) return ERROR;       // \u961F\u7A7A",
        "x = Q.data[Q.front];                       // \u2460 \u53D6\u961F\u5934\u5143\u7D20",
        "Q.front = (Q.front + 1) % MaxSize;         // \u2461 \u961F\u5934\u6307\u9488\u540E\u79FB",
        "return x;"
      ],
      structural: [],
      title: "\u51FA\u961F dequeue"
    },
    enqueue: {
      lines: [
        "if ((Q.rear + 1) % MaxSize == Q.front) return ERROR;  // \u961F\u6EE1",
        "Q.data[Q.rear] = x;                        // \u2460 \u5199\u5165\u961F\u5C3E\u4F4D\u7F6E",
        "Q.rear = (Q.rear + 1) % MaxSize;           // \u2461 \u961F\u5C3E\u6307\u9488\u540E\u79FB\uFF08\u53D6\u6A21\uFF09",
        "return OK;"
      ],
      structural: [],
      title: "\u5165\u961F enqueue"
    },
    peek: {
      lines: [
        "if (Q.front == Q.rear) return ERROR;       // \u961F\u7A7A",
        "return Q.data[Q.front];                    // \u53EA\u8BFB\uFF0Cfront \u4E0D\u52A8"
      ],
      structural: [],
      title: "\u8BFB\u961F\u5934 peek"
    },
    traverse: {
      lines: [
        "i = Q.front;",
        "while (i != Q.rear) { visit(Q.data[i]); i = (i + 1) % MaxSize; }"
      ],
      structural: [],
      title: "\u904D\u5386\uFF08\u961F\u5934 \u2192 \u961F\u5C3E\uFF09"
    }
  },
  stack: {
    build: {
      lines: [
        "S.top = -1;                               // \u7A7A\u6808",
        "for each x in \u8F93\u5165\u5E8F\u5217:",
        "    if (S.top == MaxSize - 1) return ERROR;",
        "    S.data[++S.top] = x;                  // \u6307\u9488\u5148\u52A0\u4E00\u518D\u5199\u5165"
      ],
      structural: [
        0
      ],
      title: "\u5EFA\u6808\uFF08\u9010\u4E2A\u5165\u6808\uFF09"
    },
    peek: {
      lines: [
        "if (S.top == -1) return ERROR;            // \u6808\u7A7A",
        "return S.data[S.top];                     // \u53EA\u8BFB\uFF0Ctop \u4E0D\u52A8"
      ],
      structural: [],
      title: "\u8BFB\u6808\u9876 peek"
    },
    pop: {
      lines: [
        "if (S.top == -1) return ERROR;            // \u6808\u7A7A\uFF0C\u65E0\u6CD5\u51FA\u6808",
        "x = S.data[S.top];                        // \u2460 \u5148\u53D6\u6808\u9876\u5143\u7D20",
        "S.top--;                                  // \u2461 \u6307\u9488\u518D\u4E0B\u79FB",
        "return x;"
      ],
      structural: [],
      title: "\u51FA\u6808 pop"
    },
    push: {
      lines: [
        "if (S.top == MaxSize - 1) return ERROR;   // \u6808\u6EE1\uFF0C\u65E0\u6CD5\u5165\u6808",
        "S.top++;                                  // \u2460 \u6808\u9876\u6307\u9488\u5148\u4E0A\u79FB",
        "S.data[S.top] = x;                        // \u2461 \u518D\u5199\u5165\u5143\u7D20",
        "return OK;"
      ],
      structural: [],
      title: "\u5165\u6808 push"
    },
    traverse: {
      lines: [
        "for (i = S.top; i >= 0; i--)",
        "    visit(S.data[i]);                     // \u4ECE\u6808\u9876\u5F80\u6808\u5E95"
      ],
      structural: [],
      title: "\u904D\u5386\uFF08\u81EA\u6808\u9876\u5411\u4E0B\uFF09"
    }
  }
};

// ../web/src/engine/ops.ts
var OPS = ops_table_default;

// ../web/src/engine/linkedlist.ts
var linkedlist_exports = {};
__export(linkedlist_exports, {
  ListNode: () => ListNode,
  MAX_NODES: () => MAX_NODES,
  OpError: () => OpError,
  TraceList: () => TraceList,
  Tracer: () => Tracer,
  opBuild: () => opBuild,
  opDeletePos: () => opDeletePos,
  opDeleteValue: () => opDeleteValue,
  opInsertHead: () => opInsertHead,
  opInsertTail: () => opInsertTail,
  opSearch: () => opSearch,
  opTraverse: () => opTraverse,
  resetIds: () => resetIds,
  statePayload: () => statePayload
});

// ../web/src/engine/seq.ts
var OpError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "OpError";
  }
};
var SeqTracer = class _SeqTracer {
  constructor(anchorKeys = []) {
    this.steps = [];
    this.visited = 0;
    this.moves = 0;
    this.compares = 0;
    this.ptr = {};
    this.aside = [];
    /** 与参考实现的 _visited_ids / _new_ids 同义，供各 op_* 直接 add */
    this.visitedIds = /* @__PURE__ */ new Set();
    this.newIds = /* @__PURE__ */ new Set();
    this.anchorLast = {};
    this.anchorKeys = [...anchorKeys];
  }
  /** 按容器既有顺序编号 a1, a2, … */
  static flat(items) {
    return items.map((it, i) => ({ id: it.id, value: it.value, label: `a${i + 1}` }));
  }
  /** aside 里的元素没有位序，label 留空 */
  static asideFlat(items) {
    return items.map((it) => ({ id: it.id, value: it.value, label: null }));
  }
  ptrJson() {
    const out = {};
    for (const key of Object.keys(this.ptr)) {
      const v = this.ptr[key];
      out[key] = typeof v === "object" && v !== null ? v.id : v;
    }
    return out;
  }
  mark(items, compare = [], remove = []) {
    const order = [
      ...items.map((it) => it.id),
      ...this.aside.map((it) => it.id)
    ];
    const keep = (ids) => order.filter((id) => ids.has(id));
    return {
      compare: keep(new Set(compare)),
      visited: keep(this.visitedIds),
      new: keep(this.newIds),
      remove: keep(new Set(remove))
    };
  }
  /** 补齐被整体重赋 ptr 时漏掉的锚点键（粘性回填） */
  reconcileAnchors() {
    for (const key of this.anchorKeys) {
      if (key in this.ptr) {
        const v = this.ptr[key];
        if (v !== null) {
          this.anchorLast[key] = v;
        }
      } else {
        this.ptr[key] = this.anchorLast[key] ?? "NULL";
      }
    }
  }
  push(items, line, info, opts = {}) {
    if (opts.ptr) this.ptr = { ...this.ptr, ...opts.ptr };
    if (opts.aside !== void 0) this.aside = [...opts.aside];
    this.reconcileAnchors();
    const step = {
      seq: this.steps.length,
      items: _SeqTracer.flat(items),
      aside: _SeqTracer.asideFlat(this.aside),
      ptr: this.ptrJson(),
      mark: this.mark(items, opts.compare, opts.remove),
      line,
      counters: {
        visited: this.visited,
        moves: this.moves,
        compares: this.compares
      },
      info
    };
    this.steps.push(step);
    return step;
  }
};
function seqMeta(OPS5, op, n, maxNodes) {
  const meta4 = OPS5[op];
  return {
    op,
    title: meta4.title,
    code: { lines: [...meta4.lines], structural: [...meta4.structural] },
    length: n,
    max_nodes: maxNodes,
    trace: null
  };
}
function seqStatePayload(container, maxNodes, extra) {
  const payload = {
    op: "state",
    length: container.length(),
    max_nodes: maxNodes,
    items: container.toItems(),
    trace: []
  };
  if (extra) {
    return { ...payload, ...extra };
  }
  return payload;
}
function pyListRepr(values) {
  return `[${values.join(", ")}]`;
}

// ../web/src/engine/linkedlist.ts
var OPS2 = OPS.list;
var MAX_NODES = 12;
var idSeq = 1;
function resetIds() {
  idSeq = 1;
}
var ListNode = class {
  constructor(value) {
    this.next = null;
    this.id = `n${idSeq++}`;
    this.value = value;
  }
};
var Tracer = class _Tracer {
  constructor() {
    this.steps = [];
    this.visited = 0;
    this.moves = 0;
    this.compares = 0;
    this.ptr = {};
    this.aside = [];
    this.visitedIds = /* @__PURE__ */ new Set();
    this.newIds = /* @__PURE__ */ new Set();
  }
  /** 主链快照：顺序即逻辑顺序，标签 a1、a2… */
  static chain(head) {
    const out = [];
    let p = head;
    let i = 1;
    while (p) {
      out.push({ id: p.id, value: p.value, label: `a${i}` });
      p = p.next;
      i += 1;
    }
    return out;
  }
  /** aside 结点没有位序标签，label 留空 */
  static flat(nodes) {
    return nodes.map((n) => ({ id: n.id, value: n.value, label: null }));
  }
  ptrJson() {
    const out = {};
    for (const key of Object.keys(this.ptr)) {
      const v = this.ptr[key];
      out[key] = typeof v === "object" && v !== null ? v.id : v;
    }
    return out;
  }
  mark(head, compare = [], remove = []) {
    const order = [];
    let p = head;
    while (p) {
      order.push(p.id);
      p = p.next;
    }
    for (const n of this.aside) order.push(n.id);
    const keep = (ids) => order.filter((id) => ids.has(id));
    return {
      compare: keep(new Set(compare)),
      visited: keep(this.visitedIds),
      new: keep(this.newIds),
      remove: keep(new Set(remove))
    };
  }
  push(head, line, info, opts = {}) {
    if (opts.ptr) this.ptr = { ...this.ptr, ...opts.ptr };
    if (opts.aside !== void 0) this.aside = [...opts.aside];
    this.ptr.head = head;
    const snap = {
      seq: this.steps.length,
      nodes: _Tracer.chain(head),
      aside: _Tracer.flat(this.aside),
      head: head ? head.id : null,
      ptr: this.ptrJson(),
      mark: this.mark(head, opts.compare, opts.remove),
      line,
      counters: {
        visited: this.visited,
        moves: this.moves,
        compares: this.compares
      },
      info
    };
    this.steps.push(snap);
    return snap;
  }
};
function countNodes(head) {
  let n = 0;
  let p = head;
  while (p) {
    n += 1;
    p = p.next;
  }
  return n;
}
function lastLength(t) {
  return t.steps[t.steps.length - 1].nodes.length;
}
function meta(op, head) {
  const m = OPS2[op];
  return {
    op,
    title: m.title,
    code: { lines: [...m.lines], structural: [...m.structural] },
    length: countNodes(head),
    max_nodes: MAX_NODES,
    trace: null
  };
}
function checkCapacity(head) {
  if (countNodes(head) >= MAX_NODES) {
    throw new OpError(`\u7ED3\u70B9\u6570\u5DF2\u8FBE\u4E0A\u9650 ${MAX_NODES}\uFF0C\u8BF7\u5148\u5220\u9664\u4E00\u4E9B\u7ED3\u70B9`);
  }
}
function posOf(head, target) {
  let i = 1;
  let p = head;
  while (p) {
    if (p === target) return i;
    p = p.next;
    i += 1;
  }
  return -1;
}
function opBuild(lst, values) {
  if (values.length > MAX_NODES) {
    throw new OpError(`\u6700\u591A\u652F\u6301 ${MAX_NODES} \u4E2A\u7ED3\u70B9\uFF0C\u6536\u5230 ${values.length} \u4E2A`);
  }
  const t = new Tracer();
  lst.head = null;
  t.ptr = { head: null };
  t.push(null, 0, "\u4ECE\u7A7A\u8868\u5F00\u59CB\uFF1Ahead = NULL");
  let tail = null;
  for (const x of values) {
    const s = new ListNode(x);
    t.newIds.add(s.id);
    t.aside = [s];
    t.ptr = { s };
    t.push(lst.head, 1, `\u7533\u8BF7\u65B0\u7ED3\u70B9 s\uFF0C\u5199\u5165\u6570\u636E ${x}\uFF0Cnext \u7F6E\u4E3A NULL`);
    if (tail === null) {
      lst.head = s;
      t.aside = [];
      t.ptr = { head: s, s: null };
      t.push(lst.head, 2, "\u94FE\u8868\u4E3A\u7A7A\uFF1Ahead \u76F4\u63A5\u6307\u5411 s", { compare: [s.id] });
    } else {
      tail.next = s;
      t.aside = [];
      t.ptr = { s: null };
      t.push(lst.head, 2, `\u5C3E\u7ED3\u70B9\u7684 next \u63A5\u4E0A s\uFF08${tail.value} \u2192 ${x}\uFF09`, {
        compare: [s.id]
      });
    }
    tail = s;
    t.push(lst.head, 3, `${x} \u5DF2\u5165\u94FE\uFF0Ctail \u540E\u79FB`, { ptr: { tail: s } });
  }
  t.ptr = { tail: null };
  t.push(lst.head, null, `\u5EFA\u8868\u5B8C\u6210\uFF0C\u5171 ${values.length} \u4E2A\u7ED3\u70B9`);
  const out = meta("build", lst.head);
  out.trace = t.steps;
  return out;
}
function opInsertHead(lst, value) {
  checkCapacity(lst.head);
  const t = new Tracer();
  const oldHead = lst.head;
  const s = new ListNode(value);
  t.newIds.add(s.id);
  t.aside = [s];
  t.ptr = { s };
  t.push(lst.head, 0, "\u7533\u8BF7\u65B0\u7ED3\u70B9 s\uFF08\u8FD8\u6CA1\u63A5\u5165\u94FE\u8868\uFF09");
  t.push(lst.head, 1, `s->data = ${value}`);
  s.next = oldHead;
  t.ptr = { s };
  t.push(
    lst.head,
    2,
    "s->next = head\uFF1As \u5DF2\u63A5\u4E0A\u539F\u94FE\uFF0C\u4F46 head \u8FD8\u6307\u7740\u65E7\u9996\u5143\u7ED3\u70B9",
    { compare: [s.id] }
  );
  lst.head = s;
  t.aside = [];
  t.ptr = { s: null, head: s };
  t.push(lst.head, 3, "head = s\uFF1A\u5934\u63D2\u5B8C\u6210\uFF0Cs \u6210\u4E3A\u65B0\u7684\u9996\u5143\u7ED3\u70B9", {
    compare: [s.id]
  });
  t.push(lst.head, null, `\u5934\u63D2 ${value} \u5B8C\u6210\uFF0C\u5F53\u524D\u8868\u957F ${lastLength(t)}`);
  const out = meta("insert-head", lst.head);
  out.trace = t.steps;
  return out;
}
function opInsertTail(lst, value) {
  checkCapacity(lst.head);
  const t = new Tracer();
  const s = new ListNode(value);
  t.newIds.add(s.id);
  t.aside = [s];
  t.ptr = { s };
  t.push(lst.head, 0, "\u7533\u8BF7\u65B0\u7ED3\u70B9 s\uFF0Cdata \u4E0E next \u90FD\u5DF2\u5C31\u7EEA");
  if (lst.head === null) {
    lst.head = s;
    t.aside = [];
    t.ptr = { head: s, s: null };
    t.push(lst.head, 2, "\u94FE\u8868\u4E3A\u7A7A\uFF1Ahead \u76F4\u63A5\u6307\u5411 s", { compare: [s.id] });
  } else {
    t.push(lst.head, 3, "p = head\uFF0C\u4ECE\u5934\u5F00\u59CB\u627E\u5C3E\u7ED3\u70B9", { ptr: { p: lst.head } });
    let p = lst.head;
    while (p.next !== null) {
      const nxt = p.next;
      t.moves += 1;
      t.visitedIds.add(p.id);
      t.ptr = { p: nxt };
      t.push(
        lst.head,
        4,
        `p->next \u4E0D\u4E3A\u7A7A\uFF0Cp \u540E\u79FB\u5230\u7B2C ${posOf(lst.head, nxt)} \u4E2A\u7ED3\u70B9`,
        { compare: [p.id], ptr: { p: nxt } }
      );
      p = nxt;
    }
    t.push(lst.head, 4, "p->next == NULL\uFF1Ap \u5C31\u662F\u5C3E\u7ED3\u70B9", { compare: [p.id] });
    p.next = s;
    t.aside = [];
    t.ptr = { p, s: null };
    t.push(lst.head, 5, `p->next = s\uFF1A${p.value} \u63A5\u4E0A ${value}`, {
      compare: [p.id, s.id]
    });
  }
  t.push(lst.head, null, `\u5C3E\u63D2 ${value} \u5B8C\u6210\uFF0C\u5F53\u524D\u8868\u957F ${lastLength(t)}`);
  const out = meta("insert-tail", lst.head);
  out.trace = t.steps;
  return out;
}
function opDeletePos(lst, pos) {
  const n = countNodes(lst.head);
  if (pos < 1 || pos > n) {
    throw new OpError(`\u4F4D\u5E8F ${pos} \u8D8A\u754C\uFF0C\u5F53\u524D\u94FE\u8868\u957F\u5EA6\u4E3A ${n}`);
  }
  const t = new Tracer();
  t.push(lst.head, null, `\u5220\u9664\u7B2C ${pos} \u4E2A\u7ED3\u70B9\uFF1A\u5148\u627E\u5230\u5B83\uFF08\u6216\u5B83\u7684\u524D\u9A71\uFF09`);
  if (pos === 1) {
    const q = lst.head;
    t.ptr = { q, head: lst.head };
    t.push(lst.head, 1, "pos = 1\uFF1A\u5220\u7684\u662F\u9996\u5143\u7ED3\u70B9\uFF0Cq = head", {
      compare: [q.id],
      remove: [q.id]
    });
    lst.head = q.next;
    t.ptr = { q, head: q.next };
    t.aside = [q];
    t.push(lst.head, 1, "head = head->next\uFF1Ahead \u8D8A\u8FC7 q\uFF0Cq \u5DF2\u79BB\u5F00\u4E3B\u94FE", {
      remove: [q.id]
    });
    t.ptr = { q: null };
    t.aside = [];
    t.push(lst.head, 1, "free(q)\uFF1A\u7ED3\u70B9\u5360\u7528\u7684\u5185\u5B58\u5F52\u8FD8\u7CFB\u7EDF");
  } else {
    let p = lst.head;
    t.ptr = { p };
    t.push(lst.head, 2, "p = head\uFF0C\u51C6\u5907\u8D70\u5230\u524D\u9A71\uFF08\u7B2C pos-1 \u4E2A\u7ED3\u70B9\uFF09");
    for (let i = 1; i < pos - 1; i += 1) {
      const nxt = p.next;
      t.moves += 1;
      t.visitedIds.add(p.id);
      t.ptr = { p: nxt };
      t.push(lst.head, 3, `p \u540E\u79FB\u5230\u7B2C ${i + 1} \u4E2A\u7ED3\u70B9`, { compare: [p.id] });
      p = nxt;
    }
    t.push(lst.head, 3, `p \u505C\u5728\u524D\u9A71\uFF08\u7B2C ${pos - 1} \u4E2A\u7ED3\u70B9\uFF09`, {
      compare: [p.id]
    });
    const q = p.next;
    t.ptr = { p, q };
    t.push(lst.head, 4, `q = p->next\uFF1Aq \u6307\u5411\u5F85\u5220\u9664\u7684\u7B2C ${pos} \u4E2A\u7ED3\u70B9`, {
      compare: [p.id, q.id],
      remove: [q.id]
    });
    p.next = q.next;
    t.ptr = { p, q };
    t.aside = [q];
    t.push(lst.head, 5, "p->next = q->next\uFF1A\u6458\u94FE\u5B8C\u6210\uFF0Cq \u5DF2\u79BB\u5F00\u4E3B\u94FE", {
      remove: [q.id]
    });
    t.ptr = { q: null };
    t.aside = [];
    t.push(
      lst.head,
      6,
      "free(q)\uFF1A\u5148\u6458\u94FE\uFF0C\u518D\u91CA\u653E\u2014\u2014\u987A\u5E8F\u53CD\u4E86\u4F1A\u4E22\u6389\u540E\u9762\u7684\u94FE"
    );
  }
  t.push(lst.head, null, `\u5220\u9664\u5B8C\u6210\uFF0C\u5F53\u524D\u8868\u957F ${lastLength(t)}`);
  const out = meta("delete-pos", lst.head);
  out.trace = t.steps;
  return out;
}
function opDeleteValue(lst, value) {
  const t = new Tracer();
  let prev = null;
  let p = lst.head;
  t.ptr = { prev: null, p };
  t.push(lst.head, 0, "prev = NULL\uFF0Cp = head\uFF0C\u53CC\u6307\u9488\u5F00\u59CB\u627E\u503C");
  let found = null;
  let pos = 1;
  while (p !== null) {
    t.compares += 1;
    if (p.value === value) {
      t.push(
        lst.head,
        2,
        `p->data == ${value}\uFF1A\u547D\u4E2D\uFF0C\u662F\u7B2C ${pos} \u4E2A\u7ED3\u70B9`,
        { compare: [p.id], remove: [p.id] }
      );
      found = p;
      break;
    }
    t.visitedIds.add(p.id);
    t.push(lst.head, 2, `\u7B2C ${pos} \u4E2A\u7ED3\u70B9\u662F ${p.value} \u2260 ${value}\uFF0C\u7EE7\u7EED`, {
      compare: [p.id]
    });
    prev = p;
    p = p.next;
    pos += 1;
    t.moves += 1;
    t.ptr = { prev, p: p ?? "NULL" };
    t.push(
      lst.head,
      3,
      p ? "prev = p\uFF0Cp = p->next\uFF1A\u53CC\u6307\u9488\u540C\u6B65\u540E\u79FB" : "p \u5DF2\u8D70\u5230 NULL\uFF0C\u94FE\u91CC\u6CA1\u6709\u8FD9\u4E2A\u503C",
      { ptr: { prev, p: p ?? "NULL" } }
    );
  }
  if (found === null) {
    t.push(lst.head, 4, `\u94FE\u8868\u4E2D\u4E0D\u5B58\u5728\u503C\u4E3A ${value} \u7684\u7ED3\u70B9\uFF0C\u5220\u9664\u5931\u8D25`);
    throw new OpError(`\u94FE\u8868\u4E2D\u4E0D\u5B58\u5728\u503C\u4E3A ${value} \u7684\u7ED3\u70B9`);
  }
  if (prev === null) {
    lst.head = found.next;
    t.ptr = { prev: null, p: found };
    t.aside = [found];
    t.push(lst.head, 5, "prev \u4E3A\u7A7A\uFF1A\u5220\u7684\u662F\u9996\u5143\u7ED3\u70B9\uFF0Chead = p->next", {
      remove: [found.id]
    });
  } else {
    prev.next = found.next;
    t.ptr = { prev, p: found };
    t.aside = [found];
    t.push(lst.head, 6, "prev->next = p->next\uFF1A\u6458\u94FE\uFF0Cp \u79BB\u5F00\u4E3B\u94FE", {
      remove: [found.id]
    });
  }
  t.ptr = { p: null };
  t.aside = [];
  t.push(lst.head, 7, "free(p)\uFF1A\u91CA\u653E\u5DF2\u6458\u4E0B\u7684\u7ED3\u70B9");
  t.push(lst.head, null, `\u5220\u9664\u503C ${value} \u5B8C\u6210\uFF0C\u5F53\u524D\u8868\u957F ${lastLength(t)}`);
  const out = meta("delete-value", lst.head);
  out.trace = t.steps;
  return out;
}
function opSearch(lst, value) {
  const t = new Tracer();
  let p = lst.head;
  t.ptr = { p };
  let pos = 1;
  t.push(lst.head, 0, `p = head\uFF0C\u4ECE\u7B2C 1 \u4E2A\u7ED3\u70B9\u5F00\u59CB\u627E ${value}`);
  while (p !== null) {
    t.compares += 1;
    if (p.value === value) {
      t.push(
        lst.head,
        2,
        `p->data == ${value}\uFF1A\u5728\u7B2C ${pos} \u4E2A\u7ED3\u70B9\u627E\u5230\uFF0C\u8FD4\u56DE ${pos}`,
        { compare: [p.id] }
      );
      t.push(lst.head, 2, `\u67E5\u627E\u6210\u529F\uFF1A${value} \u4F4D\u4E8E\u7B2C ${pos} \u4E2A\u7ED3\u70B9`, {
        compare: [p.id]
      });
      const out2 = meta("search", lst.head);
      out2.result = { found: true, pos };
      out2.trace = t.steps;
      return out2;
    }
    t.visitedIds.add(p.id);
    t.push(lst.head, 2, `\u7B2C ${pos} \u4E2A\u7ED3\u70B9\u662F ${p.value} \u2260 ${value}\uFF0C\u7EE7\u7EED`, {
      compare: [p.id]
    });
    p = p.next;
    pos += 1;
    t.moves += 1;
    t.ptr = { p: p ?? "NULL" };
    t.push(
      lst.head,
      3,
      p ? `p = p->next\uFF0C\u8D70\u5230\u7B2C ${pos} \u4E2A` : "p = p->next\uFF0Cp \u53D8\u6210 NULL",
      { ptr: { p: p ?? "NULL" } }
    );
  }
  t.push(lst.head, 5, `p \u8D70\u5230 NULL \u4ECD\u672A\u547D\u4E2D\uFF1A\u8FD4\u56DE -1\uFF0C\u94FE\u8868\u4E2D\u6CA1\u6709 ${value}`);
  const out = meta("search", lst.head);
  out.result = { found: false, pos: -1 };
  out.trace = t.steps;
  return out;
}
function opTraverse(lst) {
  const t = new Tracer();
  let p = lst.head;
  t.ptr = { p };
  t.push(lst.head, 0, "p = head\uFF0C\u4ECE\u5934\u5F00\u59CB\u904D\u5386");
  const seen = [];
  while (p !== null) {
    seen.push(p.value);
    t.visitedIds.add(p.id);
    t.push(lst.head, 2, `visit(p->data)\uFF1A\u8BBF\u95EE\u7B2C ${seen.length} \u4E2A\u7ED3\u70B9\uFF0C\u503C ${p.value}`, {
      compare: [p.id]
    });
    p = p.next;
    t.moves += 1;
    t.ptr = { p: p ?? "NULL" };
    t.push(
      lst.head,
      3,
      p ? "p = p->next" : "p = p->next\uFF0Cp \u4E3A NULL\uFF0C\u904D\u5386\u7ED3\u675F",
      { ptr: { p: p ?? "NULL" } }
    );
  }
  const done = seen.length ? `\u904D\u5386\u5B8C\u6210\uFF1A${seen.join(" \u2192 ")} \u2192 NULL` : "\u7A7A\u8868\uFF0C\u65E0\u7ED3\u70B9\u53EF\u8BBF\u95EE";
  t.push(lst.head, null, done);
  const out = meta("traverse", lst.head);
  out.result = { values: seen };
  out.trace = t.steps;
  return out;
}
var TraceList = class {
  constructor(values = []) {
    this.head = null;
    let tail = null;
    for (const v of values) {
      const node = new ListNode(v);
      if (tail === null) this.head = node;
      else tail.next = node;
      tail = node;
    }
  }
  appendRaw(value) {
    const node = new ListNode(value);
    if (this.head === null) {
      this.head = node;
      return;
    }
    let p = this.head;
    while (p.next) p = p.next;
    p.next = node;
  }
  toNodes() {
    return Tracer.chain(this.head);
  }
  length() {
    return countNodes(this.head);
  }
  values() {
    const out = [];
    let p = this.head;
    while (p) {
      out.push(p.value);
      p = p.next;
    }
    return out;
  }
  clear() {
    this.head = null;
  }
};
function statePayload(lst) {
  return {
    op: "state",
    length: lst.length(),
    max_nodes: MAX_NODES,
    nodes: lst.toNodes(),
    trace: []
  };
}

// ../web/src/engine/queue.ts
var queue_exports = {};
__export(queue_exports, {
  CAPACITY: () => CAPACITY,
  MAX_ITEMS: () => MAX_ITEMS,
  OpError: () => OpError,
  QueueItem: () => QueueItem,
  TraceQueue: () => TraceQueue,
  opBuild: () => opBuild2,
  opDequeue: () => opDequeue,
  opEnqueue: () => opEnqueue,
  opPeek: () => opPeek,
  opTraverse: () => opTraverse2,
  resetIds: () => resetIds2,
  statePayload: () => statePayload2
});
var OPS3 = OPS.queue;
var MAX_ITEMS = 10;
var CAPACITY = MAX_ITEMS;
var ANCHORS = ["front", "rear"];
var idSeq2 = 1;
function resetIds2() {
  idSeq2 = 1;
}
var QueueItem = class {
  constructor(value) {
    this.id = `q${idSeq2++}`;
    this.value = value;
  }
};
var TraceQueue = class {
  constructor(values = []) {
    this.items = values.map((v) => new QueueItem(v));
  }
  front() {
    return this.items.length ? this.items[0] : null;
  }
  rear() {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }
  length() {
    return this.items.length;
  }
  values() {
    return this.items.map((it) => it.value);
  }
  toItems() {
    return SeqTracer.flat(this.items);
  }
  /** 环形缓冲示意：front/rear 都按「数组下标」给出，便于前端画环 */
  ring() {
    const used = this.items.length;
    return {
      capacity: CAPACITY,
      used,
      front: 0,
      rear: used % CAPACITY,
      full: used >= CAPACITY - 1
    };
  }
};
function meta2(op, n) {
  return seqMeta(OPS3, op, n, MAX_ITEMS - 1);
}
function opBuild2(q, values) {
  if (values.length > CAPACITY - 1) {
    throw new OpError(`\u6700\u591A\u652F\u6301 ${CAPACITY - 1} \u4E2A\u5143\u7D20\uFF0C\u6536\u5230 ${values.length} \u4E2A`);
  }
  const t = new SeqTracer(ANCHORS);
  q.items = [];
  t.ptr = { front: "NULL", rear: "NULL", x: null };
  t.push(
    q.items,
    0,
    `\u521D\u59CB\u5316\uFF1AQ.front = Q.rear = 0\uFF0C\u7A7A\u961F\uFF08\u5BB9\u91CF ${CAPACITY}\uFF0C\u727A\u7272\u4E00\u4E2A\u5355\u5143\uFF09`
  );
  for (const x of values) {
    const item = new QueueItem(x);
    t.newIds.add(item.id);
    t.ptr = { x: item };
    t.push(q.items, 1, `\u51C6\u5907\u5165\u961F\uFF1Ax = ${x}`, { aside: [item] });
    q.items.push(item);
    t.moves += 1;
    t.ptr = { front: q.front(), rear: item, x: null };
    t.push(q.items, 2, `Q.data[Q.rear] = ${x}\uFF1A\u5199\u5165\u961F\u5C3E`, {
      compare: [item.id]
    });
    t.aside = [];
    t.push(
      q.items,
      3,
      `Q.rear = (Q.rear + 1) % ${CAPACITY}\uFF1B\u5F53\u524D\u961F\u5217\uFF1A${pyListRepr(q.values())}`
    );
  }
  const out = meta2("build", q.length());
  out.result = { values: q.values() };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}
function opEnqueue(q, value) {
  if (q.length() >= CAPACITY - 1) {
    throw new OpError(
      `\u961F\u6EE1\uFF1A\u5FAA\u73AF\u961F\u5217\u6700\u591A\u653E ${CAPACITY - 1} \u4E2A\u5143\u7D20\uFF08\u5BB9\u91CF ${CAPACITY}\uFF0C\u727A\u7272\u4E00\u4E2A\u5355\u5143\uFF09`
    );
  }
  const t = new SeqTracer(ANCHORS);
  const item = new QueueItem(value);
  t.newIds.add(item.id);
  t.ptr = { front: q.front(), rear: q.rear(), x: item };
  t.push(q.items, 0, `\u51C6\u5907\u5165\u961F\uFF1Ax = ${value}`, { aside: [item] });
  t.compares += 1;
  t.push(
    q.items,
    0,
    `\u68C0\u67E5\u961F\u6EE1\uFF1A(rear+1) % ${CAPACITY} != front\uFF0C\u53EF\u5165\u961F\uFF08\u5DF2\u7528 ${q.length()}/${CAPACITY - 1}\uFF09`,
    { compare: [item.id] }
  );
  q.items.push(item);
  t.ptr = { front: q.front(), rear: item, x: item };
  t.push(q.items, 1, `Q.data[Q.rear] = ${value}\uFF1A\u5199\u5230\u961F\u5C3E\u4F4D\u7F6E`, {
    compare: [item.id]
  });
  t.moves += 1;
  t.aside = [];
  t.ptr = { front: q.front(), rear: item, x: null };
  t.push(q.items, 2, `Q.rear = (Q.rear + 1) % ${CAPACITY}\uFF1A\u961F\u5C3E\u6307\u9488\u540E\u79FB\u4E00\u683C`, {
    compare: [item.id]
  });
  t.push(
    q.items,
    3,
    `\u5165\u961F\u5B8C\u6210\uFF0C\u5F53\u524D\u961F\u5217\uFF1A${pyListRepr(q.values())}\uFF08\u5DE6\u7AEF\u4E3A\u961F\u5934\uFF09`
  );
  const out = meta2("enqueue", q.length());
  out.result = { value, values: q.values() };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}
function opDequeue(q) {
  if (!q.items.length) {
    throw new OpError("\u961F\u7A7A\uFF0C\u65E0\u6CD5\u51FA\u961F");
  }
  const t = new SeqTracer(ANCHORS);
  const head = q.front();
  t.ptr = { front: head, rear: q.rear(), x: null };
  t.push(q.items, 0, `\u51C6\u5907\u51FA\u961F\uFF1A\u5F53\u524D\u961F\u5934 = ${head.value}`);
  t.compares += 1;
  t.push(q.items, 0, "\u68C0\u67E5\u961F\u7A7A\uFF1Afront != rear\uFF0C\u961F\u975E\u7A7A", { compare: [head.id] });
  t.ptr = { front: head, rear: q.rear(), x: head };
  t.push(q.items, 1, `x = Q.data[Q.front]\uFF1A\u53D6\u5230\u961F\u5934\u5143\u7D20 ${head.value}`, {
    remove: [head.id]
  });
  q.items.shift();
  t.moves += 1;
  const newHead = q.front();
  t.ptr = { front: newHead ?? "NULL", rear: q.rear() ?? "NULL", x: head };
  t.push(
    q.items,
    2,
    `Q.front = (Q.front + 1) % ${CAPACITY}\uFF1A${newHead === null ? "\u961F\u5DF2\u7A7A\uFF0Cfront = rear" : `\u65B0\u961F\u5934\u4E3A ${newHead.value}`}`,
    { aside: [head], remove: [head.id] }
  );
  t.aside = [];
  t.ptr = { front: newHead ?? "NULL", rear: q.rear() ?? "NULL", x: null };
  t.push(
    q.items,
    3,
    `\u51FA\u961F\u5B8C\u6210\uFF0C\u8FD4\u56DE ${head.value}\uFF1B\u5F53\u524D\u961F\u5217\uFF1A${pyListRepr(q.values())}`
  );
  const out = meta2("dequeue", q.length());
  out.result = { value: head.value, values: q.values() };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}
function opPeek(q) {
  if (!q.items.length) {
    throw new OpError("\u961F\u7A7A\uFF0C\u8BFB\u4E0D\u5230\u961F\u5934");
  }
  const t = new SeqTracer(ANCHORS);
  const head = q.front();
  t.ptr = { front: head, rear: q.rear(), x: null };
  t.push(q.items, 0, "\u68C0\u67E5\u961F\u7A7A\uFF1Afront != rear\uFF0C\u961F\u975E\u7A7A", { compare: [head.id] });
  t.compares += 1;
  t.push(
    q.items,
    1,
    `return Q.data[Q.front]\uFF1A\u961F\u5934\u662F ${head.value}\uFF1Bfront \u4E0D\u52A8`,
    { compare: [head.id] }
  );
  const out = meta2("peek", q.length());
  out.result = { value: head.value };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}
function opTraverse2(q) {
  const t = new SeqTracer(ANCHORS);
  if (!q.items.length) {
    t.ptr = { front: "NULL", rear: "NULL" };
    t.push(q.items, null, "\u7A7A\u961F\uFF0C\u6CA1\u6709\u53EF\u8BBF\u95EE\u7684\u5143\u7D20");
    const out2 = meta2("traverse", 0);
    out2.result = { values: [] };
    out2.trace = t.steps;
    stampRing(out2, q);
    return out2;
  }
  const seen = [];
  q.items.forEach((it, i) => {
    t.visited += 1;
    t.visitedIds.add(it.id);
    t.ptr = { front: q.front(), rear: q.rear(), x: it };
    t.push(q.items, 0, `i = ${i}\uFF1A\u4ECE\u961F\u5934\u6570\u7B2C ${i + 1} \u4E2A`, {
      compare: [it.id]
    });
    seen.push(it.value);
    t.moves += 1;
    t.push(q.items, 1, `visit(Q.data[${i}])\uFF1A\u8BBF\u95EE\u5230 ${it.value}`, {
      compare: [it.id]
    });
  });
  t.ptr = { front: q.front(), rear: q.rear(), x: null };
  t.push(
    q.items,
    null,
    `\u904D\u5386\u5B8C\u6210\uFF08\u961F\u5934 \u2192 \u961F\u5C3E\uFF09\uFF1A${seen.join(" \u2192 ")}`
  );
  const out = meta2("traverse", q.length());
  out.result = { values: seen };
  out.trace = t.steps;
  stampRing(out, q);
  return out;
}
function stampRing(out, q) {
  const ring = q.ring();
  out.ring = ring;
  for (const s of out.trace ?? []) {
    s.ring = ring;
  }
}
function statePayload2(q) {
  return seqStatePayload(q, MAX_ITEMS - 1, { ring: q.ring() });
}

// ../web/src/engine/stack.ts
var stack_exports = {};
__export(stack_exports, {
  MAX_ITEMS: () => MAX_ITEMS2,
  OpError: () => OpError,
  StackItem: () => StackItem,
  TraceStack: () => TraceStack,
  opBuild: () => opBuild3,
  opPeek: () => opPeek2,
  opPop: () => opPop,
  opPush: () => opPush,
  opTraverse: () => opTraverse3,
  resetIds: () => resetIds3,
  statePayload: () => statePayload3
});
var OPS4 = OPS.stack;
var MAX_ITEMS2 = 10;
var ANCHORS2 = ["top"];
var idSeq3 = 1;
function resetIds3() {
  idSeq3 = 1;
}
var StackItem = class {
  constructor(value) {
    this.id = `k${idSeq3++}`;
    this.value = value;
  }
};
var TraceStack = class {
  constructor(values = []) {
    this.items = values.map((v) => new StackItem(v));
  }
  top() {
    return this.items.length ? this.items[this.items.length - 1] : null;
  }
  length() {
    return this.items.length;
  }
  values() {
    return this.items.map((it) => it.value);
  }
  toItems() {
    return SeqTracer.flat(this.items);
  }
};
function meta3(op, n) {
  return seqMeta(OPS4, op, n, MAX_ITEMS2);
}
function opBuild3(st, values) {
  if (values.length > MAX_ITEMS2) {
    throw new OpError(`\u6700\u591A\u652F\u6301 ${MAX_ITEMS2} \u4E2A\u5143\u7D20\uFF0C\u6536\u5230 ${values.length} \u4E2A`);
  }
  const t = new SeqTracer(ANCHORS2);
  st.items = [];
  t.ptr = { top: "NULL", x: null };
  t.push(st.items, 0, "\u521D\u59CB\u5316\uFF1AS.top = -1\uFF0C\u7A7A\u6808");
  for (const x of values) {
    const item = new StackItem(x);
    t.newIds.add(item.id);
    t.ptr = { x: item };
    t.push(st.items, 1, `\u51C6\u5907\u5165\u6808\uFF1Ax = ${x}`, { aside: [item] });
    t.compares += 1;
    t.push(
      st.items,
      2,
      `\u6808\u672A\u6EE1\uFF08top = ${st.items.length - 1}\uFF0C\u5BB9\u91CF ${MAX_ITEMS2}\uFF09`,
      { compare: [item.id] }
    );
    st.items.push(item);
    t.moves += 1;
    t.ptr = { top: item, x: null };
    t.push(st.items, 3, `S.data[++S.top] = ${x}\uFF1A${x} \u6210\u4E3A\u65B0\u6808\u9876`, {
      compare: [item.id]
    });
    t.aside = [];
    t.push(
      st.items,
      3,
      `\u5165\u6808\u5B8C\u6210\uFF0C\u5F53\u524D\u6808\uFF1A${pyListRepr(st.values())}\uFF08\u53F3\u7AEF\u4E3A\u6808\u9876\uFF09`,
      { ptr: { x: null } }
    );
  }
  const out = meta3("build", st.length());
  out.result = { values: st.values() };
  out.trace = t.steps;
  return out;
}
function opPush(st, value) {
  if (st.length() >= MAX_ITEMS2) {
    throw new OpError(`\u6808\u6EE1\uFF1A\u5DF2\u8FBE\u4E0A\u9650 ${MAX_ITEMS2} \u4E2A\u5143\u7D20\uFF0C\u8BF7\u5148\u51FA\u6808`);
  }
  const t = new SeqTracer(ANCHORS2);
  const item = new StackItem(value);
  t.newIds.add(item.id);
  t.ptr = { top: st.top(), x: item };
  t.push(st.items, 0, `\u51C6\u5907\u5165\u6808\uFF1Ax = ${value}`, { aside: [item] });
  t.compares += 1;
  t.push(
    st.items,
    0,
    `\u68C0\u67E5\u6808\u6EE1\uFF1Atop = ${st.length() - 1} < ${MAX_ITEMS2 - 1}\uFF0C\u672A\u6EE1`,
    { compare: [item.id] }
  );
  t.moves += 1;
  t.ptr = { top: item, x: item };
  t.push(st.items, 1, "S.top++\uFF1A\u6808\u9876\u6307\u9488\u5148\u4E0A\u79FB\u4E00\u683C", { compare: [item.id] });
  st.items.push(item);
  t.ptr = { top: item, x: null };
  t.push(st.items, 2, `S.data[S.top] = ${value}\uFF1A\u5199\u5165\u65B0\u6808\u9876`, {
    compare: [item.id]
  });
  t.aside = [];
  t.push(
    st.items,
    3,
    `\u5165\u6808\u5B8C\u6210\uFF0C\u5F53\u524D\u6808\uFF1A${pyListRepr(st.values())}\uFF08\u53F3\u7AEF\u4E3A\u6808\u9876\uFF09`
  );
  const out = meta3("push", st.length());
  out.result = { value, values: st.values() };
  out.trace = t.steps;
  return out;
}
function opPop(st) {
  if (!st.items.length) {
    throw new OpError("\u6808\u7A7A\uFF0C\u65E0\u6CD5\u51FA\u6808");
  }
  const t = new SeqTracer(ANCHORS2);
  const top = st.top();
  t.ptr = { top, x: null };
  t.push(st.items, 0, `\u51C6\u5907\u51FA\u6808\uFF1A\u5F53\u524D\u6808\u9876 = ${top.value}`);
  t.compares += 1;
  t.push(st.items, 0, "\u68C0\u67E5\u6808\u7A7A\uFF1Atop != -1\uFF0C\u6808\u975E\u7A7A", { compare: [top.id] });
  t.ptr = { top, x: top };
  t.push(st.items, 1, `x = S.data[S.top]\uFF1A\u53D6\u5230\u6808\u9876\u5143\u7D20 ${top.value}`, {
    remove: [top.id]
  });
  st.items.pop();
  t.moves += 1;
  const newTop = st.top();
  t.ptr = { top: newTop ?? "NULL", x: top };
  t.push(
    st.items,
    2,
    `S.top--\uFF1A${newTop === null ? "\u6808\u5DF2\u7A7A\uFF0Ctop = -1" : `\u65B0\u6808\u9876\u4E3A ${newTop.value}`}`,
    { aside: [top], remove: [top.id] }
  );
  t.aside = [];
  t.ptr = { top: newTop ?? "NULL", x: null };
  t.push(
    st.items,
    3,
    `\u51FA\u6808\u5B8C\u6210\uFF0C\u8FD4\u56DE ${top.value}\uFF1B\u5F53\u524D\u6808\uFF1A${pyListRepr(st.values())}`
  );
  const out = meta3("pop", st.length());
  out.result = { value: top.value, values: st.values() };
  out.trace = t.steps;
  return out;
}
function opPeek2(st) {
  if (!st.items.length) {
    throw new OpError("\u6808\u7A7A\uFF0C\u8BFB\u4E0D\u5230\u6808\u9876");
  }
  const t = new SeqTracer(ANCHORS2);
  const top = st.top();
  t.ptr = { top, x: null };
  t.push(st.items, 0, "\u68C0\u67E5\u6808\u7A7A\uFF1Atop != -1\uFF0C\u6808\u975E\u7A7A", { compare: [top.id] });
  t.compares += 1;
  t.push(st.items, 1, `return S.data[S.top]\uFF1A\u6808\u9876\u662F ${top.value}\uFF1Btop \u6307\u9488\u4E0D\u52A8`, {
    compare: [top.id]
  });
  const out = meta3("peek", st.length());
  out.result = { value: top.value };
  out.trace = t.steps;
  return out;
}
function opTraverse3(st) {
  const t = new SeqTracer(ANCHORS2);
  if (!st.items.length) {
    t.ptr = { top: "NULL" };
    t.push(st.items, null, "\u7A7A\u6808\uFF0C\u6CA1\u6709\u53EF\u8BBF\u95EE\u7684\u5143\u7D20");
    const out2 = meta3("traverse", 0);
    out2.result = { values: [] };
    out2.trace = t.steps;
    return out2;
  }
  const seen = [];
  for (let i = st.items.length - 1; i >= 0; i -= 1) {
    const it = st.items[i];
    t.visited += 1;
    t.visitedIds.add(it.id);
    t.ptr = { top: st.top(), x: it };
    t.push(
      st.items,
      0,
      `i = ${i}\uFF1A\u4ECE\u6808\u9876\u5F80\u6808\u5E95\u6570\u7B2C ${seen.length + 1} \u4E2A`,
      { compare: [it.id] }
    );
    seen.push(it.value);
    t.moves += 1;
    t.push(st.items, 1, `visit(S.data[${i}])\uFF1A\u8BBF\u95EE\u5230 ${it.value}`, {
      compare: [it.id]
    });
  }
  t.ptr = { top: st.top(), x: null };
  t.push(
    st.items,
    null,
    `\u904D\u5386\u5B8C\u6210\uFF08\u6808\u9876 \u2192 \u6808\u5E95\uFF09\uFF1A${seen.join(" \u2192 ")}`
  );
  const out = meta3("traverse", st.length());
  out.result = { values: seen };
  out.trace = t.steps;
  return out;
}
function statePayload3(st) {
  return seqStatePayload(st, MAX_ITEMS2);
}

// src/session.ts
var SID_RE = /^[A-Za-z0-9_-]{1,64}$/;
var TTL_MS = SESSION_TTL_SEC * 1e3;
var store = /* @__PURE__ */ new Map();
function normalizeSid(raw) {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return "default";
  const sid3 = value.trim();
  if (!SID_RE.test(sid3)) {
    console.warn("rejected invalid X-Session-Id %j -> 'default'", value.slice(0, 80));
    return "default";
  }
  return sid3;
}
function create() {
  return {
    list: new linkedlist_exports.TraceList([]),
    stack: new stack_exports.TraceStack([]),
    queue: new queue_exports.TraceQueue([]),
    quizStats: {},
    expiresAt: 0
  };
}
function sweepExpired(now) {
  for (const [key, session] of store) {
    if (session.expiresAt > now) break;
    store.delete(key);
  }
}
function getSession(rawSid) {
  const sid3 = normalizeSid(rawSid);
  const now = Date.now();
  sweepExpired(now);
  const hit = store.get(sid3);
  if (hit) {
    store.delete(sid3);
    hit.expiresAt = now + TTL_MS;
    store.set(sid3, hit);
    return hit;
  }
  const fresh = create();
  fresh.expiresAt = now + TTL_MS;
  store.set(sid3, fresh);
  while (store.size > SESSION_MAX) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  return fresh;
}
function sessionCount() {
  return store.size;
}
function sessionStats() {
  return { active: store.size, max: SESSION_MAX, ttl_sec: SESSION_TTL_SEC };
}

// src/routes/health.ts
var START = Date.now();
function registerHealthRoutes(app2) {
  app2.get(
    "/api/health",
    async () => ok({
      service: "\u6570\u636E\u7ED3\u6784\u5B66\u4E60\u5E73\u53F0\u540E\u7AEF",
      version: "1.1.0",
      // 对外契约版本号；改动同步 tests/http-contract.golden.json
      uptime_sec: Math.round((Date.now() - START) / 100) / 10,
      sessions: sessionCount(),
      session_policy: sessionStats(),
      ...dataStats()
    })
  );
}

// src/routes/quiz.ts
var LETTERS = "ABCD";
function sid(req) {
  return req.headers["x-session-id"];
}
function round1(x) {
  const scaled = x * 10;
  const floor = Math.floor(scaled);
  const frac = scaled - floor;
  if (Math.abs(frac - 0.5) < 1e-9) {
    return (floor % 2 === 0 ? floor : floor + 1) / 10;
  }
  return Math.round(scaled) / 10;
}
function registerQuizRoutes(app2) {
  app2.get("/api/quiz/categories", async () => {
    const bank = quizBank();
    const categories = Object.entries(bank).map(([key, cat]) => ({
      key,
      name: cat.name ?? key,
      count: (cat.questions ?? []).length
    }));
    return ok({
      categories,
      total: categories.reduce((sum, c) => sum + c.count, 0)
    });
  });
  app2.get("/api/quiz/questions", async (req) => {
    const category = queryField(req.query, "category");
    const bank = quizBank();
    if (!Object.prototype.hasOwnProperty.call(bank, category)) {
      return err(`\u672A\u77E5\u5206\u7C7B ${category}\uFF0C\u53EF\u7528\uFF1A${Object.keys(bank).join(", ")}`);
    }
    const questions = (bank[category].questions ?? []).map((q, i) => ({
      id: `${category}-${i + 1}`,
      tag: q.tag ?? "",
      question: q.q,
      options: q.opts,
      // 4 个选项，下标 0~3 对应 A~D
      difficulty: q.diff ?? "mid"
      // basic / mid / hard
    }));
    return ok({
      category,
      name: bank[category].name ?? category,
      total: questions.length,
      questions
    });
  });
  app2.post("/api/quiz/submit", async (req) => {
    const questionId = stringField(req.body, "question_id", { minLength: 1, maxLength: 64 });
    const answer = intField(req.body, "answer", { min: 0, max: 3 });
    const q = questionIndex()[questionId];
    if (!q) return err(`\u9898\u76EE\u4E0D\u5B58\u5728\uFF1A${questionId}`);
    const correct = answer === q.ans;
    const session = getSession(sid(req));
    const stat = session.quizStats[q.category] ??= { done: 0, right: 0 };
    stat.done += 1;
    if (correct) stat.right += 1;
    return ok({
      question_id: q.id,
      difficulty: q.diff ?? "mid",
      correct,
      answer_index: q.ans,
      answer_letter: LETTERS[q.ans],
      answer_text: q.opts[q.ans],
      explanation: q.exp,
      explanation_content_type: "trusted_html",
      key_point: q.key,
      key_point_content_type: "trusted_html",
      msg: correct ? "\u2705 \u56DE\u7B54\u6B63\u786E\uFF01" : `\u274C \u56DE\u7B54\u9519\u8BEF\uFF0C\u6B63\u786E\u7B54\u6848\u662F ${LETTERS[q.ans]}`
    });
  });
  app2.get("/api/quiz/stats", async (req) => {
    const stats = getSession(sid(req)).quizStats;
    const categories = {};
    let totalDone = 0;
    let totalRight = 0;
    for (const [key, v] of Object.entries(stats)) {
      categories[key] = {
        done: v.done,
        right: v.right,
        accuracy: v.done ? round1(v.right / v.done * 100) : 0
      };
      totalDone += v.done;
      totalRight += v.right;
    }
    return ok({ categories, total_done: totalDone, total_right: totalRight });
  });
}

// src/routes/trace.ts
var SPECS = {
  list: {
    routeBase: "/api/linkedlist",
    moduleName: "linkedlist",
    maxNodes: linkedlist_exports.MAX_NODES,
    valuesMax: linkedlist_exports.MAX_NODES
  },
  stack: {
    routeBase: "/api/stack",
    moduleName: "stack",
    maxNodes: stack_exports.MAX_ITEMS,
    valuesMax: stack_exports.MAX_ITEMS
  },
  queue: {
    routeBase: "/api/queue",
    moduleName: "queue",
    // 循环队列牺牲一个单元来区分空与满，所以对外报的容量是 CAPACITY - 1
    maxNodes: queue_exports.CAPACITY - 1,
    valuesMax: queue_exports.MAX_ITEMS
  }
};
var KINDS = ["list", "stack", "queue"];
function sid2(req) {
  return req.headers["x-session-id"];
}
function runOp(kind, session, op, body) {
  if (kind === "list") {
    const c2 = session.list;
    switch (op) {
      case "build":
        return linkedlist_exports.opBuild(c2, intArrayField(body, "values", SPECS.list.valuesMax));
      case "insert-head":
        return linkedlist_exports.opInsertHead(c2, intField(body, "value", { min: -9999, max: 9999 }));
      case "insert-tail":
        return linkedlist_exports.opInsertTail(c2, intField(body, "value", { min: -9999, max: 9999 }));
      case "delete-pos":
        return linkedlist_exports.opDeletePos(c2, intField(body, "pos", { min: 1 }));
      case "delete-value":
        return linkedlist_exports.opDeleteValue(c2, intField(body, "value", { min: -9999, max: 9999 }));
      case "search":
        return linkedlist_exports.opSearch(c2, intField(body, "value", { min: -9999, max: 9999 }));
      case "traverse":
        return linkedlist_exports.opTraverse(c2);
      default:
        return null;
    }
  }
  if (kind === "stack") {
    const c2 = session.stack;
    switch (op) {
      case "build":
        return stack_exports.opBuild(c2, intArrayField(body, "values", SPECS.stack.valuesMax));
      case "push":
        return stack_exports.opPush(c2, intField(body, "value", { min: -9999, max: 9999 }));
      case "pop":
        return stack_exports.opPop(c2);
      case "peek":
        return stack_exports.opPeek(c2);
      case "traverse":
        return stack_exports.opTraverse(c2);
      default:
        return null;
    }
  }
  const c = session.queue;
  switch (op) {
    case "build":
      return queue_exports.opBuild(c, intArrayField(body, "values", SPECS.queue.valuesMax));
    case "enqueue":
      return queue_exports.opEnqueue(c, intField(body, "value", { min: -9999, max: 9999 }));
    case "dequeue":
      return queue_exports.opDequeue(c);
    case "peek":
      return queue_exports.opPeek(c);
    case "traverse":
      return queue_exports.opTraverse(c);
    default:
      return null;
  }
}
function statePayload4(kind, session) {
  if (kind === "list") return linkedlist_exports.statePayload(session.list);
  if (kind === "stack") return stack_exports.statePayload(session.stack);
  return queue_exports.statePayload(session.queue);
}
function opsPayload(kind) {
  const spec = SPECS[kind];
  const table = OPS[kind];
  return {
    module: spec.moduleName,
    max_nodes: spec.maxNodes,
    ops: Object.keys(table).map((key) => ({
      key,
      title: table[key].title,
      lines: table[key].lines,
      structural: table[key].structural
    }))
  };
}
function registerTraceRoutes(app2) {
  for (const kind of KINDS) {
    const spec = SPECS[kind];
    app2.get(`${spec.routeBase}/ops`, async () => ok(opsPayload(kind)));
    app2.get(`${spec.routeBase}/trace/state`, async (req) => {
      const session = getSession(sid2(req));
      return ok(statePayload4(kind, session));
    });
    for (const op of Object.keys(OPS[kind])) {
      app2.post(`${spec.routeBase}/trace/${op}`, async (req) => {
        const session = getSession(sid2(req));
        try {
          const payload = runOp(kind, session, op, req.body);
          if (payload === null) {
            return err(`\u63A5\u53E3\u4E0D\u5B58\u5728\uFF1A${spec.routeBase}/trace/${op}`);
          }
          return ok(payload);
        } catch (e) {
          if (e instanceof OpError) return err(e.message);
          throw e;
        }
      });
    }
  }
}

// src/app.ts
function buildApp() {
  const app2 = Fastify({
    logger: { level: LOG_LEVEL },
    // 本项目最大请求体是 build 的 values（12 个整数），1MB 已是极宽松的上限
    bodyLimit: 1024 * 1024
  });
  app2.setNotFoundHandler((req, reply) => {
    const pathname = new URL(req.raw.url ?? "/", "http://localhost").pathname;
    if (pathname.startsWith("/api/")) {
      return reply.code(404).send({ code: 1, msg: `\u63A5\u53E3\u4E0D\u5B58\u5728\uFF1A${pathname}`, data: null });
    }
    return reply.code(404).send({ code: 1, msg: "\u8D44\u6E90\u4E0D\u5B58\u5728", data: null });
  });
  app2.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) {
      return reply.code(error.status).send({ code: 1, msg: error.message, data: null, detail: error.detail });
    }
    const e = error;
    const status = e.statusCode ?? 500;
    if (status === 400) {
      return reply.code(422).send({ code: 1, msg: "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON", data: null });
    }
    if (status < 500) {
      return reply.code(status).send({ code: 1, msg: e.message ?? "\u8BF7\u6C42\u5931\u8D25", data: null });
    }
    req.log.error({ err: error }, "\u672A\u6355\u83B7\u5F02\u5E38");
    return reply.code(500).send({ code: 1, msg: "\u670D\u52A1\u5668\u5185\u90E8\u9519\u8BEF", data: null });
  });
  app2.register(cors, {
    origin: allowedOrigins(),
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-Session-Id"],
    exposedHeaders: ["X-Session-Id"],
    credentials: false
  });
  app2.get("/visual.html", async (_req, reply) => reply.redirect("/list.html", 302));
  registerHealthRoutes(app2);
  registerTraceRoutes(app2);
  registerQuizRoutes(app2);
  registerAiRoutes(app2);
  if (existsSync2(STATIC_DIR)) {
    app2.register(fastifyStatic, {
      root: STATIC_DIR,
      prefix: "/",
      index: ["index.html"]
    });
    app2.log.info(`\u9759\u6001\u6258\u7BA1\uFF1A${STATIC_DIR}`);
  } else {
    app2.log.warn(`\u9759\u6001\u76EE\u5F55\u4E0D\u5B58\u5728\uFF0C\u4EC5\u63D0\u4F9B API\uFF1A${STATIC_DIR}`);
  }
  return app2;
}

// src/main.ts
try {
  const stats = warmData();
  console.log(
    `[lectai] \u6570\u636E\u5DF2\u5C31\u7EEA\uFF1A${stats.categories} \u4E2A\u5206\u7C7B / ${stats.quizTotal} \u9898 / \u77E5\u8BC6\u5E93 ${stats.kbEntries} \u6761`
  );
} catch (e) {
  console.error("[lectai] \u542F\u52A8\u5931\u8D25\uFF1A\u6570\u636E\u6587\u4EF6\u4E0D\u53EF\u7528 \u2192", e.message);
  process.exit(1);
}
var app = buildApp();
try {
  await app.listen({ host: HOST, port: PORT });
} catch (e) {
  app.log.error({ err: e }, "\u76D1\u542C\u5931\u8D25");
  process.exit(1);
}
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    app.log.info(`\u6536\u5230 ${signal}\uFF0C\u6B63\u5728\u5173\u95ED`);
    void app.close().then(() => process.exit(0));
  });
}
//# sourceMappingURL=server.mjs.map
