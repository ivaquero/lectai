/* ==========================================================================
   server/src/routes/trace.ts —— 链表 / 栈 / 队列的轨迹接口
   --------------------------------------------------------------------------
   对应 api/trace.py + api/stackqueue_trace.py，三个模块共用一套注册逻辑：

     GET  <prefix>/ops          操作注册表（key/title/lines/structural）
     GET  <prefix>/trace/state  当前容器状态（无轨迹）
     POST <prefix>/trace/<op>   执行一步，返回整条轨迹

   ★ 与 Python 版的关键差异：没有 session_lock。
     Python 的同步 def 跑在线程池，同一 sid 的并发请求会同时读写同一个容器，
     所以每个接口都套了 RLock；Node 的单个请求处理函数不会被其他请求打断，
     这层锁没有存在意义。代价是请求里不许再出现同步阻塞 I/O。

   ★ POST 路由的操作清单直接来自 OPS 登记表，而不是手写七次：
     新增操作只需改 algo/ → 重导 ops.generated.json，路由自动跟上。
   ========================================================================== */

import type { FastifyInstance, FastifyRequest } from 'fastify';

import { OPS, OpError, list as LL, queue as Q, stack as S } from '../engine';
import type { Session } from '../session';
import { getSession } from '../session';
import { err, intArrayField, intField, ok } from '../http';

type Kind = 'list' | 'stack' | 'queue';

interface KindSpec {
  /** /api/linkedlist | /api/stack | /api/queue */
  routeBase: string;
  /** 应答里的 module 名（链表叫 linkedlist，不是 list） */
  moduleName: string;
  /** /ops 里的 max_nodes；队列是「容量 - 1」，与 Python 侧一致 */
  maxNodes: number;
  /** build 的 values 上限（Python 的 ValuesIn 三处都用 ST.MAX_ITEMS） */
  valuesMax: number;
}

const SPECS: Record<Kind, KindSpec> = {
  list: {
    routeBase: '/api/linkedlist',
    moduleName: 'linkedlist',
    maxNodes: LL.MAX_NODES,
    valuesMax: LL.MAX_NODES
  },
  stack: {
    routeBase: '/api/stack',
    moduleName: 'stack',
    maxNodes: S.MAX_ITEMS,
    valuesMax: S.MAX_ITEMS
  },
  queue: {
    routeBase: '/api/queue',
    moduleName: 'queue',
    // Python: _ops_payload("queue", Q.OPS, Q.CAPACITY - 1)
    maxNodes: Q.CAPACITY - 1,
    valuesMax: Q.MAX_ITEMS
  }
};

const KINDS: Kind[] = ['list', 'stack', 'queue'];

function sid(req: FastifyRequest): string | string[] | undefined {
  return req.headers['x-session-id'] as string | string[] | undefined;
}

/** 执行一个操作并返回载荷；业务错误由调用方转成 code=1 */
function runOp(kind: Kind, session: Session, op: string, body: unknown): unknown {
  if (kind === 'list') {
    const c = session.list;
    switch (op) {
      case 'build':
        return LL.opBuild(c, intArrayField(body, 'values', SPECS.list.valuesMax));
      case 'insert-head':
        return LL.opInsertHead(c, intField(body, 'value', { min: -9999, max: 9999 }));
      case 'insert-tail':
        return LL.opInsertTail(c, intField(body, 'value', { min: -9999, max: 9999 }));
      case 'delete-pos':
        return LL.opDeletePos(c, intField(body, 'pos', { min: 1 }));
      case 'delete-value':
        return LL.opDeleteValue(c, intField(body, 'value', { min: -9999, max: 9999 }));
      case 'search':
        return LL.opSearch(c, intField(body, 'value', { min: -9999, max: 9999 }));
      case 'traverse':
        return LL.opTraverse(c);
      default:
        return null;
    }
  }

  if (kind === 'stack') {
    const c = session.stack;
    switch (op) {
      case 'build':
        return S.opBuild(c, intArrayField(body, 'values', SPECS.stack.valuesMax));
      case 'push':
        return S.opPush(c, intField(body, 'value', { min: -9999, max: 9999 }));
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

  const c = session.queue;
  switch (op) {
    case 'build':
      return Q.opBuild(c, intArrayField(body, 'values', SPECS.queue.valuesMax));
    case 'enqueue':
      return Q.opEnqueue(c, intField(body, 'value', { min: -9999, max: 9999 }));
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

function statePayload(kind: Kind, session: Session): unknown {
  if (kind === 'list') return LL.statePayload(session.list);
  if (kind === 'stack') return S.statePayload(session.stack);
  return Q.statePayload(session.queue);
}

function opsPayload(kind: Kind): unknown {
  const spec = SPECS[kind];
  const table = OPS[kind];
  return {
    module: spec.moduleName,
    max_nodes: spec.maxNodes,
    ops: Object.keys(table).map((key) => ({
      key,
      title: table[key].title,
      lines: table[key].lines,
      structural: table[key].structural
    }))
  };
}

export function registerTraceRoutes(app: FastifyInstance): void {
  for (const kind of KINDS) {
    const spec = SPECS[kind];

    app.get(`${spec.routeBase}/ops`, async () => ok(opsPayload(kind)));

    app.get(`${spec.routeBase}/trace/state`, async (req) => {
      const session = getSession(sid(req));
      return ok(statePayload(kind, session));
    });

    for (const op of Object.keys(OPS[kind])) {
      app.post(`${spec.routeBase}/trace/${op}`, async (req) => {
        const session = getSession(sid(req));
        try {
          const payload = runOp(kind, session, op, req.body);
          if (payload === null) {
            return err(`接口不存在：${spec.routeBase}/trace/${op}`);
          }
          return ok(payload);
        } catch (e) {
          // 业务错误（栈空 / 位序越界 / 已达上限）走 code=1，HTTP 仍 200
          if (e instanceof OpError) return err(e.message);
          throw e;
        }
      });
    }
  }
}
