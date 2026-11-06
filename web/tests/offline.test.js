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
  section('刷题页 · 离线自动降级（本地判题）');
  {
    const { doc, dom } = await open('quiz.html');
    await waitFor(() => doc.querySelector('#offline-banner'));
    const banner = doc.querySelector('#offline-banner');
    ok(/离线模式已启用/.test(banner.textContent), '横幅切到「离线模式已启用」（信息态）');
    ok(/uvicorn/.test(banner.textContent), '横幅仍给出后端启动命令');

    // 分类与题目应由本地快照渲染出来
    const loaded = await waitFor(() => doc.querySelectorAll('#cat-tabs .tab').length >= 6);
    ok(loaded, '离线加载出全部分类标签（本地快照）');
    await waitFor(() => doc.querySelectorAll('#opts .opt').length === 4);
    ok(doc.querySelectorAll('#opts .opt').length === 4, '首题四个选项渲染成功');
    ok(doc.querySelector('#opts').textContent.indexOf('uvicorn') === -1,
      '题目区不再显示「需要后端」的降级说明（已走本地数据）');
    const diffEl = doc.querySelector('#q-diff');
    ok(!!diffEl && diffEl.hidden === false, '难度徽标可见');

    // 离线判题：点一个选项 → 提交 → 就地展开解析
    doc.querySelector('#opts .opt').click();       // 选 A
    ok(doc.querySelector('#btn-submit').disabled === false, '选中后「提交答案」可点');
    doc.querySelector('#btn-submit').click();
    await waitFor(() => doc.querySelector('#verdict').classList.contains('show'));
    ok(doc.querySelector('#verdict').classList.contains('show'), '离线提交后展开解析');
    ok(doc.querySelector('#verdict-line').textContent.length > 0, '判题结论行有文字');
    dom.window.close();
  }

  /* ------------------------------ 答疑页 ------------------------------ */
  section('答疑页 · 离线命中本地知识库');
  {
    const { doc, win, dom } = await open('ai.html');
    await waitFor(() => doc.querySelector('#offline-banner'));

    const input = doc.querySelector('#ask-input');
    input.value = 'KMP 的 next 数组怎么求？';
    doc.querySelector('#btn-ask').click();

    const answered = await waitFor(() => doc.querySelector('#msgs .ans-title'), 8000);
    ok(!!answered, '离线提问返回本地知识库答案（带标题气泡）');
    ok(!doc.querySelector('#msgs .note.danger'), '离线不再报「后端未连接」红框');
    const badges = Array.from(doc.querySelectorAll('#msgs .src .badge')).map((b) => b.textContent);
    ok(badges.some((t) => /local_kb/.test(t)), '答案标注 local_kb 来源');
    ok(badges.some((t) => /离线模式/.test(t)), '额外标注离线模式');
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
