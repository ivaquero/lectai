/* ==========================================================================
   server/src/session.ts —— 会话状态
   --------------------------------------------------------------------------
   三点设计决定，都是有意的：

   1) 没有锁。Node 单线程执行 JS，一个请求的处理函数不会与另一个交错，锁整层
      消失。代价是「不许在请求处理里做同步阻塞 I/O」——本项目只在启动时读盘，成立。
   2) LRU 用 Map 的插入顺序实现：命中即删后重插，淘汰永远从迭代器头部取。
   3) TTL 用 Date.now()：单调递增足够用，且与对外暴露的 uptime 同一时间源。

   容器一律空表起步：教学初始序列由前端挂载时调 /trace/build 显式载入，
   服务端不预填（否则「打开页面就有数据」和「会话隔离」两件事会互相污染）。
   ========================================================================== */

import { list as LL, stack as S, queue as Q } from './engine';
import type { TraceList, TraceQueue, TraceStack } from './engine';
import { SESSION_MAX, SESSION_TTL_SEC } from './env';

const SID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TTL_MS = SESSION_TTL_SEC * 1000;

export interface QuizStat {
  done: number;
  right: number;
}

export interface Session {
  list: TraceList;
  stack: TraceStack;
  queue: TraceQueue;
  quizStats: Record<string, QuizStat>;
  /** 到期时刻（ms）；每次命中顺延 */
  expiresAt: number;
}

/** 插入顺序即 LRU 顺序：越靠前越旧 */
const store = new Map<string, Session>();

/** 把请求头里的原始 sid 规整成合法值；非法/缺失回退 default（不抛错，避免被探测打崩） */
export function normalizeSid(raw: string | string[] | undefined | null): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return 'default';
  const sid = value.trim();
  if (!SID_RE.test(sid)) {
    console.warn("rejected invalid X-Session-Id %j -> 'default'", value.slice(0, 80));
    return 'default';
  }
  return sid;
}

function create(): Session {
  return {
    list: new LL.TraceList([]),
    stack: new S.TraceStack([]),
    queue: new Q.TraceQueue([]),
    quizStats: {},
    expiresAt: 0
  };
}

/** 只会淘汰队首：同一 TTL 下越靠前越早过期 */
function sweepExpired(now: number): void {
  for (const [key, session] of store) {
    if (session.expiresAt > now) break;
    store.delete(key);
  }
}

export function getSession(rawSid?: string | string[] | null): Session {
  const sid = normalizeSid(rawSid);
  const now = Date.now();
  sweepExpired(now);

  const hit = store.get(sid);
  if (hit) {
    store.delete(sid);
    hit.expiresAt = now + TTL_MS;
    store.set(sid, hit);
    return hit;
  }

  const fresh = create();
  fresh.expiresAt = now + TTL_MS;
  store.set(sid, fresh);

  while (store.size > SESSION_MAX) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
  return fresh;
}

export function sessionCount(): number {
  return store.size;
}

export function sessionStats(): { active: number; max: number; ttl_sec: number } {
  return { active: store.size, max: SESSION_MAX, ttl_sec: SESSION_TTL_SEC };
}

/** 测试辅助：清空全部会话 */
export function resetSessions(): void {
  store.clear();
}
