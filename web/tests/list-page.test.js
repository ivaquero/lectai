/* ==========================================================================
   web/tests/list-page.test.js —— 单链表页集成测试（jsdom + 真实后端）
   --------------------------------------------------------------------------
   前提：后端已启动  仓库根执行 pnpm server

   运行：
     NODE_PATH=C:/Users/Rjx17/.workbuddy/binaries/node/workspace/node_modules \
     node web/tests/list-page.test.js
   ========================================================================== */
'use strict';

const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');

const harness = require('./_harness.js');

const BASE = 'http://127.0.0.1:8000';
const HTML = path.join(__dirname, '..', 'list.html');

let passed = 0;
let failed = 0;

function ok(cond, label) {
  if (cond) { passed++; console.log('  ✓ ' + label); }
  else { failed++; console.log('  ✗ ' + label); }
}

function section(t) { console.log('\n== ' + t + ' =='); }

async function waitFor(cond, timeout, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < (timeout || 6000)) {
    try { if (cond()) return true; } catch (e) { /* ignore */ }
    await new Promise((r) => setTimeout(r, 40));
  }
  return false;
}

async function main() {
  const html = fs.readFileSync(HTML, 'utf8');
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => console.log('  [jsdomError]', e.detail && e.detail.message || e.message));
  vc.on('error', (...a) => console.log('  [page error]', ...a));
  const dom = new JSDOM(html, {
    url: BASE + '/list.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole: vc
  });
  const win = dom.window;
  const doc = win.document;

  // jsdom 缺的能力：fetch / AbortController / rAF
  const rawFetch = (u, o) => fetch(new URL(u, BASE).href, o);
  let reqSeq = 0;
  win.fetch = async (u, o) => {
    const id = ++reqSeq;
    if (String(u).indexOf('/api/health') < 0) {
      console.log('  [req#' + id + '] ' + (o && o.method || 'GET') + ' ' + u +
        (o && o.body ? ' ' + o.body : ''));
    }
    const res = await rawFetch(u, o);
    res.clone().json().then((j) => {
      if (j && j.code !== 0) console.log('  [api#' + id + '] code=' + j.code + ' ' + j.msg);
      else if (String(u).indexOf('/trace/') > 0) {
        console.log('  [api#' + id + '] ok trace=' +
          ((j && j.data && j.data.trace) || []).length + ' title=' +
          (j && j.data && j.data.title));
      }
    }).catch(() => {});
    return res;
  };
  win.AbortController = AbortController;
  win.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
  win.cancelAnimationFrame = (id) => clearTimeout(id);

  /* jsdom 不执行 type="module"，改由 esbuild 打成经典 IIFE 注入（见 _harness.js） */
  await harness.injectPage(win, 'list.html');

  await new Promise((r) => {
    if (doc.readyState === 'complete') r();
    else win.addEventListener('load', r);
  });

  /* ---------------------------- 启动与首屏 ---------------------------- */
  section('启动与首屏');

  const booted = await waitFor(() => {
    const b = doc.getElementById('nav-status');
    return b && b.classList.contains('online');
  });
  ok(booted, '后端已连接（导航徽标 online）');

  const hasSvg = await waitFor(() => !!doc.querySelector('#canvas-wrap svg'));
  ok(hasSvg, '首屏画出了链表 SVG');

  /* 初始序列由页面挂载后异步 POST /trace/build 载入（见 pages/list/index.js 的
     defaults: '3,1,4,1,5'）。此处必须等它落定再断言，否则与网络响应赛跑 ——
     Vite 化前该套件固定有 8 项失败，根因就是这里少了一次等待。 */
  await waitFor(() => doc.querySelectorAll('#canvas-wrap .nd').length === 5);
  const nodeCount = doc.querySelectorAll('#canvas-wrap .nd').length;
  ok(nodeCount === 5, '默认序列 5 个结点（实际 ' + nodeCount + '）');

  ok(doc.querySelectorAll('#op-tabs .tab').length === 7, '7 个操作标签');
  ok(doc.querySelectorAll('#legend .legend-item').length === 7, '7 项图例');
  ok(doc.getElementById('c-len').textContent === '5', '统计芯片同步了结点数');

  /* ---------------------------- 通用执行器 ---------------------------- */

  const $ = (s) => doc.querySelector(s);
  const $$ = (s) => Array.from(doc.querySelectorAll(s));

  async function runOp(opKey, inputs) {
    // 切到对应标签
    const tab = $$('#op-tabs .tab').find((t) => t.dataset.op === opKey);
    tab.click();
    // 填参数
    Object.keys(inputs || {}).forEach((name) => {
      const input = $('#f-' + name);
      input.value = String(inputs[name]);
    });
    // 记录装载序号，等它变化（不能用文案匹配：旧轨迹的文案会立刻命中）
    const runAttr = () => $('#canvas-wrap').getAttribute('data-trace-run') || '0';
    const prev = runAttr();
    $('#btn-run').click();
    const loaded = await waitFor(() => runAttr() !== prev, 8000);
    if (!loaded) {
      console.log('  [debug] ' + opKey + ' 未等到装载, readout=' + $('#readout-step').textContent);
      return 0;
    }
    return $$('#step-list li').length;
  }

  /* ------------------------------ 七个操作 ----------------------------- */
  section('七个操作（真实点击执行）');

  const expect = {
    build: 5,          // [3,1,4,1,5]
    'insert-head': 6,
    'insert-tail': 7,
    'delete-pos': 6,
    'delete-value': 5,
    search: 5,
    traverse: 5
  };

  for (const [key, inputs] of [
    ['build', { values: '3,1,4,1,5' }],
    ['insert-head', { value: 7 }],
    ['insert-tail', { value: 9 }],
    ['delete-pos', { pos: 2 }],
    ['delete-value', { value: 9 }],
    ['search', { value: 4 }],
    ['traverse', {}]
  ]) {
    const total = await runOp(key, inputs);
    ok(total > 0, key + '：返回了 ' + total + ' 步轨迹');

    // 跳到结尾，看最终状态
    $('#btn-last').click();
    const len = parseInt($('#c-len').textContent, 10);
    ok(len === expect[key], key + '：最终结点数 ' + len + '（期望 ' + expect[key] + '）');

    // 代码面板有内容且步数一致
    ok($$('#pseudo .pline').length > 0, key + '：代码面板已渲染');

    // 步骤列表
    ok($$('#step-list li').length === total, key + '：步骤列表 ' + total + ' 条');
  }

  /* ---------------------------- 播放器控制 ----------------------------- */
  section('播放器控制');

  // 当前是 traverse 的轨迹
  $('#btn-first').click();
  ok($('#readout-step').textContent === '步 0/' + $('#readout-step').textContent.split('/')[1],
    'btn-first 回到步 0');

  $('#btn-next').click();
  $('#btn-next').click();
  ok($('#readout-step').textContent.startsWith('步 2/'), '单步前进到步 2');

  $('#btn-prev').click();
  ok($('#readout-step').textContent.startsWith('步 1/'), '回退到步 1');

  $('#btn-last').click();
  const totalNow = parseInt($('#readout-step').textContent.split('/')[1], 10);
  ok($('#readout-step').textContent === '步 ' + totalNow + '/' + totalNow, '跳到结尾');

  // 代码行高亮
  ok($$('#pseudo .pline.active').length <= 1, '任意时刻至多一行代码高亮');

  // 步骤列表跟随
  ok($('#step-list li.on') !== null, '步骤列表高亮当前步');

  // 键盘
  $('#btn-first').click();
  const evt = new win.KeyboardEvent('keydown', { key: 'ArrowRight' });
  doc.dispatchEvent(evt);
  ok($('#readout-step').textContent.startsWith('步 1/'), '键盘 → 单步前进');

  /* -------------------------- 暂离结点渲染 ----------------------------- */
  section('暂离结点（s / q）');

  await runOp('insert-head', { value: 42 });
  // 头插第 2 步：s 已建好、还没接链，应出现在下方暂离区
  $('#btn-first').click();
  $('#btn-next').click();
  $('#btn-next').click();
  ok($$('#canvas-wrap .aside-box').length >= 1, '头插中途画出了暂离结点 s');
  ok($$('#canvas-wrap .ptr-tag').some((t) => t.textContent === 's'), '暂离结点带 s 指针标签');

  await runOp('delete-pos', { pos: 2 });
  $('#btn-last').click();
  $('#btn-prev').click();
  ok(/摘链|free/.test($('#readout-text').textContent),
    '删除的最后几步解说提到摘链/释放：' + $('#readout-text').textContent);

  /* ---------------------------- 错误处理 ------------------------------- */
  section('错误处理');

  // 位序越界：后端应返回 code=1，页面 toast 提示，不崩溃
  const tab = $$('#op-tabs .tab').find((t) => t.dataset.op === 'delete-pos');
  tab.click();
  $('#f-pos').value = '99';
  $('#btn-run').click();
  const toasted = await waitFor(() => !!doc.querySelector('.toast.danger'), 4000);
  ok(toasted, '越界位序触发 danger toast（业务错误不降级）');

  /* ------------------------------ 汇总 --------------------------------- */
  console.log('\n========================================');
  console.log('通过 ' + passed + ' / ' + (passed + failed));
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('测试进程异常：', e);
  process.exit(1);
});
