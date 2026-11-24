import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

export const hash = value => createHash('sha256').update(value).digest('hex');
const tables = { book: 'idbook', bookdept: 'bookdept_id', genbook: 'gen_book_id', genbook_inform: 'gen_book_inform_id', genbook_dept: 'gen_book_dept_id', typebook: 'idtypebook' };

// Parse literals, never execute the dump. Accept only this export's INSERT grammar.
// A quote-aware scanner handles embedded newlines, semicolons and MySQL escapes.
export function parseValues(text, start, width) {
  let i = start;
  const records = [];
  const ws = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  const fail = () => { throw new Error('Unsupported SQL literal/row width; no SQL was executed'); };
  while (true) {
    ws(); if (text[i++] !== '(') fail();
    const row = [];
    while (true) {
      ws(); let value;
      if (text[i] === "'") {
        i++; value = ''; let closed = false;
        while (i < text.length) {
          const c = text[i++];
          if (c === '\\') {
            const escaped = text[i++];
            if (escaped === undefined) fail();
            value += ({ '0': '\0', n: '\n', r: '\r', t: '\t', b: '\b', Z: '\x1a' })[escaped] ?? escaped;
          } else if (c === "'") {
            if (text[i] === "'") { value += "'"; i++; } else { closed = true; break; }
          } else value += c;
        }
        if (!closed) fail();
      } else {
        const literal = /^(NULL|-?\d+)/.exec(text.slice(i));
        if (!literal) fail();
        i += literal[0].length;
        value = literal[0] === 'NULL' ? null : literal[0];
      }
      row.push(value); ws();
      const delimiter = text[i++];
      if (delimiter === ')') break;
      if (delimiter !== ',') fail();
    }
    if (row.length !== width) fail();
    records.push(row); ws();
    const delimiter = text[i++];
    if (delimiter === ';') return { records, end: i };
    if (delimiter !== ',') fail();
  }
}

export async function readDump(file) {
  const compressed = await readFile(file);
  const sql = gunzipSync(compressed, { maxOutputLength: 256 * 1024 * 1024 }).toString('utf8');
  const result = { sourceSha256: hash(compressed), tables: {} };
  for (const [name,primaryKey] of Object.entries(tables)) result.tables[name] = { primaryKey,records:[] };
  for (const statement of statements(sql)) {
    if (!/^(INSERT|REPLACE)\b/i.test(statement)) continue;
    const target = /^(?:INSERT|REPLACE)\b[\s\S]*?\bINTO\s+`([a-zA-Z0-9_]+)`\s/i.exec(statement);
    if (!target) throw new Error('Unsupported INSERT target');
    const name=target[1];
    if (!(name in tables)) continue;
    const match = new RegExp('^INSERT INTO `' + name + '` \\(([^)]+)\\) VALUES\\s*').exec(statement);
    if (!match) throw new Error('Unsupported INSERT form');
      const columns = match[1].split(',').map(value => value.trim().replace(/^`|`$/g, ''));
      if (new Set(columns).size !== columns.length || !columns.includes(tables[name])) throw new Error('Invalid source columns');
      const parsed = parseValues(statement, match[0].length, columns.length);
      if (statement.slice(parsed.end).trim()) throw new Error('Unexpected INSERT suffix');
      for (const row of parsed.records) result.tables[name].records.push(Object.fromEntries(columns.map((column, index) => [column, row[index]])));
  }
  for (const { primaryKey,records } of Object.values(result.tables)) {
    const ids = records.map(row => row[primaryKey]);
    if (ids.some(id => !/^\d+$/.test(id)) || new Set(ids).size !== ids.length) throw new Error('Missing/duplicate source IDs');
  }
  if (!result.tables.genbook.records.length || !result.tables.bookdept.records.length) throw new Error('Source tables missing');
  return result;
}

