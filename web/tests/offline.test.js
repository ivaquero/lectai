/* ==========================================================================
   web/tests/offline.test.js —— 离线降级与无障碍基础（jsdom，不需要后端）
   --------------------------------------------------------------------------
   页面资源仍从 http://127.0.0.1:8000 加载，但 fetch 被替换成必然失败，
   用来模拟「后端没起」时四页的表现。

   运行：
     NODE_PATH=C:/Users/Rjx17/.workbuddy/binaries/node/workspace/node_modules \
     node web/tests/offline.test.js
   ========================================================================== */
'use strict';

const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

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
  while (Date.now() - t0 < (timeout || 6000)) {
    try { if (cond()) return true; } catch (e) { /* ignore */ }
    await new Promise((r) => setTimeout(r, 40));
  }
  return false;
}

/** 打开一个页面，并让它的所有 fetch 失败 */
async function open(page) {
  const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.log('  [jsdomError]', (e.detail && e.detail.message) || e.message));
  const dom = new JSDOM(html, {
    url: BASE + '/' + page,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const win = dom.window;
  const doc = win.document;

  win.fetch = async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:8000'); };
  win.AbortController = AbortController;
  win.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
  win.cancelAnimationFrame = (id) => clearTimeout(id);

  await new Promise((r) => {
    if (doc.readyState === 'complete') r();
    else win.addEventListener('load', r);
  });
  return { win: win, doc: doc, dom: dom };
}

async function main() {

  /* ------------------------------ 链表页 ------------------------------ */
  section('链表页 · 离线降级');
  {
    const { doc, dom } = await open('list.html');
    const got = await waitFor(() => doc.querySelector('#offline-banner'));
    ok(!!got, '顶部出现离线横幅');

    const banner = doc.querySelector('#offline-banner');
    ok(!!banner && banner.textContent.indexOf('uvicorn') >= 0, '横幅给出了启动命令');
    ok(!!banner && !!doc.querySelector('#banner-retry'), '横幅带重试按钮');
    ok(!!banner && banner.getAttribute('role') === 'status', '横幅 role=status（读屏可播报）');

    const canvas = doc.querySelector('#canvas-wrap');
    ok(canvas && canvas.textContent.indexOf('后端未连接') >= 0, '画布区给出离线说明');
    ok(doc.querySelector('#btn-run').disabled === true, '「执行」按钮被禁用');
    ok(doc.querySelector('#btn-reset').disabled === true, '「重置」按钮被禁用');

    section('链表页 · 无障碍');
    const skip = doc.querySelector('.skip-link');
    ok(!!skip && skip.getAttribute('href') === '#main', '存在跳到主内容的 skip-link');
    ok(!!doc.querySelector('main#main'), '主内容区带 id=main');
    const btns = ['btn-first', 'btn-prev', 'btn-play', 'btn-next', 'btn-last'];
    ok(btns.every((id) => {
      const b = doc.querySelector('#' + id);
      return b && b.tagName === 'BUTTON' && b.getAttribute('aria-label');
    }), '五个播放按钮都是 button 且带 aria-label');
    dom.window.close();
  }

  /* ------------------------------ 刷题页 ------------------------------ */
  section('刷题页 · 离线降级');
  {
    const { doc, dom } = await open('quiz.html');
    const got = await waitFor(() => doc.querySelector('#offline-banner'));
    ok(!!got, '顶部出现离线横幅');
    const opts = doc.querySelector('#opts');
    ok(opts && opts.textContent.indexOf('uvicorn') >= 0, '题目区给出启动命令');
    ok(doc.querySelector('#btn-submit').disabled === true, '「提交答案」被禁用');
    ok(doc.querySelector('#btn-next').disabled === true, '「下一题」被禁用');
    dom.window.close();
  }

  /* ------------------------------ 答疑页 ------------------------------ */
  section('答疑页 · 离线降级');
  {
    const { doc, win, dom } = await open('ai.html');
    await waitFor(() => doc.querySelector('#offline-banner'));

    const input = doc.querySelector('#ask-input');
    input.value = 'KMP 的 next 数组怎么求？';
    doc.querySelector('#btn-ask').click();

    const answered = await waitFor(() => !!doc.querySelector('#msgs .note.danger'), 8000);
    ok(answered, '离线时提问仍会收到一条回复（不会卡住）');
    const note = doc.querySelector('#msgs .note.danger');
    const tail = note ? note.textContent : '';
    ok(tail.indexOf('后端未连接') >= 0 && tail.indexOf('uvicorn') >= 0,
      '回复里说明了后端未连接并给出启动命令');
    ok(!!doc.querySelector('#msgs').getAttribute('aria-live'), '消息区 aria-live 可播报');
    win.close();
    dom.window.close();
  }

  /* ------------------------------ 首页 ------------------------------ */
  section('首页 · 离线降级');
  {
    const { doc, dom } = await open('index.html');
    const got = await waitFor(() => doc.querySelector('#offline-banner'));
    ok(!!got, '顶部出现离线横幅');
    ok(!!doc.querySelector('.skip-link'), '有 skip-link');
    dom.window.close();
  }

  console.log('\n========================================');
  console.log('通过 ' + passed + ' / ' + (passed + failed));
  if (failed) process.exitCode = 1;
}

main().catch((e) => {
  console.error('测试异常：', e);
  process.exitCode = 1;
});
