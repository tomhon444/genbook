import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { hash } from './dump.mjs';
import { analyzeDuplicates,investigateDuplicates } from './investigate-duplicates.mjs';

const row=(id,main,changes={})=>({gen_book_id:String(id),gen_book_year:'2569',bookdept:'00001',book_number:String(main),book_number_insert:null,
  title:'PRIVATE-SYNTHETIC-TITLE',endorser_type:'1',endorser:'TEST',document_file:'PRIVATE-FILE-REFERENCE',document_extension:'pdf',date_request:'2026-11-01',user_request:'TEST-OWNER',user_dept:'TEST-DEPT',user_login:'TEST-ACTOR',user_datetime:'2026-11-01 10:00:00',status_genbook:'n',reason_cancel:null,lastupdate:'2026-11-01 10:00:00',secret:'0',publish:'0',...changes});
function fixture(records,inform=[]){return{sourceSha256:hash('synthetic-duplicate-review'),tables:{
  bookdept:{primaryKey:'bookdept_id',records:[{bookdept_id:'00001',book_number:'TEST',book_year:'y'}]},genbook:{primaryKey:'gen_book_id',records},
  genbook_inform:{primaryKey:'gen_book_inform_id',records:inform},genbook_dept:{primaryKey:'gen_book_dept_id',records:[]},
}};}

test('duplicate analysis distinguishes observation equality, metadata changes, owners, visibility and multiset multiplicity',()=>{
  const source=fixture([
    row(1,1),row(2,1),
    row(3,2),row(4,2,{status_genbook:'c',reason_cancel:'SYNTHETIC',user_datetime:'2026-11-01 10:01:00'}),
    row(5,3),row(6,3,{user_request:'TEST-OTHER',publish:'1'}),
    row(7,4),row(8,4),
    row(9,5),row(10,5,{book_number_insert:'0'}),
  ],[
    {gen_book_inform_id:'1',gen_book_id:'1',inform:'PRIVATE-RECIPIENT-A'},{gen_book_inform_id:'2',gen_book_id:'1',inform:'PRIVATE-RECIPIENT-B'},
    {gen_book_inform_id:'3',gen_book_id:'2',inform:'PRIVATE-RECIPIENT-B'},{gen_book_inform_id:'4',gen_book_id:'2',inform:'PRIVATE-RECIPIENT-A'},
    {gen_book_inform_id:'5',gen_book_id:'7',inform:'PRIVATE-RECIPIENT-A'},
    {gen_book_inform_id:'6',gen_book_id:'8',inform:'PRIVATE-RECIPIENT-A'},{gen_book_inform_id:'7',gen_book_id:'8',inform:'PRIVATE-RECIPIENT-A'},
  ]);
  const result=analyzeDuplicates(source);
  assert.deepEqual(result.groups.map(group=>group.category),['C1','C2','C3','C3','C2']);
  assert.equal(result.groups[1].status,'mixed-n-c');
  assert.equal(result.groups[2].ownerVariants,2);assert.equal(result.groups[2].visibilityVariants,2);
  assert.equal(result.groups[3].recipientDifferences,true);
  assert.equal(result.groups[4].normalizationOnly,true);
  assert.equal(result.summary.duplicateGroups,5);assert.equal(result.summary.duplicateRows,10);assert.equal(result.summary.duplicateExcess,5);
  assert.equal(result.summary.normalizationOnlyGroups,1);
  const serialized=JSON.stringify(result);
  for(const secret of ['PRIVATE-SYNTHETIC-TITLE','PRIVATE-RECIPIENT-A','PRIVATE-FILE-REFERENCE','TEST-OWNER'])assert.ok(!serialized.includes(secret));
  assert.ok(result.groups.every(group=>group.approved===false));
  assert.deepEqual(source.tables.genbook.records[3].status_genbook,'c');
});

test('partial pair equality does not classify a whole triple as identical; incomplete fields fail closed',()=>{
  const source=fixture([row(1,1),row(2,1),row(3,1,{title:'Different'})]);
  const result=analyzeDuplicates(source);
  assert.equal(result.groups[0].category,'C3');assert.equal(result.summary.duplicateExcess,2);
  delete source.tables.genbook.records[2].secret;
  assert.throws(()=>analyzeDuplicates(source),/Incomplete/);
  for(const field of ['reason_cancel','lastupdate']){
    const missing=fixture([row(1,1),row(2,1)]);delete missing.tables.genbook.records[0][field];
    assert.throws(()=>analyzeDuplicates(missing),/Incomplete/);
  }
  const missingRecipient=fixture([row(1,1),row(2,1)],[{gen_book_inform_id:'1',gen_book_id:'1'}]);
  assert.throws(()=>analyzeDuplicates(missingRecipient),/Incomplete genbook_inform/);
  const missingDestination=fixture([row(1,1),row(2,1)]);
  missingDestination.tables.genbook_dept.records.push({gen_book_dept_id:'1',gen_book_id:'1',dept_status:'1'});
  assert.throws(()=>analyzeDuplicates(missingDestination),/Incomplete genbook_dept/);
});

test('duplicate review preserves decisions on rerun and rejects altered scope, source IDs and snapshot',async()=>{
  const source=fixture([row(1,1),row(2,1),row(3,2),row(4,2,{publish:'1'})]);
  const literal=value=>value===null?'NULL':`'${String(value).replaceAll('\\','\\\\').replaceAll("'","\\'")}'`;
  const sql=Object.entries(source.tables).filter(([,data])=>data.records.length).map(([table,data])=>{
    const columns=Object.keys(data.records[0]);
    return`INSERT INTO \`${table}\` (${columns.map(key=>`\`${key}\``).join(', ')}) VALUES ${data.records.map(record=>`(${columns.map(key=>literal(record[key])).join(',')})`).join(',')};\n`;
  }).join('');
  const compressed=gzipSync(sql),directory=path.resolve(`.local/t12/test-duplicates-${randomUUID()}`);await mkdir(directory,{recursive:true});
  const snapshot=path.join(directory,'synthetic.sql.gz');await writeFile(snapshot,compressed);
  const preserved='| D0001 | 1 | 2569 | 1 | 0 | 1:n, 2:n | Existing reviewer draft | TEST reviewer | Pending |';
  const baseline=`Snapshot SHA-256: ${hash(compressed)}\n\n| group | series | year | main | sub | IDs | proposal | reviewer | status |\n|---|---|---|---|---|---|---|---|---|\n${preserved}\n| D0002 | 1 | 2569 | 2 | 0 | 3:n, 4:n |  |  | Pending |\n`;
  const file=path.join(directory,'04-duplicates.md');await writeFile(file,baseline);
  const first=await investigateDuplicates(snapshot,directory);assert.equal(first.proposalsFilled,1);
  const updated=await readFile(file,'utf8');assert.ok(updated.includes(preserved));
  const second=await investigateDuplicates(snapshot,directory);assert.equal(second.proposalsFilled,0);assert.notEqual(second.directory,first.directory);
  assert.equal(await readFile(file,'utf8'),updated);
  for(const broken of [updated.replace('2569 | 2','2570 | 2'),updated.replace('3:n, 4:n','3:n, 99:n'),updated.replace(hash(compressed),'0'.repeat(64))]){
    await writeFile(file,broken);await assert.rejects(investigateDuplicates(snapshot,directory));assert.equal(await readFile(file,'utf8'),broken);
  }
});