// Statement boundaries are scanned outside strings/comments. Payload text cannot
// impersonate INSERT statements. No executable SQL is sent to a database.
export function* statements(sql) {
  let start=-1,quote=null;
  for (let i=0;i<sql.length;i++) {
    const c=sql[i];
    if (quote) {
      if (c==='\\') i++;
      else if (c===quote) { if(sql[i+1]===quote)i++; else quote=null; }
      continue;
    }
    if ((c==='-' && sql[i+1]==='-' && /\s/.test(sql[i+2] ?? '')) || c==='#') {
      const end=sql.indexOf('\n',i); i=end<0?sql.length:end; continue;
    }
    if(c==='/' && sql[i+1]==='*') {
      const end=sql.indexOf('*/',i+2); if(end<0) throw new Error('Unterminated SQL comment'); i=end+1; continue;
    }
    if(start<0 && !/\s/.test(c)) start=i;
    if(c==="'" || c==='"' || c==='`') quote=c;
    if(c===';' && start>=0) { yield sql.slice(start,i+1); start=-1; }
  }
  if(quote || (start>=0 && sql.slice(start).trim())) throw new Error('Unterminated SQL statement');
}

export function profileDump(dump) {
  const canonical = value => /^\d+$/.test(value ?? '') ? String(Number(value)) : null;
  const series = new Set(dump.tables.bookdept.records.map(row => canonical(row.bookdept_id)));
  const documents = new Set(dump.tables.genbook.records.map(row => row.gen_book_id));
  const groups = new Map(); let cancelled = 0, invalidNumbers = 0, missingSeries = 0, unknownFlags = 0, missingOwner = 0, missingDatetime = 0;
  const totals = new Map();
  for (const row of dump.tables.genbook.records) {
    const id = canonical(row.bookdept);
    if (!series.has(id)) missingSeries++;
    if (!row.user_request || !row.user_dept) missingOwner++;
    if (!row.user_datetime || row.user_datetime.startsWith('0000-')) missingDatetime++;
    if (!['n','c'].includes(row.status_genbook) || !['0','1'].includes(row.secret) || !['0','1'].includes(row.publish)) unknownFlags++;
    const main = Number(row.book_number), sub = Number(row.book_number_insert ?? 0), year = Number(row.gen_book_year);
    if (!id || !Number.isInteger(main) || main <= 0 || main > 4294967295 || !Number.isInteger(sub) || sub < 0 || !Number.isInteger(year) || year < 2400 || year > 3000) invalidNumbers++;
    if (row.status_genbook === 'c') cancelled++;
    const key = JSON.stringify([id, year, main, sub]); groups.set(key, (groups.get(key) ?? 0) + 1);
    const scope = JSON.stringify([id, year]);
    const total = totals.get(scope) ?? { seriesId: id, year, count: 0, cancelled: 0, maxMain: 0 };
    total.count++; total.cancelled += row.status_genbook === 'c' ? 1 : 0; total.maxMain = Math.max(total.maxMain, main); totals.set(scope, total);
  }
  const orphanChildren = {};
  for (const table of ['genbook_inform','genbook_dept']) orphanChildren[table] = dump.tables[table].records.filter(row => !documents.has(row.gen_book_id)).length;
  return { sourceSha256: dump.sourceSha256, counts: Object.fromEntries(Object.entries(dump.tables).map(([table, data]) => [table, data.records.length])), cancelled,
    duplicateGroups: [...groups.values()].filter(count => count > 1).length, duplicateExcess: [...groups.values()].reduce((sum,count) => sum + Math.max(0,count-1),0),
    invalidNumbers, missingSeries, unknownFlags, missingOwner, missingDatetime, orphanChildren,
    unresolvedSeries: dump.tables.bookdept.records.filter(row => !row.book_number || !['y','b'].includes(row.book_year)).map(row => row.bookdept_id),
    scopes: [...totals.values()].sort((a,b) => String(a.seriesId).localeCompare(String(b.seriesId)) || a.year-b.year), productionReady: false };
}
