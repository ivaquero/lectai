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

  /* jsdom 不执行 type="module"，改由 esbuild 打成经典 IIFE 注入（见 _harness.js） */
  await harness.injectPage(win, page);

  await new Promise((r) => {
    if (doc.readyState === 'complete') r();
    else win.addEventListener('load', r);
  });
  return { win: win, doc: doc, dom: dom };
}

async function main() {

  /* ------------------------------ 链表页 ------------------------------ */
  section('链表页 · 离线本地引擎');
  {
    const { win, doc, dom } = await open('list.html');
    const got = await waitFor(() => doc.querySelector('#offline-banner'));
    ok(!!got, '顶部出现离线横幅');

    const banner = doc.querySelector('#offline-banner');
    ok(!!banner && /离线模式已启用/.test(banner.textContent), '横幅切到「离线模式已启用」（信息态）');
    ok(!!banner && /本地引擎/.test(banner.textContent), '横幅说明可视化已由本地引擎接管');
    ok(!!banner && !!doc.querySelector('#banner-retry'), '横幅带重试按钮');
    ok(!!banner && banner.getAttribute('role') === 'status', '横幅 role=status（读屏可播报）');

    /* 本地引擎接管后，首屏默认序列由本地生成，按钮不再禁用 */
    const booted = await waitFor(() => doc.querySelectorAll('#canvas-wrap .nd').length === 5);
    ok(booted, '首屏 5 个结点由本地引擎生成');
    ok(doc.querySelector('#btn-run').disabled === false, '「执行」按钮可用（离线不再禁用）');
    ok(doc.querySelector('#btn-reset').disabled === false, '「重置」按钮可用');

    /* 真实执行：头插 9 → 6 个结点 */
    const tab = Array.from(doc.querySelectorAll('#op-tabs .tab')).find((t) => t.dataset.op === 'insert-head');
    tab.click();
    doc.querySelector('#f-value').value = '9';
    const runAttr = () => doc.querySelector('#canvas-wrap').getAttribute('data-trace-run') || '0';
    const prev = runAttr();
    doc.querySelector('#btn-run').click();
    const ran = await waitFor(() => runAttr() !== prev, 8000);
    ok(ran, '离线执行头插返回轨迹（本地引擎）');
    await waitFor(() => doc.querySelectorAll('#canvas-wrap .nd').length === 6);
    ok(doc.querySelectorAll('#canvas-wrap .nd').length === 6, '头插后 6 个结点');

    /* 业务错误仍走 err()：位序越界 → danger toast，而不是静默降级 */
    const del = Array.from(doc.querySelectorAll('#op-tabs .tab')).find((t) => t.dataset.op === 'delete-pos');
    del.click();
    doc.querySelector('#f-pos').value = '99';
    doc.querySelector('#btn-run').click();
    const toasted = await waitFor(() => !!doc.querySelector('.toast.danger'), 4000);
    ok(toasted, '越界位序触发 danger toast（本地引擎的 err 语义与后端一致）');

    /* 在线 → 离线的状态交接：remember() 从后端应答里取容器值，seed 进本地容器，
       断网那一刻画布不会重置成空表。这里直接喂一份后端载荷验证提取链路。 */
    win.DS.offline.remember('/api/linkedlist/trace/build', {
      trace: [
        { nodes: [{ id: 'x1', value: 7, label: 'a1' }] },
        { nodes: [{ id: 'x1', value: 7, label: 'a1' }, { id: 'x2', value: 8, label: 'a2' }] }
      ]
    });
    const st = win.DS.offline.handle('GET', '/api/linkedlist/trace/state');
    ok(!!st && st.ok && st.data.length === 2, 'remember→seed 接管了后端最后状态（2 结点）');
    ok(JSON.stringify(st.data.nodes.map((n) => n.value)) === '[7,8]', '交接后的值序列为 [7,8]');

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
    ok(/pnpm server/.test(banner.textContent), '横幅仍给出后端启动命令');

    // 分类与题目应由本地快照渲染出来
    const loaded = await waitFor(() => doc.querySelectorAll('#cat-tabs .tab').length >= 6);
    ok(loaded, '离线加载出全部分类标签（本地快照）');
    await waitFor(() => doc.querySelectorAll('#opts .opt').length === 4);
    ok(doc.querySelectorAll('#opts .opt').length === 4, '首题四个选项渲染成功');
    ok(doc.querySelector('#opts').textContent.indexOf('pnpm server') === -1,
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
