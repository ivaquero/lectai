/* ==========================================================================
   core/offline.js —— 后端不可达时的本地降级层（自动降级）
   --------------------------------------------------------------------------
   职责：把 DS.offline 提供成一个与后端契约一致的「离线应答器」。api.js 在
   fetch 失败 / probe 探测到离线时，把请求转交 handle()，命中则直接返回
   与线上完全同形的 {ok,data,msg}，前端各页（刷题 / 答疑 / 首页统计）无感切换。

   数据来自 core/offline-data.js 的 DS.OFFLINE（生成脚本见 tools/gen-offline-data.mjs）。

   本模块管两件事：
     1) 题库 / 答疑 / 健康 —— 数据来自 core/offline-data.js 的本地快照；
     2) 链表 / 栈 / 队列的轨迹 —— 由 src/engine（与冻结参考实现逐字节对齐的
        TS 引擎）现场生成，见 src/engine/offline.ts。

   ★ 边界：
     · 轨迹引擎是按需加载的独立 chunk：页面声明 data-offline-trace 且真的需要时
       才下载，在线期间一个字节都不拉。
     · 刷题统计 done/right 存内存（刷新即清零），与后端「内存态、重启即清空」一致。
     · 线上（后端可达）时本模块不出场，取题接口也永不掺答案 —— 防作弊不变。
     · 唯一一处不完全等价：本地容器是「值序列」，不保留服务端会话里的历史轨迹。
   ========================================================================== */
