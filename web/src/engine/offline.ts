/* ==========================================================================
   engine/offline.ts —— 离线轨迹桥：REST 路径 → 本地引擎
   --------------------------------------------------------------------------
   为什么需要这一层：服务端（backend/algo）把「容器状态 + 一步一快照」放在
   会话 store 里，前端只认 REST。断网后要把同一批接口无缝接过来，缺的不是算法
   （engine/ 已有），而是「路径 → 调用」的映射、会话容器、以及应答外壳。

   应答外壳与 core/response.py 对齐：
     · 成功  {ok:true,  data:<载荷>, msg:'ok'}      —— 载荷形状与后端 ok() 完全一致
     · 业务错 {ok:false, data:null, msg:<文案>}     —— 栈空 / 越界等，对应 Python 的 err()

   状态持久化：容器状态（只存 values）写 sessionStorage。原因有两个——
     · 后端会话按 sessionStorage 里的 sid 隔离；离线时页面刷新 / 切模块也会整页
       重载（visual.html#stack / #queue），不持久化就等于每次切页都把容器清空；
     · 只存 int 数组，体积可忽略，也不存在「旧结构读不出来」的迁移问题。

   与后端的取舍：本地容器只有一份 values，指针 / 计数 / 轨迹全部由引擎按操作
   现场生成，所以不存在「存了半条轨迹」的可能。
   ========================================================================== */

import * as LL from './linkedlist';
import { OPS } from './ops';
import * as Q from './queue';
import * as S from './stack';
import type { ItemView, OpTable } from './types';

export interface LocalResp {
  ok: boolean;
  data: unknown;
  msg: string;
}

export type Kind = 'list' | 'stack' | 'queue';

/** 与 offline.js 里的同名字符串必须一致（那边只做内存暂存，不碰这个键） */
const STORE_KEY = 'ds-local-trace.v1';

interface Snapshot {
  list?: number[];
  stack?: number[];
  queue?: number[];
}

/* ------------------------------------------------------------ 会话容器 */

let listC: LL.TraceList | null = null;
let stackC: S.TraceStack | null = null;
let queueC: Q.TraceQueue | null = null;

function readStore(): Snapshot {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Snapshot;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // 隐私模式 / 配额满 / 非浏览器环境：退化为纯内存
    return {};
  }
}

function writeStore(patch: Snapshot): void {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({ ...readStore(), ...patch }));
  } catch {
    /* 同上，忽略写入失败 */
  }
}

function list(): LL.TraceList {
  if (!listC) listC = new LL.TraceList(readStore().list ?? []);
  return listC;
}

function stack(): S.TraceStack {
  if (!stackC) stackC = new S.TraceStack(readStore().stack ?? []);
  return stackC;
}

function queue(): Q.TraceQueue {
  if (!queueC) queueC = new Q.TraceQueue(readStore().queue ?? []);
  return queueC;
}

function valuesOf(kind: Kind): number[] {
  if (kind === 'list') return list().values();
  if (kind === 'stack') return stack().values();
  return queue().values();
}

function adopt(kind: Kind, values: readonly number[]): void {
  if (kind === 'list') listC = new LL.TraceList(values);
  else if (kind === 'stack') stackC = new S.TraceStack(values);
  else queueC = new Q.TraceQueue(values);

  const patch: Snapshot = {};
  patch[kind] = [...values];
  writeStore(patch);
}

/**
 * 用后端最近一次已知状态覆盖本地容器。
 * 由 core/offline.js 在「在线期间收到轨迹 / 状态应答」时记录、离线启用时灌入，
 * 这样断网那一刻画布上的内容不会重置成空表。
 */
export function seed(values: Partial<Record<Kind, readonly number[]>>): void {
  (Object.keys(values) as Kind[]).forEach((kind) => {
    const v = values[kind];
    if (Array.isArray(v)) adopt(kind, v);
  });
}

/* -------------------------------------------------------------- 应答外壳 */

function ok(data: unknown): LocalResp {
  return { ok: true, data, msg: 'ok' };
}

function err(msg: string): LocalResp {
  return { ok: false, data: null, msg };
}

/* ------------------------------------------------------------ 路径 → 操作 */

function tableOf(kind: Kind): { table: OpTable; max: number } {
  if (kind === 'list') return { table: OPS.list, max: LL.MAX_NODES };
  if (kind === 'stack') return { table: OPS.stack, max: S.MAX_ITEMS };
  return { table: OPS.queue, max: Q.MAX_ITEMS - 1 };
}

/** 与 api/trace.py、api/stackqueue_trace.py 的 _ops_payload 逐字段一致 */
function opsPayload(kind: Kind): unknown {
  const { table, max } = tableOf(kind);
  return {
    module: kind === 'list' ? 'linkedlist' : kind,
    max_nodes: max,
    ops: Object.keys(table).map((key) => ({
      key,
      title: table[key].title,
      lines: table[key].lines,
      structural: table[key].structural,
    })),
  };
}

