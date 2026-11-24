import 'server-only';
import mysql, { type Pool } from 'mysql2/promise';
import { IssuanceError } from './input';
import { usesRonaldoBooks } from '../books/server';

let pool: Pool | undefined;
export function getIssuancePool() {
  if (usesRonaldoBooks()) throw new IssuanceError(503, 'เชื่อมข้อมูลเดิมแล้ว การขอเลขและแก้ไขข้อมูลยังไม่เปิดใช้งาน');
  const raw = process.env.ISSUANCE_DATABASE_URL;
  let url: URL;
  try { url = new URL(raw ?? ''); } catch { throw new IssuanceError(503, 'ระบบออกเลขยังไม่พร้อมใช้งาน'); }
  if (process.env.NODE_ENV !== 'development' || url.protocol !== 'mysql:' || url.hostname !== '127.0.0.1' || !/^\/(?:t05_[a-zA-Z0-9_]+|genbook_db)$/.test(url.pathname) || url.search || url.hash) throw new IssuanceError(503, 'ระบบออกเลขยังไม่พร้อมใช้งาน');
  pool ??= mysql.createPool({ host: '127.0.0.1', port: Number(url.port || 3306), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1), connectionLimit: 10, timezone: 'Z', dateStrings: true, charset: 'utf8mb4' });
  return pool;
}
