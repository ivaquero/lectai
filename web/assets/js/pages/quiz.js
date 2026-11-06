/* ==========================================================================
   pages/quiz.js —— 刷题页
   --------------------------------------------------------------------------
   在线：取题不返回答案（防作弊），判题/解析走后端 /api/quiz/submit。
   离线：api.js 自动降级到 core/offline-data.js 本地快照，取题/判题/解析/统计
        全部本地完成（答案只存在于离线段，联网时不掺答案，防作弊原则不变）。
        后端彻底不可达且无离线快照时，才给出明确提示、不静默失败。
   ========================================================================== */
(function () {
  'use strict';

  const DS = window.DS;
  const $ = DS.$;
  const $$ = DS.$$;
  const el = DS.el;

  const LETTERS = ['A', 'B', 'C', 'D'];

  // 后端 difficulty 值 → 中文标签 + 配色类（q-diff--*）
  const DIFF = {
    basic: { label: '基础', cls: 'q-diff--basic' },
    mid: { label: '中等', cls: 'q-diff--mid' },
    hard: { label: '挑战', cls: 'q-diff--hard' }
  };

  const state = {
    cats: [],
    cat: null,
    name: '',
    questions: [],
    idx: 0,
    picked: null,               // 当前题已选下标（未提交）
    results: {},                // qid -> { picked, correct }
    submitted: false            // 当前题是否已提交
  };

  /* ============================ 加载 ============================ */

  async function loadCats() {
    const r = await DS.api.get('/api/quiz/categories');
    if (!r.ok) return false;
    state.cats = r.data.categories || [];
    renderCats();
    if (state.cats.length) selectCat(state.cats[0].key);
    return true;
  }

  async function loadQuestions(cat) {
    const r = await DS.api.get('/api/quiz/questions?category=' + encodeURIComponent(cat));
    if (!r.ok) {
      DS.toast.danger(r.msg || '题目加载失败');
      return false;
    }
    state.questions = r.data.questions || [];
    state.name = r.data.name || '';
    state.idx = 0;
    state.picked = null;
    state.submitted = false;
    $('#cat-note').textContent = state.name + ' · ' + state.questions.length + ' 题';
    buildSheet();
    renderQ();
    updateProgress();
    return true;
  }

  function selectCat(key) {
    if (state.cat === key) return;
    state.cat = key;
    $$('#cat-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.cat === key));
    loadQuestions(key);
  }

  function renderCats() {
    const host = $('#cat-tabs');
    host.innerHTML = '';
    state.cats.forEach((c) => {
      host.appendChild(el('button.tab', {
        type: 'button',
        role: 'tab',
        dataset: { cat: c.key },
        onclick: () => selectCat(c.key)
      }, [el('b', { text: c.name }), el('span', { text: c.count + ' 题' })]));
    });
  }

  /* ============================ 渲染 ============================ */

  function cur() { return state.questions[state.idx] || null; }

  function renderQ() {
    const q = cur();
    const res = q ? state.results[q.id] : null;

    $('#q-no').textContent = q ? (state.idx + 1) + ' / ' + state.questions.length + '　' + q.id : '–';
    const tag = $('#q-tag');
    if (q && q.tag) { tag.textContent = q.tag; tag.hidden = false; }
    else tag.hidden = true;

    const diff = $('#q-diff');
    const dinfo = q && DIFF[q.difficulty];
    if (dinfo) {
      diff.textContent = dinfo.label;
      diff.className = 'q-diff ' + dinfo.cls;
      diff.hidden = false;
    } else {
      diff.className = 'q-diff';
      diff.hidden = true;
    }

    $('#q-text').textContent = q ? q.question : '这个分类暂时没有题目';

    // 选项
    const box = $('#opts');
    box.innerHTML = '';
    state.picked = res ? res.picked : null;
    state.submitted = !!res;

    (q ? q.options : []).forEach((text, i) => {
      const b = el('button.opt', {
        type: 'button',
        onclick: () => pick(i)
      }, [
        el('span.abc', { text: LETTERS[i] }),
        el('span.txt', { text: text })
      ]);
      if (res) {
        // 已提交：锁定并按结果着色
        b.disabled = true;
        if (i === res.answerIndex) b.classList.add('right');
        else if (i === res.picked) b.classList.add('wrong');
        else b.classList.add('dim');
      } else if (i === state.picked) {
        b.classList.add('picked');
      }
      box.appendChild(b);
    });

    // 解析区
    const v = $('#verdict');
    if (res) {
      v.classList.add('show');
      const line = $('#verdict-line');
      line.className = 'verdict-line ' + (res.correct ? 'ok' : 'bad');
      line.textContent = res.correct ? '✓ 回答正确' : '✗ 回答错误，正确答案是 ' + res.letter;
      // P-003：只有后端标 trusted_html 的字段才允许走 innerHTML（并先 sanitize）；
      // 其余内容类型（plain_text / 未标）一律 textContent，防 XSS。
      if (res.explanationContentType === 'trusted_html') {
        $('#verdict-body').innerHTML = DS.sanitize(res.explanation || '');
      } else {
        $('#verdict-body').textContent = res.explanation || '';
      }
      const kp = $('#keypoint');
      if (res.keyPoint) {
        kp.hidden = false;
        if (res.keyPointContentType === 'trusted_html') {
          $('#keypoint-text').innerHTML = DS.sanitize(res.keyPoint);
        } else {
          $('#keypoint-text').textContent = res.keyPoint;
        }
      } else kp.hidden = true;
    } else {
      v.classList.remove('show');
    }

    $('#btn-submit').disabled = !q || state.submitted || state.picked === null;
    paintSheet();
  }

  /** 答题卡有两个宿主：侧栏（桌面）与题目下方（窄屏），用 data-sheet 标记 */
  function sheetHosts() {
    return $$('[data-sheet]');
  }

  function buildSheet() {
    sheetHosts().forEach((host) => {
      host.innerHTML = '';
      state.questions.forEach((q, i) => {
        host.appendChild(el('button.sheet-cell', {
          type: 'button',
          text: String(i + 1),
          title: q.id,
          onclick: () => goto(i)
        }));
      });
    });
  }

  function paintSheet() {
    sheetHosts().forEach((host) => {
      Array.prototype.forEach.call(host.querySelectorAll('.sheet-cell'), (cell, i) => {
        const q = state.questions[i];
        const res = q ? state.results[q.id] : null;
        cell.classList.toggle('ok', !!(res && res.correct));
        cell.classList.toggle('bad', !!(res && !res.correct));
        cell.classList.toggle('cur', i === state.idx);
      });
    });
  }

  function updateProgress() {
    const total = state.questions.length;
    const done = state.questions.filter((q) => state.results[q.id]).length;
    $('#cat-progress').style.width = (total ? (done / total) * 100 : 0) + '%';
    $('#cat-progress-label').textContent = done + '/' + total;
  }

  /* ============================ 交互 ============================ */

  function pick(i) {
    if (state.submitted || !cur()) return;
    state.picked = i;
    $$('#opts .opt').forEach((b, j) => b.classList.toggle('picked', j === i));
    $('#btn-submit').disabled = false;
  }

  async function submit() {
    const q = cur();
    if (!q || state.submitted || state.picked === null) return;

    const btn = $('#btn-submit');
    btn.disabled = true;
    btn.textContent = '判题中…';

    const r = await DS.api.post('/api/quiz/submit', {
      question_id: q.id,
      answer: state.picked
    });

    btn.textContent = '提交答案';

    if (!r.ok) {
      if (r.offline) {
        DS.toast.warn('后端未连接，无法判题');
        btn.disabled = false;
      } else {
        DS.toast.danger(r.msg || '判题失败');
        btn.disabled = false;
      }
      return;
    }

    const d = r.data;
    state.results[q.id] = {
      picked: state.picked,
      correct: !!d.correct,
      answerIndex: d.answer_index,
      letter: d.answer_letter,
      explanation: d.explanation,
      explanationContentType: d.explanation_content_type,
      keyPoint: d.key_point,
      keyPointContentType: d.key_point_content_type
    };
    renderQ();
    updateProgress();
    refreshStats();
  }

  function goto(i) {
    if (i < 0 || i >= state.questions.length) return;
    state.idx = i;
    renderQ();
  }

  function next() {
    // 优先跳到下一道未做的题；都做完了就顺序往后
    const n = state.questions.length;
    for (let k = 1; k <= n; k++) {
      const j = (state.idx + k) % n;
      if (!state.results[state.questions[j].id]) { goto(j); return; }
    }
    goto((state.idx + 1) % n);
  }

  /* ============================ 统计 ============================ */

  async function refreshStats() {
    const r = await DS.api.get('/api/quiz/stats');
    if (!r.ok) return;
    const d = r.data;
    $('#s-done').textContent = String(d.total_done);
    $('#s-right').textContent = String(d.total_right);
    const acc = d.total_done ? Math.round((d.total_right / d.total_done) * 100) : null;
    $('#s-acc').textContent = acc === null ? '–' : acc + '%';
    $('#meta-done').textContent = String(d.total_done);
    $('#meta-acc').textContent = acc === null ? '–' : acc + '%';
  }

  /* ============================ 离线 ============================ */

  function markOffline() {
    $('#q-text').textContent = '';
    $('#opts').innerHTML =
      '<div class="note warn">后端未连接。题目与判题都在后端，' +
      '请在 backend 目录执行 <code>uvicorn main:app --port 8000</code> 后刷新。</div>';
    $('#btn-submit').disabled = true;
    $('#btn-next').disabled = true;
  }

  /* ============================ 启动 ============================ */

  async function init() {
    $('#btn-submit').onclick = submit;
    $('#btn-next').onclick = next;

    DS.keys.bind({
      enter: () => submit(),
      left: () => goto(state.idx - 1),
      right: () => next(),
      '1': () => pick(0),
      '2': () => pick(1),
      '3': () => pick(2),
      '4': () => pick(3)
    });

    const b = await DS.api.probe();
    const offlineCapable = DS.offline && DS.offline.available();
    if (!b.online) {
      if (!offlineCapable) { markOffline(); return; }
      DS.toast.warn('后端未连接，已切换到离线模式：刷题、判题、解析均可本地使用。');
    }
    const okd = await loadCats();
    if (okd) refreshStats();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
