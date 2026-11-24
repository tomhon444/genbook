import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readDump, profileDump, hash } from './dump.mjs';

const [snapshot,reviewArgument,legacyArgument]=process.argv.slice(2);
if (!snapshot || !reviewArgument || !legacyArgument || process.argv.length!==5) throw new Error('Usage: node tools/migration/investigate-anomalies.mjs <snapshot.sql.gz> <review-directory> <legacy-source-directory>');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const review=path.resolve(reviewArgument), privateRoot=path.join(root,'.local/t12');
const relative=path.relative(privateRoot,review);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Review tables must be inside this project .local/t12');
const baseline=await readFile(path.join(review,'05-anomalies.md'),'utf8');
const dump=await readDump(snapshot), profile=profileDump(dump);
if (!baseline.includes(`Snapshot SHA-256: ${dump.sourceSha256}`)) throw new Error('Review snapshot hash mismatch');
const legacy=path.resolve(legacyArgument);
const sourceFiles=['application/models/genbook/genbook_model.php','application/models/genbook/bookdept_model.php','application/controllers/bookmanage.php'];
const sources=[];
for(const file of sourceFiles){const content=await readFile(path.join(legacy,file),'utf8');sources.push({file,sha256:hash(content),content});}
const references=[
  ['E01',0,'/* $yesterday','โค้ดเลขว่างเป็น comment ใน source ปัจจุบัน; ไม่พิสูจน์ว่าข้อมูลขาด 4 แถวมาจากเส้นทางนี้'],
  ['E02',0,"$publish = $this->input->post('publish');",'รับ publish จาก POST; ตอน add default เฉพาะ secret แล้วเก็บ publish ตามที่รับมา ไม่อนุมัติแปลง NULL เป็น false'],
  ['E03',0,'if(!empty($publish))','ตอน update ไม่เขียน publish เมื่อ PHP ถือว่าว่าง รวม string 0; อาจคงค่าเดิม ไม่พิสูจน์ประวัติของแต่ละแถว'],
  ['E04',0,'UPDATE genbook SET title=','update parent แล้วเขียน children โดยไม่ตรวจ existence/affected rows ในเส้นทางที่ตรวจ; เป็นกลไกที่อาจสร้าง orphan ไม่ใช่ผลทดสอบ runtime'],
  ['E05',1,"$genbook_db->delete('bookdept'",'model ลบชุดโดยไม่ตรวจ genbook แต่ controller del ปัจจุบันอยู่ใน comment; ไม่พิสูจน์ว่าชุดที่ขาดถูกลบทางนี้'],
  ['E06',0,"'user_datetime' => date",'add ปกติกำหนด datetime ปัจจุบัน; ไม่ให้ใช้ lastupdate หรือวัน import แทนเวลาออกเลขที่หาย'],
  ['E07',0,"status_genbook='c'",'การยกเลิกที่ตรวจเปลี่ยนสถานะเป็น c ไม่ลบ parent จึงอธิบาย orphan ด้วย cancellation ไม่ได้'],
  ['E08',2,'function del()','body ของ controller delete ชุดอยู่ใน comment ใน source ปัจจุบัน ต้องมีหลักฐานย้อนหลังหากจะสรุปสาเหตุ'],
].map(([id,index,needle,note])=>{
  const source=sources[index], lines=source.content.split(/\r?\n/);
  // For !empty(publish), locate the update branch, not the input/form path.
  const line=lines.findIndex(text=>text.includes(needle))+1;
  if(!line)throw new Error(`Source reference drift: ${id}`);
  return {id,file:source.file,line,note};
});
const docs=dump.tables.genbook.records, byId=new Map(docs.map(row=>[row.gen_book_id,row]));
const canonical=value=>/^\d+$/.test(value ?? '')?String(Number(value)):null;
const numericIds=new Set(docs.map(row=>canonical(row.gen_book_id)));
const series=new Set(dump.tables.bookdept.records.map(row=>canonical(row.bookdept_id)));
const issues=[];
const add=(code,table,id,parent,description,proposal,evidence)=>issues.push({code,table,sourceId:id,parentId:parent,fact:description,proposal,evidence,approved:false});
const state=value=>value===null?'NULL':value===''?'empty':'present';
const facts=[];
for(const row of docs){
  const id=row.gen_book_id, missingSeries=!series.has(canonical(row.bookdept));
  const flags=!['n','c'].includes(row.status_genbook)||!['0','1'].includes(row.secret)||!['0','1'].includes(row.publish);
  const identity=!row.user_request||!row.user_dept;
  const time=!row.user_datetime||row.user_datetime.startsWith('0000-');
  if(!(missingSeries||flags||identity||time))continue;
  facts.push({sourceId:id,series:row.bookdept,year:row.gen_book_year,main:row.book_number,sub:row.book_number_insert,status:row.status_genbook,secret:row.secret,publish:row.publish,owner:state(row.user_request),department:state(row.user_dept),actor:state(row.user_login),subject:state(row.title),documentDate:row.date_request,issuedAt:row.user_datetime,lastupdate:row.lastupdate,fileReferencePresent:!!row.document_file,recipientRows:dump.tables.genbook_inform.records.filter(child=>child.gen_book_id===id).length,departmentRows:dump.tables.genbook_dept.records.filter(child=>child.gen_book_id===id).length});
  if(missingSeries)add('A02','genbook',id,null,`อ้างชุด ${row.bookdept}; snapshot ไม่มี reference แม้ normalize; status=${row.status_genbook}; date_request=${state(row.date_request)}; owner=${state(row.user_request)}; department=${state(row.user_dept)}`,
    'เก็บ raw/เลข/สถานะยกเลิก และพัก mapping ชุดนี้ ค้น backup/reference เก่าของรหัสเดิม ห้ามย้ายเข้าชุดใกล้เคียงหรือเปิดออกเลขจนรับรอง', ['E05','E08','E07']);
  if(flags)add('A03','genbook',id,null,`status=${row.status_genbook}; secret=${row.secret ?? 'NULL'}; publish=${row.publish ?? 'NULL'}${identity||time?`; แถวเดียวกับ ${[identity?'A04':null,time?'A05':null].filter(Boolean).join('/')}`:''}`,
    'คง publish=NULL ใน staging; กักรายการที่สิทธิ์ยังระบุไม่ได้ ไม่เติม false/true จาก default ฟอร์ม ต้องมีผลพิจารณารวมกับเจ้าของที่ขาด', ['E02','E03']);
  if(identity)add('A04','genbook',id,null,`ผู้ขอ=${state(row.user_request)}; หน่วยงาน=${state(row.user_dept)}; ผู้กรอก=${state(row.user_login)}; เรื่อง=${state(row.title)}; วันที่=${state(row.date_request)}`,
    `เก็บ source ID และกันเลขเดิมในแผนกระทบยอด กัก metadata ที่ไม่ทราบเจ้าของ ค้น backup/ทะเบียนเดิมก่อนกำหนดสิทธิ์${!row.user_request&&!row.user_dept&&!row.title&&!row.date_request?'; ลักษณะคล้ายข้อมูลกันเลขแต่ยังยืนยันไม่ได้':''}`, ['E01']);
  if(time)add('A05','genbook',id,null,`user_datetime=${state(row.user_datetime)}; date_request=${row.date_request ?? 'NULL'}; lastupdate=${row.lastupdate ?? 'NULL'}`,
    identity ? 'พิจารณาร่วม A03/A04: ไม่มีวัน/เวลาพอสร้างประวัติปกติ เก็บ raw/กันเลขไว้ ห้ามแต่งวันที่หรือเวลา' : 'คงวันที่หนังสือเดิมและเวลาออกเลขเป็นไม่ทราบ ห้ามแทนด้วย lastupdate/เที่ยงคืน/เวลา import ต้องรับรองรูปแบบประวัติที่รองรับเวลาขาดและ timezone', ['E06']);
}
const orphanGroups=new Map();
for(const [table,code]of[['genbook_inform','A06'],['genbook_dept','A07']]){
  const data=dump.tables[table];
  for(const row of data.records){
    if(byId.has(row.gen_book_id))continue;
    const alias=numericIds.has(canonical(row.gen_book_id));
    const group=orphanGroups.get(row.gen_book_id)??{parentId:row.gen_book_id,inform:[],departments:[],numericAlias:alias};
    group[code==='A06'?'inform':'departments'].push(row[data.primaryKey]);orphanGroups.set(row.gen_book_id,group);
    add(code,table,row[data.primaryKey],row.gen_book_id,`parent ${row.gen_book_id ?? 'NULL'} ไม่พบแบบ exact${alias?' แต่มี numeric alias ต้องตรวจ':' และ numeric normalize'}; ไม่มีหลักฐานว่า cancellation ลบ parent`,
      'เก็บ orphan ใน staging แยกพร้อม source ID เดิม ค้น backup/audit/ทะเบียนต้นทางด้วย parent ID ห้ามผูกกับเลขใกล้เคียงหรือสร้างหนังสือแม่สมมติ', ['E04','E07']);
  }
}
for(const [code,count]of[['A02',profile.missingSeries],['A03',profile.unknownFlags],['A04',profile.missingOwner],['A05',profile.missingDatetime],['A06',profile.orphanChildren.genbook_inform],['A07',profile.orphanChildren.genbook_dept]])if(issues.filter(row=>row.code===code).length!==count)throw new Error(`Reconciliation mismatch: ${code}`);
const expectedKeys=new Set(issues.map(row=>`${row.code}:${row.table}:${row.sourceId}`));
const baselineKeys=baseline.split('\n').filter(line=>/^\| A0[2-7] \|/.test(line)).map(line=>line.split('|').slice(1,4).map(value=>value.trim()).join(':'));
if(baselineKeys.length!==issues.length||new Set(baselineKeys).size!==expectedKeys.size||baselineKeys.some(key=>!expectedKeys.has(key)))throw new Error('Review rows differ from snapshot investigation');
const cell=value=>String(value??'NULL').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','&#124;').replaceAll('\r',' ').replaceAll('\n','<br>');
const table=(headers,rows)=>`| ${headers.map(cell).join(' | ')} |\n|${headers.map(()=>'---').join('|')}|\n${rows.map(row=>`| ${row.map(cell).join(' | ')} |`).join('\n')}\n`;
const directory=path.join(privateRoot,`investigation-${dump.sourceSha256.slice(0,8)}-${randomUUID().slice(0,8)}`);
await mkdir(directory);
const preamble=`# T12 — ตรวจเจาะปัญหา A02–A07\n\nSnapshot SHA-256: ${dump.sourceSha256}\n\nเป็นผลตรวจ static จาก snapshot และ source local ไม่รัน PHP/SQL ไม่แก้ต้นทาง ไม่รับรอง mapping หรือ cutover ข้อเสนอทุกแถวยังรอผู้รับรอง\n\n`;
const factsRows=facts.map(row=>[row.sourceId,row.series,row.status,`owner=${row.owner}; dept=${row.department}; actor=${row.actor}; subject=${row.subject}`,row.documentDate,row.issuedAt,row.lastupdate,row.recipientRows,row.departmentRows]);
const issueRows=issues.map(row=>[row.code,row.table,row.sourceId,row.fact,row.proposal,row.evidence.join(', '),'รอรับรอง','']);
const sourceRows=references.map(ref=>[ref.id,`${ref.file}:${ref.line}`,ref.note]);
const report=preamble+`ตรวจ ${issues.length} รายการปัญหา ครอบคลุม genbook ${facts.length} แถวและ child ${issues.filter(row=>row.code==='A06'||row.code==='A07').length} แถว; orphan อ้าง parent ที่หาย ${orphanGroups.size} รหัส\n\n## ข้อเท็จจริงของหนังสือหลักที่ได้รับผลกระทบ\n\n`+
  table(['source ID','ชุดเดิม','สถานะ','ความครบถ้วน (ไม่แสดงตัวตน/เนื้อหา)','วันที่หนังสือ','เวลาขอ','เวลาแก้ล่าสุด','ผู้รับ (แถว)','ปลายทาง (แถว)'],factsRows)+
  '\n## ผลตรวจและข้อเสนอครบทุก occurrence\n\n'+table(['ปัญหา','ตาราง','source ID','ข้อเท็จจริง','ข้อเสนอที่ยังไม่รับรอง','หลักฐาน source','สถานะ','ผู้รับรอง / วันที่'],issueRows)+
  '\n## Parent ที่หายและ child ที่ต้องตามกลับ\n\n'+table(['parent ID เดิม','source ID ผู้รับ','source ID ปลายทาง','มี parent เมื่อ normalize หรือไม่'],[...orphanGroups.values()].map(group=>[group.parentId,group.inform.join(', '),group.departments.join(', '),group.numericAlias?'มี ต้องตรวจ':'ไม่มี']))+
  '\n## หลักฐาน source ที่ตรวจ\n\n'+`โค้ดต้นทาง: ${legacy}\n\n`+table(['หลักฐาน','ไฟล์ : บรรทัดเริ่มต้น','ข้อสังเกต/ข้อจำกัด'],sourceRows)+
  '\nไม่มี parent ที่หายถูกกู้คืนจาก snapshot นี้ ไม่กำหนดเจ้าของ ชุดใหม่ publish หรือเวลาแทนจากความคล้ายคลึง Source ปัจจุบันอธิบายกลไกที่เป็นไปได้ ไม่พิสูจน์ว่าข้อมูลเก่าเกิดจากกลไกนั้น ต้องมี backup/log/ทะเบียนเดิมก่อนรับรองค่าซ่อม\n';
