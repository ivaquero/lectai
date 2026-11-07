/* ==========================================================================
   server/src/http.ts —— 统一应答外壳 + 请求校验
   --------------------------------------------------------------------------
   外壳与 core/response.py 逐字段一致：
     成功   { code: 0, msg: "ok", data: <载荷> }   HTTP 200
     业务错 { code: 1, msg: <中文文案>, data: null } HTTP 200
   业务错误（栈空、位序越界）一律 200，前端只看 code——这是既有契约，不能改。

   参数不合法则走 422（对齐 FastAPI/Pydantic 的状态码）。差别在于：FastAPI 的
   422 body 是 {detail:[...]}，前端只能显示 "HTTP 422"；这里额外带上 msg，
   前端会显示具体原因。状态码一致、错误文案更可读，属于有意为之的改进。
   ========================================================================== */

export interface Envelope<T> {
  code: 0 | 1;
  msg: string;
  data: T;
}

export function ok<T>(data: T, msg = 'ok'): Envelope<T> {
  return { code: 0, msg, data };
}

export function err(msg: string): Envelope<null> {
  return { code: 1, msg, data: null };
}

/** 携带 HTTP 状态的异常；由 app.ts 的 errorHandler 统一转成 JSON */
export class HttpError extends Error {
  readonly status: number;
  readonly detail: unknown;

  constructor(status: number, message: string, detail: unknown = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

/** 参数不合法 → 422（对应 Pydantic 的 ValidationError 语义） */
export class BadRequest extends HttpError {
  constructor(message: string, loc: (string | number)[]) {
    super(422, message, [{ loc, msg: message, type: 'value_error' }]);
  }
}

type Body = Record<string, unknown>;

function asBody(raw: unknown): Body {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Body) : {};
}

/**
 * 取一个整数字段。
 * Pydantic 在 lax 模式下接受 "3" 这类数字字符串并强制转 int，这里保持一致；
 * 小数、布尔、空串一律 422。
 */
export function intField(
  raw: unknown,
  name: string,
  opts: { min?: number; max?: number } = {}
): number {
  const body = asBody(raw);
  const v = body[name];

  if (v === undefined || v === null) {
    throw new BadRequest(`参数缺失：${name}`, ['body', name]);
  }

  let n: number;
  if (typeof v === 'number') {
    n = v;
  } else if (typeof v === 'string' && v.trim() !== '') {
    n = Number(v);
  } else {
    throw new BadRequest(`参数不合法：${name} 必须是整数`, ['body', name]);
  }

  if (!Number.isInteger(n)) {
    throw new BadRequest(`参数不合法：${name} 必须是整数`, ['body', name]);
  }
  if (opts.min !== undefined && n < opts.min) {
    throw new BadRequest(`参数越界：${name} 不能小于 ${opts.min}`, ['body', name]);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw new BadRequest(`参数越界：${name} 不能大于 ${opts.max}`, ['body', name]);
  }
  return n;
}

/** 取整数数组；长度上限与 Pydantic 的 max_length 对齐 */
export function intArrayField(raw: unknown, name: string, maxLen: number): number[] {
  const body = asBody(raw);
  const v = body[name];

  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) {
    throw new BadRequest(`参数不合法：${name} 必须是整数数组`, ['body', name]);
  }
  if (v.length > maxLen) {
    throw new BadRequest(`最多支持 ${maxLen} 个元素，收到 ${v.length} 个`, ['body', name]);
  }
  return v.map((item, i) => {
    if (typeof item === 'number' && Number.isInteger(item)) return item;
    if (typeof item === 'string' && item.trim() !== '' && Number.isInteger(Number(item))) {
      return Number(item);
    }
    throw new BadRequest(`参数不合法：${name}[${i}] 必须是整数`, ['body', name, i]);
  });
}

/** 取必填字符串字段 */
export function stringField(
  raw: unknown,
  name: string,
  opts: { minLength?: number; maxLength?: number } = {}
): string {
  const body = asBody(raw);
  const v = body[name];

  if (typeof v !== 'string') {
    throw new BadRequest(`参数缺失或类型错误：${name}`, ['body', name]);
  }
  const len = [...v].length;
  if (opts.minLength !== undefined && len < opts.minLength) {
    throw new BadRequest(`参数过短：${name} 至少 ${opts.minLength} 个字符`, ['body', name]);
  }
  if (opts.maxLength !== undefined && len > opts.maxLength) {
    throw new BadRequest(`参数过长：${name} 最多 ${opts.maxLength} 个字符`, ['body', name]);
  }
  return v;
}

/** 查询串必填参数 */
export function queryField(query: unknown, name: string): string {
  const q = asBody(query);
  const v = q[name];
  if (typeof v !== 'string' || v === '') {
    throw new BadRequest(`查询参数缺失：${name}`, ['query', name]);
  }
  return v;
}
