export class BookApiError extends Error {
  constructor(status = 503) { super('Book service request failed'); this.status = status; }
}
export const isRonaldoBookMode = (env = process.env) => env.AUTH_PROVIDER === 'central' && env.BOOK_DATA_PROVIDER === 'ronaldo';
const fail = () => { throw new BookApiError(); };
const string = value => typeof value === 'string' ? value : fail();
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : fail();
const boolean = value => typeof value === 'boolean' ? value : fail();
const id = value => /^\d{1,64}$/.test(string(value)) ? value : fail();
const snapshot = value => /^[a-f0-9]{64}$/.test(string(value)) ? value : fail();
const array = (value, maximum = 1000) => Array.isArray(value) && value.length <= maximum ? value : fail();
function historical(row) {
  return { sourceSha256: snapshot(row.sourceSha256), sourceId: id(row.sourceId), number: string(row.number), numberYear: integer(row.numberYear),
    subject: string(row.subject), documentDate: string(row.documentDate), confidential: boolean(row.confidential), published: boolean(row.published),
    cancelled: boolean(row.cancelled), ownerId: string(row.ownerId), ownerDepartmentId: string(row.ownerDepartmentId), pdfPending: boolean(row.pdfPending) };
}

export function createBookClient({ serviceUrl, secret, nodeEnv, fetchImpl = fetch }) {
  const url = new URL(serviceUrl);
  if (url.origin !== serviceUrl || url.username || url.password || typeof secret !== 'string' || secret.length < 32 || /\s/.test(secret) ||
      !(url.protocol === 'https:' || (['development', 'test'].includes(nodeEnv) && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname)))) fail();
  const pending = new Map();
  async function request(operation, actor, payload = {}) {
    try {
      if (!['overview', 'search', 'history', 'detail', 'profile'].includes(operation) || !actor || typeof actor.staffId !== 'string' || !actor.staffId || actor.staffId.length > 128) fail();
      const response = await fetchImpl(`${serviceUrl}/api/v1/genbookno/${operation}`, {
        method: 'POST', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ ...payload, staffId: actor.staffId }),
      });
      if (!response.ok) throw new BookApiError([400, 401, 403, 404, 429].includes(response.status) ? response.status : 503);
      if (!response.body) fail();
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 256 * 1024) { await response.body.cancel().catch(() => {}); fail(); }
        chunks.push(chunk);
      }
      const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data)) fail();
      if (operation === 'profile') {
        if (data.uniStaffId !== null && (typeof data.uniStaffId !== 'string' || !data.uniStaffId.trim() || data.uniStaffId.length > 128)) fail();
        return { uniStaffId: data.uniStaffId === null ? null : data.uniStaffId.trim() };
      }
      if (operation === 'overview') {
        if (data.readOnly !== true || !/^\d{4}-\d{2}-\d{2}$/.test(data.today)) fail();
        for (const name of ['series', 'departments', 'documents', 'sharedDocuments']) if (array(data[name]).length) fail();
        return { series: [], departments: [], documents: [], sharedDocuments: [], today: data.today, readOnly: true, legacyTotal: integer(data.legacyTotal) };
      }
      if (operation === 'search') {
        const pageSize = integer(data.pageSize ?? 20);
        if (![20, 50, 100].includes(pageSize) || pageSize !== Number(payload.filters?.pageSize ?? 20)) fail();
        return { documents: array(data.documents, pageSize).map(row => {
          if (row.kind !== 'legacy') fail();
          return { kind: 'legacy', snapshot: snapshot(row.snapshot), id: id(row.id), number: string(row.number), numberYear: integer(row.numberYear), type: string(row.type), subject: string(row.subject), documentDate: string(row.documentDate), ownerId: string(row.ownerId) };
        }), total: integer(data.total), page: integer(data.page), pageSize, hasMore: boolean(data.hasMore), types: array(data.types).map(string), years: array(data.years).map(integer), readOnly: true };
      }
      if (operation === 'history') return { documents: array(data.documents, 20).map(historical), page: integer(data.page), hasMore: boolean(data.hasMore), readOnly: true };
      const row = historical(data);
      if (row.sourceSha256 !== payload.snapshot || row.sourceId !== payload.sourceId || (data.details !== null && data.details !== undefined)) fail();
      return { ...row, details: null };
    } catch (error) {
      if (error instanceof BookApiError) throw error;
      throw new BookApiError();
    }
  }
  return async (operation, actor, payload = {}) => {
    let key;
    try { key = JSON.stringify([operation, actor?.departmentId, { ...payload, staffId: actor?.staffId }]); }
    catch { throw new BookApiError(); }
    // Multiple tabs may request the same page together. Share only work still
    // in progress for the same verified actor; completed results are never cached.
    let work = pending.get(key);
    if (!work) { work = request(operation, actor, payload); pending.set(key, work); }
    try { return await work; }
    finally { if (pending.get(key) === work) pending.delete(key); }
  };
}