(function () {
  'use strict';

  var DS = (window.DS = window.DS || {});
  // P-005：offline-data.js 现在可能尚未加载（改为按需动态注入），这里只做个初始引用，
  // 真正就绪与否以 loadSnapshot() 之后的 O 为准。
  var O = DS.OFFLINE || null;
  var _loadP = null;

  /* 轨迹引擎（src/engine）的动态句柄。T 为空表示 chunk 尚未加载；
     _seed 收集「在线期间后端最后一次给出的容器值」，离线启用时灌进本地容器，
     这样断网那一刻画布不会被重置成空表。 */
  var T = null;
  var _traceP = null;
  var _seed = {};

  var LETTERS = 'ABCD';

  // 客户端刷题统计：catKey -> {done, right}
  var stats = {};

  var active = false;

  function enable() { active = true; }
  function disable() { active = false; }

  function ok(data, msg) { return { ok: true, data: data, msg: msg || 'ok' }; }
  function err(msg) { return { ok: false, data: null, msg: msg }; }

  /* ============================ 健康 ============================ */

  function health() {
    return ok({
      service: '数据结构学习平台 · 离线快照',
      version: '1.1.0-offline',
      offline: true,
      quiz_total: O.meta.quiz_total,
      quiz_categories: O.meta.quiz_categories,
      kb_entries: O.meta.kb_entries,
      data_ok: true
    });
  }

  /* ============================ 题库 ============================ */

  function categories() {
    return ok({ categories: O.categories, total: O.meta.quiz_total });
  }

  function questions(category) {
    var found = null;
    for (var i = 0; i < O.categories.length; i++) {
      if (O.categories[i].key === category) { found = O.categories[i]; break; }
    }
    if (!found) {
      var keys = O.categories.map(function (c) { return c.key; }).join(', ');
      return err('未知分类 ' + category + '，可用：' + keys);
    }
    // 只给渲染需要的字段，和线上 /api/quiz/questions 完全同形（不含答案）
    var list = [];
    Object.keys(O.questions).forEach(function (qid) {
      var q = O.questions[qid];
      if (q.category !== category) return;
      list.push({
        id: q.id,
        tag: q.tag,
        question: q.question,
        options: q.options,
        difficulty: q.difficulty
      });
    });
    // qid 形如 `${cat}-${i}`，按题号数值排序
    list.sort(function (a, b) {
      return Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]);
    });
    return ok({
      category: category,
      name: found.name,
      total: list.length,
      questions: list
    });
  }

  function submit(body) {
    var qid = body && body.question_id;
    var rec = qid && O.questions[qid];
    if (!rec) return err('题目不存在：' + qid);

    var picked = body.answer;
    var correct = picked === rec.answer;

    var cat = rec.category;
    var s = (stats[cat] = stats[cat] || { done: 0, right: 0 });
    s.done += 1;
    if (correct) s.right += 1;

    return ok({
      question_id: rec.id,
      difficulty: rec.difficulty,
      correct: correct,
      answer_index: rec.answer,
      answer_letter: LETTERS[rec.answer],
      answer_text: rec.options[rec.answer],
      explanation: rec.explanation,
      explanation_content_type: 'trusted_html',
      key_point: rec.key_point,
      key_point_content_type: 'trusted_html',
      offline: true,
      msg: correct
        ? '✅ 回答正确！（离线判题）'
        : '❌ 回答错误，正确答案是 ' + LETTERS[rec.answer] + '（离线判题）'
    });
  }

  function statsResp() {
    var cats = {};
    var totalDone = 0;
    var totalRight = 0;
    Object.keys(stats).forEach(function (k) {
      var v = stats[k];
      cats[k] = {
        done: v.done,
        right: v.right,
        accuracy: v.done ? Math.round((v.right / v.done) * 1000) / 10 : 0
      };
      totalDone += v.done;
      totalRight += v.right;
    });
    return ok({ categories: cats, total_done: totalDone, total_right: totalRight });
  }

  /* ============================ 答疑 ============================ */

  function kbMatch(question) {
    var q = String(question || '').toLowerCase();
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < O.kb.length; i++) {
      var item = O.kb[i];
      var score = 0;
      var kws = item.keywords || [];
      for (var j = 0; j < kws.length; j++) {
        if (q.indexOf(String(kws[j]).toLowerCase()) !== -1) score += 1;
      }
      if (score > bestScore) { bestScore = score; best = item; }
    }
    return best;
  }

  function ask(body) {
    var question = String((body && body.question) || '').trim();
    var hit = kbMatch(question);
    if (hit) {
      return ok({
        answer: hit.answer,
        answer_content_type: 'trusted_html',
        title: hit.title,
        source: 'local_kb',
        model: null,
        offline: true
      });
    }
    var mock =
      "<p>【模拟回答 · 离线】已收到你的提问：「" + question + '】。</p>' +
      '<p>当前未连接后端，本地知识库未命中该问法。' +
      '你可以换个包含<b>数据结构术语</b>的问法（例如「KMP 的 next 数组怎么求」' +
      '「快速排序为什么最坏 O(n²)」「循环队列怎么判满」），就能命中本地知识库的真实答案。</p>' +
      "<p class='text-muted'>离线模式仅内置本地知识库（" + O.meta.kb_entries + ' 条）；' +
      '连上大模型后未命中会转真实解答。</p>';
    return ok({
      answer: mock,
      answer_content_type: 'trusted_html',
      title: null,
      source: 'mock',
      model: null,
      offline: true
    });
  }

  /* ============================ 路由 ============================ */

  /**
   * @param {string} method  GET/POST
   * @param {string} path    含 query 的接口路径，如 /api/quiz/questions?category=list
   * @param {any}    body    POST 请求体
   * @returns {{ok:boolean,data:any,msg:string}|null} 命中返回应答，不命中返回 null
   */
  function handle(method, path, body) {
    /* 轨迹接口优先问本地引擎：即使题库快照没加载（O 为空）也能接管 */
    if (T) {
      var local = T.handle(method, path, body);
      if (local) return local;
    }
    if (!O) return null;
    var m = (method || 'GET').toUpperCase();
    var u;
    try { u = new URL(path, 'http://offline.local'); } catch (e) { return null; }
    var p = u.pathname;

    if (m === 'GET' && p === '/api/health') return health();
    if (m === 'GET' && p === '/api/quiz/categories') return categories();
    if (m === 'GET' && p === '/api/quiz/questions') {
      return questions(u.searchParams.get('category') || '');
    }
    if (m === 'POST' && p === '/api/quiz/submit') return submit(body);
    if (m === 'GET' && p === '/api/quiz/stats') return statsResp();
    if (m === 'POST' && p === '/api/ai/ask') return ask(body);

    return null; // 其它接口不降级，交回上层走原离线提示
  }

  /** 快照是否已就绪（offline-data.js 是否加载） */
  function available() { return !!O; }

  /** 本地轨迹引擎是否已就绪 */
  function traceAvailable() { return !!T; }

  /* ============================ 轨迹引擎 ============================ */

  /** 按需加载 src/engine 的桥接层（Vite 切成独立 chunk，在线时从不下载） */
  function ensureTrace() {
    if (T) return Promise.resolve(true);
    if (_traceP) return _traceP;
    _traceP = import('../../../src/engine/offline')
      .then(function (mod) {
        T = mod;
        /* 把在线期间记下的「后端最后状态」灌进本地容器，断网可无缝续演 */
        if (Object.keys(_seed).length) T.seed(_seed);
        return true;
      })
      .catch(function () {
        _traceP = null; // 允许重试
        return false;
      });
    return _traceP;
  }

  /**
   * 在线期间记录后端给出的容器值。
   * 只做内存暂存（不碰 sessionStorage，键归引擎所有），也不触发 chunk 下载。
   * @param {string} path 请求路径
   * @param {any} data    后端应答的 data
   */
  function remember(path, data) {
    var m = /^\/api\/(linkedlist|stack|queue)\//.exec(String(path || ''));
    if (!m) return;
    var kind = m[1] === 'linkedlist' ? 'list' : m[1];
    var trace = data && data.trace;
    var step = trace && trace.length ? trace[trace.length - 1] : data;
    var items = step && (step.nodes || step.items);
    if (!Array.isArray(items)) return;
    _seed[kind] = items.map(function (it) { return it.value; });
    if (T) T.seed(_seed);
  }

  /** 本页是否声明了某类离线能力（属性和机身一致：data-offline-snapshot / -trace） */
  function capable(kind) {
    var attr = kind === 'trace' ? 'data-offline-trace' : 'data-offline-snapshot';
    return !!(
      (document.documentElement && document.documentElement.hasAttribute(attr)) ||
      (document.body && document.body.hasAttribute(attr))
    );
  }

  /**
   * 异步版 handle()：按路径准备所需的本地资源后再应答。
   * api.js 的 fetch 失败分支用它（那一刻才知道要降级，来不及预先加载）。
   */
  async function serve(method, path, body) {
    var p = '';
    try { p = new URL(path, 'http://offline.local').pathname; } catch (e) { /* 保持空 */ }
    if (/^\/api\/(linkedlist|stack|queue)\//.test(p)) {
      if (capable('trace')) await ensureTrace();
    } else if (capable('snapshot')) {
      await loadSnapshot();
    }
    return handle(method, path, body);
  }

  /* ============================ 按需加载快照（P-005） ============================
     offline-data.js 体积不小（约 78KB），过去在 index/quiz/ai 三页无条件同步加载，
     即使后端在线也会白下载一份用不到的数据。现在改为：只有 api.js 的 probe() 探测到
     后端离线、且本页声明了 data-offline-snapshot 时，才动态加载这份数据。

     ★ Vite 化后改动（原 coreDir() 已删除）★
     旧实现靠扫描文档里 core/offline.js 自己的 <script src> 反推目录，再动态插一条
     <script>。改为单入口打包后，页面上不再存在该标签，路径反推必然失败，离线快照会
     在生产构建里静默加载不出来。改用 ESM 动态 import()：
       · dev / 原生 ESM —— 浏览器按相对模块路径加载；
       · 构建 —— Vite 切成独立 chunk，78KB 仍只在离线时才下载。 */
  function loadSnapshot() {
    if (O) return Promise.resolve(true);
    if (_loadP) return _loadP;
    _loadP = import('./offline-data.js')
      .then(function () {
        O = (window.DS || {}).OFFLINE || null;
        return !!O;
      })
      .catch(function () {
        _loadP = null; // 允许下一次重试
        return false;
      });
    return _loadP;
  }

  DS.offline = {
    available: available,
    traceAvailable: traceAvailable,
    capable: capable,
    handle: handle,
    serve: serve,
    remember: remember,
    ensureTrace: ensureTrace,
    enable: enable,
    disable: disable,
    loadSnapshot: loadSnapshot,
    ensureSnapshot: loadSnapshot,
    get active() { return active; }
  };
})();