await writeFile(path.join(directory,'README.md'),report,{encoding:'utf8',flag:'wx'});
await writeFile(path.join(directory,'evidence.json'),JSON.stringify({sourceSha256:dump.sourceSha256,sourceFiles:sources.map(({file,sha256})=>({file,sha256})),references,facts,issues,orphanGroups:[...orphanGroups.values()],summary:{occurrences:issues.length,affectedDocuments:facts.length,affectedChildren:issues.filter(row=>['A06','A07'].includes(row.code)).length,missingParentIds:orphanGroups.size,approved:false}},null,2),{encoding:'utf8',flag:'wx'});
// Keep the original review table and any decisions intact. Only fill blank draft
// proposal cells; never change signoff/status or replace a reviewer's existing text.
const reportLink=path.relative(review,path.join(directory,'README.md')).replaceAll('\\','/');
const lookup=new Map(issues.map(row=>[`${row.code}:${row.table}:${row.sourceId}`,row]));let filled=0;
const updated=baseline.split('\n').map(line=>{
  if(!/^\| A0[2-7] \|/.test(line))return line;
  const cells=line.split('|'),key=cells.slice(1,4).map(value=>value.trim()).join(':'),item=lookup.get(key);
  if(cells[5].trim())return line;
  cells[5]=` ข้อเสนอ (ยังไม่รับรอง): ${cell(item.proposal)}; หลักฐาน ${item.evidence.join('/')} — [ผลตรวจ](${reportLink}) `;filled++;
  return cells.join('|');
}).join('\n');
// Fail if the user changed the review file while analysis was running.
if(await readFile(path.join(review,'05-anomalies.md'),'utf8')!==baseline)throw new Error('Review file changed; evidence saved but proposals not applied');
await writeFile(path.join(review,'05-anomalies.md'),updated,'utf8');
console.log(JSON.stringify({directory:path.relative(root,directory).replaceAll('\\','/'),occurrences:issues.length,affectedDocuments:facts.length,affectedChildren:issues.filter(row=>['A06','A07'].includes(row.code)).length,missingParentIds:orphanGroups.size,proposalsFilled:filled,approved:false}));
