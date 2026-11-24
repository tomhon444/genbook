import 'server-only';
import { createBookClient, isRonaldoBookMode, BookApiError } from './ronaldo.mjs';
import { IssuanceError } from '../issuance/input';
import type { Identity } from '../auth/server';

export const usesRonaldoBooks = () => isRonaldoBookMode();
let client: ReturnType<typeof createBookClient> | undefined;
export async function readRonaldoBooks(operation: 'overview' | 'search' | 'history' | 'detail' | 'profile', actor: Identity, payload: Record<string, unknown> = {}) {
  try {
    client ??= createBookClient({ serviceUrl: process.env.RONALDO_SERVICE_URL, secret: process.env.RONALDO_GENBOOKNO_SECRET, nodeEnv: process.env.NODE_ENV });
    return await client(operation, actor, payload);
  } catch (error) {
    const status = error instanceof BookApiError ? error.status : 503;
    const messages: Record<number, string> = { 400: 'ข้อมูลค้นหาไม่ถูกต้อง', 401: 'กรุณาเข้าสู่ระบบอีกครั้ง', 403: 'ไม่มีสิทธิ์อ่านข้อมูลนี้', 404: 'ไม่พบรายการ', 429: 'คำขอมากเกินไป กรุณาลองใหม่' };
    throw new IssuanceError(status, messages[status] ?? 'ระบบข้อมูลหนังสือไม่พร้อมใช้งาน กรุณาลองใหม่');
  }
}