function stateOf(kind: Kind): unknown {
  if (kind === 'list') return LL.statePayload(list());
  if (kind === 'stack') return S.statePayload(stack());
  return Q.statePayload(queue());
}

function requireInt(v: unknown, name: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new LL.OpError(`参数不合法：${name} 必须是整数`);
  }
  return n;
}

function ints(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => requireInt(x, 'values'));
}

type Body = Record<string, unknown>;

/** 执行一个操作，返回载荷；未知操作返回 null（由上层当作「不接管」） */
function run(kind: Kind, op: string, body: Body): unknown {
  if (kind === 'list') {
    const c = list();
    switch (op) {
      case 'build':
        return LL.opBuild(c, ints(body.values));
      case 'insert-head':
        return LL.opInsertHead(c, requireInt(body.value, 'value'));
      case 'insert-tail':
        return LL.opInsertTail(c, requireInt(body.value, 'value'));
      case 'delete-pos':
        return LL.opDeletePos(c, requireInt(body.pos, 'pos'));
      case 'delete-value':
        return LL.opDeleteValue(c, requireInt(body.value, 'value'));
      case 'search':
        return LL.opSearch(c, requireInt(body.value, 'value'));
      case 'traverse':
        return LL.opTraverse(c);
      default:
        return null;
    }
  }

  if (kind === 'stack') {
    const c = stack();
    switch (op) {
      case 'build':
        return S.opBuild(c, ints(body.values));
      case 'push':
        return S.opPush(c, requireInt(body.value, 'value'));
      case 'pop':
        return S.opPop(c);
      case 'peek':
        return S.opPeek(c);
      case 'traverse':
        return S.opTraverse(c);
      default:
        return null;
    }
  }

  const c = queue();
  switch (op) {
    case 'build':
      return Q.opBuild(c, ints(body.values));
    case 'enqueue':
      return Q.opEnqueue(c, requireInt(body.value, 'value'));
    case 'dequeue':
      return Q.opDequeue(c);
    case 'peek':
      return Q.opPeek(c);
    case 'traverse':
      return Q.opTraverse(c);
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- 入口 */

/**
 * @param method GET / POST
 * @param path   含 query 的接口路径
 * @param body   POST 请求体
 * @returns 命中返回应答；本模块不接管的路径返回 null（交回上层走原离线提示）
 */
export function handle(method: string, path: string, body?: unknown): LocalResp | null {
  let p: string;
  try {
    p = new URL(path, 'http://offline.local').pathname;
  } catch {
    return null;
  }

  const m = /^\/api\/(linkedlist|stack|queue)(\/ops|\/trace\/state|\/trace\/[a-z-]+)$/.exec(p);
  if (!m) return null;

  const kind: Kind = m[1] === 'linkedlist' ? 'list' : (m[1] as Kind);
  const tail = m[2];
  const verb = (method || 'GET').toUpperCase();

  if (tail === '/ops') return verb === 'GET' ? ok(opsPayload(kind)) : null;
  if (tail === '/trace/state') return verb === 'GET' ? ok(stateOf(kind)) : null;
  if (verb !== 'POST') return null;

  try {
    const payload = run(kind, tail.slice('/trace/'.length), (body || {}) as Body);
    if (payload === null) return null;
    const patch: Snapshot = {};
    patch[kind] = valuesOf(kind);
    writeStore(patch);
    return ok(payload);
  } catch (e) {
    if (e instanceof LL.OpError) return err(e.message);
    // 真实缺陷不该被静默吞掉：控制台留全量，界面给一句可读文案
    if (typeof console !== 'undefined') console.error('[lectai] 本地轨迹引擎异常', e);
    return err('本地引擎异常：' + (e instanceof Error ? e.message : String(e)));
  }
}

/** 从响应载荷里取容器当前值（后端应答 → 本地容器）。取不到返回 null */
export function valuesFromPayload(data: unknown): number[] | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as { trace?: unknown; nodes?: unknown; items?: unknown };
  const trace = Array.isArray(payload.trace) ? payload.trace : [];
  const step = (trace.length
    ? trace[trace.length - 1]
    : payload) as { nodes?: ItemView[]; items?: ItemView[] } | null;
  const items = step ? step.nodes || step.items : null;
  if (!Array.isArray(items)) return null;
  return items.map((it) => it.value);
}

/* ------------------------------------------------------------ 测试辅助 */

/** 丢掉内存容器，保留已持久化的状态（模拟「重新打开页面」） */
export function dropMemory(): void {
  listC = null;
  stackC = null;
  queueC = null;
}

/** 清空内存与持久化状态 */
export function reset(): void {
  dropMemory();
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* 忽略 */
  }
}
