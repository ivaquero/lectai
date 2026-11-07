/* ==========================================================================
   web/tests/quiz-ai.test.js —— 刷题页 + AI 答疑页集成测试（jsdom + 真实后端）
   --------------------------------------------------------------------------
   前提：后端已启动  uvicorn main:app --port 8000

   运行：
     NODE_PATH=C:/Users/Rjx17/.workbuddy/binaries/node/workspace/node_modules \
     node web/tests/quiz-ai.test.js
   ========================================================================== */
'use strict';

const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const harness = require('./_harness.js');

const BASE = 'http://127.0.0.1:8000';
let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

async function waitFor(cond, timeout) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 8000)) {
    try { if (cond()) return true; } catch (e) { /* ignore */ }
    await new Promise((r) => setTimeout(r, 40));
  }
  return false;
}

/** 打开一个页面（脚本来自后端，fetch 走 node 全局） */
async function open(page) {
  const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.log('  [jsdomError]', e.detail && e.detail.message || e.message));
  const dom = new JSDOM(html, {
    url: BASE + '/' + page,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const win = dom.window;
  win.fetch = (u, o) => fetch(new URL(u, BASE).href, o);
  win.AbortController = AbortController;
  win.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
  win.cancelAnimationFrame = (id) => clearTimeout(id);

  /* jsdom 不执行 type="module"，改由 esbuild 打成经典 IIFE 注入（见 _harness.js） */
  await harness.injectPage(win, page);

  await new Promise((r) => {
    if (win.document.readyState === 'complete') r();
    else win.addEventListener('load', r);
  });
  return { win: win, doc: win.document, $: (s) => win.document.querySelector(s), $$: (s) => Array.from(win.document.querySelectorAll(s)) };
}

async function main() {
  /* ============================== 刷题页 ============================== */
  section('刷题页');
  {
    const p = await open('quiz.html');
    const { doc, $, $$ } = p;

    const ready = await waitFor(() => $$('#cat-tabs .tab').length > 0);
    ok(ready, '分类标签已加载');

    ok(await waitFor(() => $$('#opts .opt').length === 4), '渲染了 4 个选项');
    ok(await waitFor(() => $$('#sheet .sheet-cell').length > 0), '答题卡已生成');

    const qid = $('#q-no').textContent;
    ok(/1 \/ \d+/.test(qid), '题号显示正确：' + qid.trim());

    ok($('#btn-submit').disabled, '未选项时提交按钮禁用');

    // 取题接口不应泄露答案
    ok($('#verdict').className.indexOf('show') < 0, '未提交时不显示解析');

    // 选 A 并提交
    $$('#opts .opt')[0].click();
    ok($$('#opts .opt')[0].classList.contains('picked'), '点击后选项高亮');
    ok(!$('#btn-submit').disabled, '选完后可以提交');

    $('#btn-submit').click();
    const judged = await waitFor(() => $('#verdict').classList.contains('show'), 8000);
    ok(judged, '提交后显示解析区');

    const line = $('#verdict-line').textContent;
    ok(/正确|错误/.test(line), '判题结论：' + line);
    ok($('#verdict-body').innerHTML.length > 10, '解析正文非空');

    // 提交后选项锁定
    ok($$('#opts .opt').every((b) => b.disabled), '提交后选项被锁定');
    ok($$('#opts .opt').some((b) => b.classList.contains('right')), '标出了正确选项');

    // 答题卡着色
    ok($$('#sheet .sheet-cell').some((c) => c.classList.contains('ok') || c.classList.contains('bad')),
      '答题卡标出了结果');

    // 下一题
    const before = $('#q-no').textContent;
    $('#btn-next').click();
    ok($('#q-no').textContent !== before, '下一题切换成功');
    ok(!$('#verdict').classList.contains('show'), '新题不显示上一题的解析');

    // 键盘选择
    const ev = new p.win.KeyboardEvent('keydown', { key: '2' });
    doc.dispatchEvent(ev);
    ok($$('#opts .opt')[1].classList.contains('picked'), '键盘 2 选中第二个选项');

    // 统计
    ok(await waitFor(() => $('#s-done').textContent !== '0', 8000), '会话统计已答数 > 0');
  }

  /* ============================= AI 答疑页 ============================= */
  section('AI 答疑页');
  {
    const p = await open('ai.html');
    const { $, $$ } = p;

    ok($$('#msgs .msg').length === 1, '开场白已渲染');
    ok($$('#hotq button').length === 8, '8 个热门问题');

    // 命中知识库的问题
    $('#ask-input').value = 'KMP 的 next 数组怎么求？';
    $('#btn-ask').click();

    const thinking = await waitFor(() => !!$('.thinking'), 2000);
    ok(thinking, '发送后出现「思考中」占位');

    const answered = await waitFor(() => $$('#msgs .msg').length >= 3 &&
      !$('.thinking'), 10000);
    ok(answered, '收到了回答');

    const bubbles = $$('#msgs .msg.who-ai .bubble');
    const last = bubbles[bubbles.length - 1];
    ok(last.textContent.indexOf('local_kb') >= 0, '标注了来源 local_kb');
    ok(/ms$/.test(last.textContent.trim()) || /\d+ ms/.test(last.textContent), '标注了耗时');
    ok(last.innerHTML.indexOf('next') >= 0, '回答内容包含 next 相关正文');
    ok($$('#msgs .msg.who-user').length === 1, '用户提问气泡已渲染');
    ok($('#meta-asked').textContent === '1', '提问计数 = 1');

    // 未命中 → mock
    $('#ask-input').value = '今天天气怎么样';
    $('#btn-ask').click();
    ok(await waitFor(() => $$('#msgs .msg').length >= 5 && !$('.thinking'), 10000), '第二次提问完成');
    const b2 = $$('#msgs .msg.who-ai .bubble');
    ok(b2[b2.length - 1].textContent.indexOf('mock') >= 0, '未命中时标注 mock');
    ok($('#meta-asked').textContent === '2', '提问计数 = 2');
  }

  console.log('\n========================================');
  console.log('通过 ' + passed + ' / ' + (passed + failed));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('测试进程异常：', e); process.exit(1); });
