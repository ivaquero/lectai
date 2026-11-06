/* ==========================================================================
   core/offline.js —— 后端不可达时的本地降级层（自动降级）
   --------------------------------------------------------------------------
   职责：把 DS.offline 提供成一个与后端契约一致的「离线应答器」。api.js 在
   fetch 失败 / probe 探测到离线时，把请求转交 handle()，命中则直接返回
   与线上完全同形的 {ok,data,msg}，前端各页（刷题 / 答疑 / 首页统计）无感切换。

   数据来自 core/offline-data.js 的 DS.OFFLINE（生成脚本见 backend/tools）。

   ★ 边界：
     · 只管题库 / 答疑 / 健康三类接口。链表·栈·队列的 trace 接口不在离线范围
       （算法在 Python 侧，不做 JS 移植），handle() 返回 null → 维持原「离线」提示。
     · 刷题统计 done/right 存内存（刷新即清零），与后端「内存态、重启即清空」一致。
     · 线上（后端可达）时本模块完全不出场，取题接口也永不掺答案 —— 防作弊不变。
   ========================================================================== */
(function () {
  'use strict';

  var DS = (window.DS = window.DS || {});
  // P-005：offline-data.js 现在可能尚未加载（改为按需动态注入），这里只做个初始引用，
  // 真正就绪与否以 loadSnapshot() 之后的 O 为准。
  var O = DS.OFFLINE || null;
  var _loadP = null;

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

    return null; // trace / 其它接口不降级，交回上层走原离线提示
  }

  /** 快照是否已就绪（offline-data.js 是否加载） */
  function available() { return !!O; }

  /* ============================ 按需注入快照（P-005） ============================
     offline-data.js 体积不小（约 78KB），过去在 index/quiz/ai 三页无条件同步加载，
     即使后端在线也会白下载一份用不到的数据。现在改为：只有 api.js 的 probe() 探测到
     后端离线、且本页声明了 data-offline-snapshot 时，才动态注入这段脚本。

     coreDir() 靠扫描当前文档里 core/offline.js 自身的 <script src> 反推目录，
     这样脚本前缀（assets/js/… 或带版本串）改了也不用同步维护；找不到再退回默认路径。 */
  function coreDir() {
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || '';
      var at = src.indexOf('core/offline.js');
      if (at !== -1) return src.slice(0, at) + 'core/';
    }
    return 'assets/js/core/';
  }

  function loadSnapshot() {
    if (O) return Promise.resolve(true);
    if (_loadP) return _loadP;
    _loadP = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = coreDir() + 'offline-data.js';
      s.async = true;
      var done = function () {
        s.onload = s.onerror = null;
        O = (window.DS || {}).OFFLINE || null;
        resolve(!!O);
      };
      s.onload = done;
      s.onerror = function () { done(); };
      document.head.appendChild(s);
    });
    return _loadP;
  }

  DS.offline = {
    available: available,
    handle: handle,
    enable: enable,
    disable: disable,
    loadSnapshot: loadSnapshot,
    ensureSnapshot: loadSnapshot,
    get active() { return active; }
  };
})();
