/* ==========================================================================
   tests/_diff.js —— 逐字节比对工具
   --------------------------------------------------------------------------
   parity.test.js（引擎 ↔ golden）与 offline-engine.test.js（REST 适配层 ↔
   golden）共用同一份比较逻辑：两边对「什么算不一致」的判定必须完全一致，
   否则一条说红、另一条说绿，防线就失效了。

   返回第一处差异的描述；完全一致返回 null。
   ========================================================================== */
'use strict';

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function diff(actual, expected, at) {
  const p = at || '';
  if (typeOf(actual) !== typeOf(expected)) {
    return `${p || '<root>'}: 类型不同（期望 ${typeOf(expected)}，实际 ${typeOf(actual)}）`;
  }
  const t = typeOf(actual);

  if (t === 'array') {
    if (actual.length !== expected.length) {
      return `${p}.length: 期望 ${expected.length}，实际 ${actual.length}`;
    }
    for (let i = 0; i < actual.length; i += 1) {
      const d = diff(actual[i], expected[i], `${p}[${i}]`);
      if (d) return d;
    }
    return null;
  }

  if (t === 'object') {
    const ka = Object.keys(actual).sort();
    const ke = Object.keys(expected).sort();
    for (const k of ke) {
      if (!(k in actual)) return `${p}.${k}: 期望有此字段，实际缺失`;
    }
    for (const k of ka) {
      if (!(k in expected)) return `${p}.${k}: 实际多出此字段`;
    }
    for (const k of ke) {
      const d = diff(actual[k], expected[k], `${p}.${k}`);
      if (d) return d;
    }
    return null;
  }

  if (actual !== expected) {
    return `${p}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`;
  }
  return null;
}

module.exports = { diff, typeOf };
