import 'server-only';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { GenbooknoError } from './client';

export const MAX_PDF = 2097152;

/** Reads at most 2 MiB of application/pdf and validates it in an isolated process. */
export async function readPdfBody(request: Request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/pdf') throw new GenbooknoError(415, 'รับเฉพาะ PDF');
  const reader = request.body?.getReader();
  if (!reader) throw new GenbooknoError(400, 'กรุณาเลือก PDF');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PDF) { await reader.cancel(); throw new GenbooknoError(413, 'PDF ต้องไม่เกิน 2 MiB (2,097,152 bytes)'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  // Isolate untrusted parsing with memory and time limits.
  const valid = await new Promise<boolean>(resolve => {
    const child = spawn(process.execPath, ['--max-old-space-size=128', path.join(process.cwd(), 'tools/pdf/validate.mjs')], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 5000);
    child.once('error', () => { clearTimeout(timer); resolve(false); });
    child.once('exit', code => { clearTimeout(timer); resolve(code === 0); });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
  if (!valid) throw new GenbooknoError(400, 'PDF เสียหาย เข้ารหัส หรืออ่านโครงสร้างไม่ได้');
  return bytes;
}
