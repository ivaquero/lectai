/* ==========================================================================
   web/tests/visual-stackqueue.test.js —— 通用可视化页（栈 / 队列）
   --------------------------------------------------------------------------
   前提：后端已启动  uvicorn main:app --port 8000

   运行：
     NODE_PATH=C:/Users/Rjx17/.workbuddy/binaries/node/workspace/node_modules \
     node web/tests/visual-stackqueue.test.js
   ========================================================================== */
'use strict';

const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const harness = require('./_harness.js');

const BASE = 'http://127.0.0.1:8000';
const HTML = path.join(__dirname, '..', 'visual.html');

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

/** 打开 visual.html，用 hash 指定模块 */
async function open(mod) {
  const html = fs.readFileSync(HTML, 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.log('  [jsdomError]', (e.detail && e.detail.message) || e.message));
  vc.on('error', (...a) => console.log('  [page error]', ...a));
  const dom = new JSDOM(html, {
    url: BASE + '/visual.html#' + mod,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const win = dom.window;
  const doc = win.document;

  win.fetch = (u, o) => fetch(new URL(u, BASE).href, o);
  win.AbortController = AbortController;
  win.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16);
  win.cancelAnimationFrame = (id) => clearTimeout(id);

  /* jsdom 不执行 type="module"，改由 esbuild 打成经典 IIFE 注入（见 _harness.js） */
  await harness.injectPage(win, 'visual.html');

  await new Promise((r) => {
    if (doc.readyState === 'complete') r();
    else win.addEventListener('load', r);
  });
  return { win, doc, dom };
}

/** 切到某个操作并执行，返回步骤数 */
async function runOp(doc, win, opKey, inputs) {
  const tab = Array.prototype.find.call(
    doc.querySelectorAll('#op-tabs .tab'), (t) => t.dataset.op === opKey);
  if (!tab) return 0;
  tab.click();
  Object.keys(inputs || {}).forEach((name) => {
    const input = doc.querySelector('#f-' + name);
    if (input) input.value = String(inputs[name]);
  });
  const prev = doc.querySelector('#canvas-wrap').getAttribute('data-trace-run') || '0';
  doc.querySelector('#btn-run').click();
  const loaded = await waitFor(() =>
    doc.querySelector('#canvas-wrap').getAttribute('data-trace-run') !== prev);
  if (!loaded) return 0;
  await waitFor(() => /\d+\/\d+/.test(doc.querySelector('#readout-step').textContent) &&
    !/0\/\d+/.test(doc.querySelector('#readout-step').textContent), 4000);
  return doc.querySelectorAll('#step-list li').length;
}

async function main() {

  /* ============================== 栈 ============================== */
  section('栈 · 首屏');
  {
    const { doc, win, dom } = await open('stack');
    const ready = await waitFor(() => !!doc.querySelector('#canvas-wrap svg'), 8000);
    ok(ready, '画布渲染出 SVG');

    const h1 = doc.querySelector('.page-head h1');
    ok(h1 && h1.textContent.indexOf('栈') >= 0, '标题切换为栈：' + (h1 && h1.textContent));
    const activeMod = doc.querySelector('.mod-tab.active');
    ok(activeMod && activeMod.dataset.mod === 'stack', '模块标签高亮 stack');

    const tabs = doc.querySelectorAll('#op-tabs .tab');
    ok(tabs.length === 5, '操作标签 5 个（建栈/入栈/出栈/读栈顶/遍历），实际 ' + tabs.length);

    const svg = doc.querySelector('#canvas-wrap svg').outerHTML;
    ok(svg.indexOf('top') >= 0, '画布上有 top 指针');
    ok(svg.indexOf('栈底') >= 0, '画布标出了栈底');

    /* 容器以空表起步、由挂载后异步 POST /trace/build 填入初始序列（栈/队列都是 3 个），
       因此要等「等于期望值」而不是「不等于占位符」—— 后者会在 build 落地前就放行，
       与网络响应赛跑，导致该套件偶发失败。 */
    await waitFor(() => doc.querySelector('#meta-len').textContent === '3', 5000);
    ok(doc.querySelector('#meta-len').textContent === '3', '首屏栈内有 3 个元素');

    section('栈 · 入栈与出栈（LIFO）');
    const n1 = await runOp(doc, win, 'push', { value: 42 });
    ok(n1 > 0, '入栈返回了轨迹（' + n1 + ' 步）');
    ok(doc.querySelector('#pseudo').childElementCount > 0, '代码面板已渲染');
    const svg2 = doc.querySelector('#canvas-wrap svg').outerHTML;
    ok(svg2.indexOf('42') >= 0, '画布上出现新入栈的 42');

    const n2 = await runOp(doc, win, 'pop', {});
    ok(n2 > 0, '出栈返回了轨迹（' + n2 + ' 步）');
    const readout = doc.querySelectorAll('#step-list li');
    const lastStep = readout.length ? readout[readout.length - 1].textContent : '';
    ok(lastStep.indexOf('42') >= 0, '出栈的解说提到 42（后进先出）：' + lastStep.slice(0, 40));

    section('栈 · 遍历顺序');
    const n3 = await runOp(doc, win, 'traverse', {});
    ok(n3 > 0, '遍历返回了轨迹');
    const li = doc.querySelectorAll('#step-list li');
    const last = li.length ? li[li.length - 1].textContent : '';
    ok(/遍历完成/.test(last), '最后一步是遍历完成小结：' + last.slice(0, 50));

    dom.window.close();
    win.close();
  }

  /* ============================== 队列 ============================== */
  section('队列 · 首屏');
  {
    const { doc, win, dom } = await open('queue');
    const ready = await waitFor(() => !!doc.querySelector('#canvas-wrap svg'), 8000);
    ok(ready, '画布渲染出 SVG');

    const h1 = doc.querySelector('.page-head h1');
    ok(h1 && h1.textContent.indexOf('队列') >= 0, '标题切换为队列');

    const svg = doc.querySelector('#canvas-wrap svg').outerHTML;
    ok(svg.indexOf('front') >= 0, '画布上有 front 指针');
    ok(svg.indexOf('rear') >= 0, '画布上有 rear 指针');
    ok(svg.indexOf('下一入队位') >= 0, '画布标出了 rear 的写入位置');

    /* 容器以空表起步、由挂载后异步 POST /trace/build 填入初始序列（栈/队列都是 3 个），
       因此要等「等于期望值」而不是「不等于占位符」—— 后者会在 build 落地前就放行，
       与网络响应赛跑，导致该套件偶发失败。 */
    await waitFor(() => doc.querySelector('#meta-len').textContent === '3', 5000);
    ok(doc.querySelector('#meta-len').textContent === '3', '首屏队列内 3 个元素');

    section('队列 · 入队与出队（FIFO）');
    const n1 = await runOp(doc, win, 'enqueue', { value: 77 });
    ok(n1 > 0, '入队返回了轨迹（' + n1 + ' 步）');
    ok(doc.querySelector('#canvas-wrap svg').outerHTML.indexOf('77') >= 0, '画布出现 77');

    const n2 = await runOp(doc, win, 'dequeue', {});
    ok(n2 > 0, '出队返回了轨迹（' + n2 + ' 步）');
    const li = doc.querySelectorAll('#step-list li');
    const last = li.length ? li[li.length - 1].textContent : '';
    // 默认序列 5,3,8 再入队 77；出队应取走最早的 5，而不是刚入队的 77
    ok(/返回 5/.test(last) && !/返回 77/.test(last),
      '出队取走的是队头 5（先进先出）：' + last.slice(0, 50));

    dom.window.close();
    win.close();
  }

  console.log('\n========================================');
  console.log('通过 ' + passed + ' / ' + (passed + failed));
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error('测试异常：', e); process.exitCode = 1; });
