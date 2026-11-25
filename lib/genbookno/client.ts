import 'server-only';

/** Error with a status and a user-facing (Thai) message. */
export class GenbooknoError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

// genbook never connects to a database: every book read/write goes to the
// ronaldo-service genbookno module (ADR 0004, T15). The secret stays server-side.
function settings() {
  const serviceUrl = process.env.RONALDO_SERVICE_URL ?? '';
  const secret = process.env.GENBOOKNO_API_SECRET ?? '';
  let url: URL;
  try { url = new URL(serviceUrl); } catch { throw new GenbooknoError(503, 'ระบบเลขหนังสือยังไม่พร้อมใช้งาน'); }
  const local = process.env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname);
  if (url.origin !== serviceUrl || url.username || url.password || !(url.protocol === 'https:' || local)
      || secret.length < 32 || /\s/.test(secret) || /^change-me/i.test(secret)) throw new GenbooknoError(503, 'ระบบเลขหนังสือยังไม่พร้อมใช้งาน');
  return { base: `${url.origin}/api/v1/genbookno`, secret };
}

async function call(path: string, init: { body: BodyInit; type: string; headers?: Record<string, string>; timeoutMs?: number }) {
  const { base, secret } = settings();
  let response: Response;
  try {
    response = await fetch(`${base}/${path}`, {
      method: path.endsWith('/pdf') && init.type === 'application/pdf' ? 'PUT' : 'POST', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(init.timeoutMs ?? 10000),
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': init.type, ...init.headers },
      body: init.body,
    });
  } catch { throw new GenbooknoError(503, 'ติดต่อระบบเลขหนังสือไม่ได้ กรุณาลองใหม่'); }
  if (response.ok) return response;
  let message = '';
  try { const body = await response.json() as { message?: unknown }; message = typeof body.message === 'string' ? body.message : ''; } catch { /* Non-JSON error body. */ }
  if (response.status === 401) throw new GenbooknoError(401, 'กรุณาเข้าสู่ระบบอีกครั้ง');
  if (response.status === 429) throw new GenbooknoError(429, 'มีคำขอมากเกินไป กรุณารอสักครู่');
  if (response.status === 404) throw new GenbooknoError(404, /[\u0E00-\u0E7F]/.test(message) ? message : 'ไม่พบรายการ');
  // Thai messages are the service's user-facing business rules; others are internal.
  if (response.status < 500 && /[\u0E00-\u0E7F]/.test(message)) throw new GenbooknoError(response.status, message);
  if (response.status < 500) throw new GenbooknoError(response.status, 'ข้อมูลไม่ถูกต้อง');
  throw new GenbooknoError(503, /[\u0E00-\u0E7F]/.test(message) ? message : 'ระบบเลขหนังสือไม่พร้อมใช้งาน กรุณาลองใหม่');
}

/** POST /api/v1/genbookno/<path> with the actor's staff id; returns parsed JSON. */
export async function genbookno<T = unknown>(path: string, staffId: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await call(path, { body: JSON.stringify({ ...body, staffId }), type: 'application/json' });
  return await response.json() as T;
}

export async function downloadPdf(staffId: string, id: string) {
  const response = await call('books/pdf', { body: JSON.stringify({ staffId, id }), type: 'application/json', timeoutMs: 30000 });
  return Buffer.from(await response.arrayBuffer());
}

export async function uploadPdf<T = unknown>(staffId: string, id: string, version: number, bytes: Buffer): Promise<T> {
  const response = await call(`books/${id}/pdf`, { body: new Uint8Array(bytes), type: 'application/pdf', headers: { 'X-Staff-Id': staffId, 'If-Match': String(version) }, timeoutMs: 30000 });
  return await response.json() as T;
}

/** Maps any failure to a JSON response with a safe Thai message. */
export function failure(error: unknown, fallback: string) {
  const status = error instanceof GenbooknoError ? error.status : 503;
  const message = error instanceof GenbooknoError ? error.message : fallback;
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
}

/** Reads a bounded JSON request body. */
export async function readJson(request: Request) {
  const text = await request.text();
  if (text.length > 16384) throw new GenbooknoError(400, 'ข้อมูลยาวเกินกำหนด');
  try { return JSON.parse(text) as unknown; } catch { throw new GenbooknoError(400, 'ข้อมูลไม่ถูกต้อง'); }
}

export const isBookId = (id: string) => /^\d{1,11}$/.test(id);
