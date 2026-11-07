#!/usr/bin/env node
/* ==========================================================================
   tools/check-deps.mjs —— 幽灵依赖检查
   --------------------------------------------------------------------------
   为什么需要这个：仓库用 hoisted 布局（见 pnpm-workspace.yaml），所有依赖
   都平铺在根 node_modules 里。好处是子包不再各长一个 node_modules，代价是
   Node 的解析不再受 package.json 约束——某个包没声明、但被别的包捎带装上了，
   import 依然成功。isolated 布局会当场 MODULE_NOT_FOUND，hoisted 则静默通过，
   等到依赖树变动、或换一台机器时才炸。

   本脚本把这条防线补回来：扫源码里的裸模块 import，和该包 package.json 的
   声明做差集，多出来的就是幽灵依赖。

   用法：
     node tools/check-deps.mjs          # 人类可读报告，有问题返回 1
     node tools/check-deps.mjs --json   # 机器可读

   判定规则：
     · 相对路径（. / ..）、绝对路径、node: 前缀、内置模块 —— 不算依赖
     · @scope/name/sub/path 一律归并到 @scope/name
     · 类型包不做推断：@types/* 由 tsc 隐式取用，不参与比对
     · 只报「用了但没声明」；声明了却没用到不报（tsc / esbuild 这类工具
       只在脚本里以可执行文件名出现，静态扫不出来，报了全是噪音）
   ========================================================================== */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 每个 workspace 成员：package.json 位置 + 需要扫描的源码范围 */
const MEMBERS = [
  {
    name: 'lectai-web',
    dir: join(ROOT, 'web'),
    scan: ['src', 'tests', 'scripts', 'vite.config.mjs']
  },
  {
    name: '@lectai/server',
    dir: join(ROOT, 'server'),
    scan: ['src', 'tests', 'build.mjs']
  }
];

const SOURCE_EXT = /\.(js|mjs|cjs|ts|mts|cts|jsx|tsx)$/;
const BUILTINS = new Set(builtinModules);

/* ------------------------------ 收集 import ------------------------------ */

/** 四种写法都覆盖：import x from / import 'x' / import('x') / require('x') */
const PATTERNS = [
  /\bfrom\s+['"]([^'"]+)['"]/g,
  /\bimport\s+['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

function walk(target, out) {
  let st;
  try {
    st = statSync(target);
  } catch {
    return out; // 配置里列了但文件不存在（例如还没建 tests/），不算错
  }
  if (st.isFile()) {
    if (SOURCE_EXT.test(target)) out.push(target);
    return out;
  }
  for (const entry of readdirSync(target)) out = walk(join(target, entry), out);
  return out;
}

/** 注释里的 import 不该被当真；先剥掉块注释与行注释再扫 */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');
}

/** 'node:fs' / 'fs' / './x' / '@scope/pkg/sub' → 归一化后的包名，或 null（不算依赖） */
function toPackageName(spec) {
  if (!spec) return null;
  if (spec.startsWith('.') || spec.startsWith('/')) return null;
  if (spec.startsWith('node:')) return null;
  if (spec.startsWith('#')) return null; // package.json imports 字段
  const bare = spec.replace(/^[a-z]+:/i, ''); // 形如 'virtual:' / 'data:' 的协议
  if (bare !== spec && !spec.startsWith('@')) return null;
  if (BUILTINS.has(bare)) return null;
  const parts = bare.split('/');
  return bare.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function collectImports(file) {
  const code = stripComments(readFileSync(file, 'utf8'));
  const found = new Map(); // 包名 → 首个出现位置
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) {
      const name = toPackageName(m[1]);
      if (name && !found.has(name)) found.set(name, m[1]);
    }
  }
  return found;
}

/* -------------------------------- 主流程 -------------------------------- */

const problems = [];
const summary = [];

for (const member of MEMBERS) {
  const pkg = JSON.parse(readFileSync(join(member.dir, 'package.json'), 'utf8'));
  const declared = new Set([
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
    ...Object.keys(pkg.peerDependencies || {}),
    ...Object.keys(pkg.optionalDependencies || {})
  ]);

  const files = member.scan.flatMap((p) => walk(join(member.dir, p), []));
  const used = new Map();
  for (const file of files) {
    for (const [name, spec] of collectImports(file)) {
      if (!used.has(name)) used.set(name, { file: relative(ROOT, file), spec });
    }
  }

  const ghosts = [...used.keys()].filter((n) => !declared.has(n) && !n.startsWith('@types/'));
  for (const name of ghosts) {
    const at = used.get(name);
    problems.push({
      member: member.name,
      package: name,
      file: at.file,
      spec: at.spec
    });
  }

  summary.push({
    member: member.name,
    files: files.length,
    imports: used.size,
    declared: declared.size,
    ghosts: ghosts.length
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ summary, problems }, null, 2));
} else {
  console.log('幽灵依赖检查（hoisted 布局下的必需护栏）\n');
  for (const s of summary) {
    console.log(
      `  ${s.member.padEnd(16)} 扫描 ${String(s.files).padStart(3)} 个文件 · ` +
        `裸 import ${String(s.imports).padStart(2)} 个 · 声明 ${String(s.declared).padStart(2)} 个 · ` +
        `幽灵 ${s.ghosts}`
    );
  }
  if (problems.length) {
    console.log('\n发现未声明的依赖：\n');
    for (const p of problems) {
      console.log(`  ✗ ${p.package}  ← ${p.file}`);
      console.log(`      (${p.member} 的 package.json 里没有它)`);
    }
    console.log('\nhoisted 布局不会拦下这些，请补进对应的 package.json。');
  } else {
    console.log('\n没有幽灵依赖：所有裸 import 都在 package.json 里声明过。');
  }
}

process.exit(problems.length ? 1 : 0);
