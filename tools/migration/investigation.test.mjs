import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { hash } from './dump.mjs';

const literal=value=>value===null?'NULL':`'${String(value).replaceAll('\\','\\\\').replaceAll("'","\\'")}'`;
const insert=(table,columns,rows)=>`INSERT INTO \`${table}\` (${columns.map(column=>`\`${column}\``).join(', ')}) VALUES ${rows.map(row=>`(${row.map(literal).join(',')})`).join(',')};\n`;
test('investigation CLI reconciles overlaps, preserves existing review decisions and rejects a mismatched snapshot',async()=>{
  const directory=path.resolve(`.local/t12/test-investigation-${randomUUID()}`);
  const review=path.join(directory,'review'),legacy=path.join(directory,'legacy');
  await mkdir(review,{recursive:true});
  await mkdir(path.join(legacy,'application/models/genbook'),{recursive:true});
  await mkdir(path.join(legacy,'application/controllers'),{recursive:true});
  const model=["$genbook_db->query($sql);",'/* $yesterday',"$publish = $this->input->post('publish');",'if(!empty($publish))','UPDATE genbook SET title=',"'user_datetime' => date", "status_genbook='c'"].join('\n');
  await writeFile(path.join(legacy,'application/models/genbook/genbook_model.php'),model);
  await writeFile(path.join(legacy,'application/models/genbook/bookdept_model.php'),"$genbook_db->delete('bookdept'");
  await writeFile(path.join(legacy,'application/controllers/bookmanage.php'),'function del()');
  const sql=insert('bookdept',['bookdept_id','book_number','book_year'],[['1','TEST','y']])+
    insert('genbook',['gen_book_id','bookdept','gen_book_year','book_number','book_number_insert','status_genbook','secret','publish','user_request','user_dept','user_login','title','date_request','user_datetime','lastupdate','document_file'],[
      ['1','1','2569','1',null,'n','0',null,null,'','',null,null,null,null,null],
      ['2','99','2569','2',null,'c','0','0','TEST-1','TEST-D','TEST-1','Synthetic','2026-11-01','2026-11-01 10:00:00',null,null],
    ])+
    insert('genbook_inform',['gen_book_inform_id','gen_book_id'],[['3','9']])+
    insert('genbook_dept',['gen_book_dept_id','gen_book_id'],[['4','9']]);
  const compressed=gzipSync(sql),snapshot=path.join(directory,'synthetic.sql.gz');
  await writeFile(snapshot,compressed);
  const retained='| A03 | genbook | 1 | flags | Reviewer draft remains verbatim | TEST reviewer | อยู่ระหว่างตรวจ |';
  const baseline=`Snapshot SHA-256: ${hash(compressed)}\n\n| code | table | id | fact | proposal | reviewer | status |\n|---|---|---|---|---|---|---|\n${retained}\n`+
    ['| A04 | genbook | 1 | identity |  |  | รอตรวจรับ |','| A05 | genbook | 1 | time |  |  | รอตรวจรับ |','| A02 | genbook | 2 | series |  |  | รอตรวจรับ |','| A06 | genbook_inform | 3 | parent |  |  | รอตรวจรับ |','| A07 | genbook_dept | 4 | parent |  |  | รอตรวจรับ |'].join('\n');
  const file=path.join(review,'05-anomalies.md');await writeFile(file,baseline);
  const run=()=>spawnSync(process.execPath,['tools/migration/investigate-anomalies.mjs',snapshot,review,legacy],{encoding:'utf8',windowsHide:true});
  const first=run();assert.equal(first.status,0,first.stderr);
  const summary=JSON.parse(first.stdout);assert.deepEqual([summary.occurrences,summary.affectedDocuments,summary.affectedChildren,summary.missingParentIds,summary.proposalsFilled],[6,2,2,1,5]);
  const evidence=JSON.parse(await readFile(path.join(summary.directory,'evidence.json'),'utf8'));
  assert.equal(evidence.references.find(ref=>ref.id==='E04').line,5);
  assert.ok(evidence.issues.every(row=>row.approved===false));
  const updated=await readFile(file,'utf8');assert.ok(updated.includes(retained));
  assert.equal(updated.match(/ข้อเสนอ \(ยังไม่รับรอง\)/g).length,5);
  const second=run();assert.equal(second.status,0,second.stderr);assert.equal(JSON.parse(second.stdout).proposalsFilled,0);
  assert.equal(await readFile(file,'utf8'),updated);
  await writeFile(file,updated.replace(hash(compressed),'0'.repeat(64)));
  const mismatch=run();assert.notEqual(mismatch.status,0);assert.match(mismatch.stderr,/snapshot hash mismatch/);
  assert.ok((await readFile(file,'utf8')).includes(retained));
});
