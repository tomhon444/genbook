import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readDump,profileDump } from './dump.mjs';

// Compare snapshot values only. No record is selected as the "real" document,
// no cancellation is reversed, and no deduplication/import is performed.
const coreFields=['title','endorser_type','endorser','document_file','document_extension','date_request','user_request','user_dept','user_login','secret','publish'];
const canonical=value=>/^\d+$/.test(value??'')?String(Number(value)):null;
const stable=value=>JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));
const without=(row,keys)=>Object.fromEntries(Object.entries(row).filter(([key])=>!keys.includes(key)));
const variants=values=>new Set(values).size;
const categoryNames={C1:'ค่าทุกฟิลด์ที่สังเกตตรงกันยกเว้น identifiers',C2:'ชุดฟิลด์เนื้อหา/สิทธิ์และ children ตรง แต่ฟิลด์อื่นต่าง',C3:'ชุดฟิลด์เนื้อหา/สิทธิ์หรือ children ต่างกัน'};

export function analyzeDuplicates(dump) {
  const childIndexes={};
  for(const table of ['genbook_inform','genbook_dept']){
    const data=dump.tables[table];if(!data)throw new Error('Child source table missing');
    const index=new Map();
    const required=[data.primaryKey,'gen_book_id',...(table==='genbook_inform'?['inform']:['dept_status','dept'])];
    for(const child of data.records){
      if(required.some(field=>!(field in child)))throw new Error(`Incomplete ${table} comparison fields`);
      const rows=index.get(child.gen_book_id)??[];rows.push(stable(without(child,[data.primaryKey,'gen_book_id'])));index.set(child.gen_book_id,rows);
    }
    childIndexes[table]=new Map([...index].map(([id,rows])=>[id,JSON.stringify(rows.sort())]));
  }
  const childSignature=(table,id)=>childIndexes[table].get(id)??'[]';
  const scopes=new Map();
  for(const row of dump.tables.genbook.records){
    for(const field of [...coreFields,'gen_book_id','bookdept','gen_book_year','book_number','book_number_insert','status_genbook','reason_cancel','user_datetime','lastupdate'])if(!(field in row))throw new Error(`Incomplete genbook comparison fields: ${field}`);
    const key=JSON.stringify([canonical(row.bookdept),Number(row.gen_book_year),Number(row.book_number),Number(row.book_number_insert??0)]);
    const rows=scopes.get(key)??[];rows.push(row);scopes.set(key,rows);
  }
  const groups=[];
  for(const [key,rows]of scopes){
    if(rows.length<2)continue;
    const inform=rows.map(row=>childSignature('genbook_inform',row.gen_book_id));
    const departments=rows.map(row=>childSignature('genbook_dept',row.gen_book_id));
    const sameChildren=variants(inform)===1&&variants(departments)===1;
    const full=rows.map(row=>stable(without(row,['gen_book_id'])));
    const core=rows.map(row=>JSON.stringify(coreFields.map(field=>row[field])));
    const category=variants(full)===1&&sameChildren?'C1':variants(core)===1&&sameChildren?'C2':'C3';
    const rawKeys=variants(rows.map(row=>JSON.stringify([row.bookdept,row.gen_book_year,row.book_number,row.book_number_insert])));
    const fields=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(field=>field!=='gen_book_id');
    const differingFields=fields.filter(field=>variants(rows.map(row=>JSON.stringify([field in row,row[field]])))>1);
    const n=rows.filter(row=>row.status_genbook==='n').length,c=rows.filter(row=>row.status_genbook==='c').length;
    const status=n===rows.length?'n-only':c===rows.length?'c-only':n+c===rows.length?'mixed-n-c':'unknown-status';
    const owners=variants(rows.map(row=>JSON.stringify(row.user_request)));
    const visibility=variants(rows.map(row=>JSON.stringify([row.secret,row.publish])));
    const group={groupId:`D${String(groups.length+1).padStart(4,'0')}`,scope:JSON.parse(key),category,rows:rows.map(row=>({sourceId:row.gen_book_id,status:row.status_genbook})),
      normalRows:n,cancelledRows:c,status,ownerVariants:owners,visibilityVariants:visibility,rawKeyVariants:rawKeys,normalizationOnly:rawKeys===rows.length,
      sameObservedDatetime:rows.every(row=>row.user_datetime!==null&&row.user_datetime!=='')&&variants(rows.map(row=>row.user_datetime))===1,
      differingFields,recipientDifferences:variants(inform)>1,departmentDifferences:variants(departments)>1,approved:false};
    const base=category==='C1'?'เก็บทุก source ID แม้ค่าที่สังเกตตรงกัน ตรวจทะเบียน/ไฟล์จริงก่อนตัดสินว่าเป็นคำขอซ้ำ':category==='C2'?'เก็บทุก source ID ตรวจฟิลด์สถานะ/เวลา/ค่าเลขดิบที่ต่าง ห้ามเลือกแถวใหม่สุดเป็นต้นฉบับอัตโนมัติ':'เก็บทุก source ID เป็นประวัติเลขชน ตรวจเนื้อหา/ผู้ขอ/ผู้รับที่ต่างรายแถว ห้ามรวมเอกสารหรือเปลี่ยนเลข';
    const cautions=[owners>1?'เจ้าของต่างกัน ต้องรักษาสิทธิ์แยกรายแถว':null,visibility>1?'flags สิทธิ์ต่างกัน ห้ามรวมสิทธิ์อ่าน':null,status==='mixed-n-c'?'มีทั้ง n/c ต้องเก็บการยกเลิกของแต่ละแถว':null,rawKeys>1?'มีค่าเลขดิบต่างกัน ต้องรับรอง normalization':null].filter(Boolean);
    group.proposal=[base,...cautions,'รวมเลขเดิมในแผนกันชน; รอผู้รับรอง'].join('; ');
    groups.push(group);
  }
  const count=predicate=>groups.filter(predicate).length;
  const summary={sourceSha256:dump.sourceSha256,duplicateGroups:groups.length,duplicateRows:groups.reduce((sum,g)=>sum+g.rows.length,0),duplicateExcess:groups.reduce((sum,g)=>sum+g.rows.length-1,0),
    categories:Object.fromEntries(Object.keys(categoryNames).map(key=>[key,{groups:count(g=>g.category===key),rows:groups.filter(g=>g.category===key).reduce((sum,g)=>sum+g.rows.length,0)}])),
    statuses:Object.fromEntries(['n-only','c-only','mixed-n-c','unknown-status'].map(key=>[key,count(g=>g.status===key)])),
    crossOwnerGroups:count(g=>g.ownerVariants>1),visibilityDifferenceGroups:count(g=>g.visibilityVariants>1),rawKeyVariantGroups:count(g=>g.rawKeyVariants>1),normalizationOnlyGroups:count(g=>g.normalizationOnly),
    sameObservedDatetimeGroups:count(g=>g.sameObservedDatetime),recipientDifferenceGroups:count(g=>g.recipientDifferences),departmentDifferenceGroups:count(g=>g.departmentDifferences),
    sizeDistribution:Object.fromEntries([...new Set(groups.map(g=>g.rows.length))].sort((a,b)=>a-b).map(size=>[size,count(g=>g.rows.length===size)])),approved:false};
  return {summary,groups};
}

export async function investigateDuplicates(snapshot,reviewArgument) {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const privateRoot=path.join(root,'.local/t12'),review=path.resolve(reviewArgument),relative=path.relative(privateRoot,review);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Review must be inside this project .local/t12');
  const file=path.join(review,'04-duplicates.md'),baseline=await readFile(file,'utf8');
  const dump=await readDump(snapshot),profile=profileDump(dump);
  if(!baseline.includes(`Snapshot SHA-256: ${dump.sourceSha256}`))throw new Error('Review snapshot hash mismatch');
  const analysis=analyzeDuplicates(dump),{summary,groups}=analysis;
  if(summary.duplicateGroups!==profile.duplicateGroups||summary.duplicateExcess!==profile.duplicateExcess)throw new Error('Duplicate profile mismatch');
  const originals=baseline.split('\n').filter(line=>/^\| D\d+ \|/.test(line));
  const byId=new Map(groups.map(group=>[group.groupId,group])),seen=new Set();
  for(const line of originals){
    const cells=line.split('|'),id=cells[1].trim(),group=byId.get(id);
    if(cells.length!==11||!group||seen.has(id))throw new Error('Duplicate review rows differ from snapshot');seen.add(id);
    const scope=[canonical(cells[2].trim()),...cells.slice(3,6).map(value=>Number(value.trim()))];
    if(JSON.stringify(scope)!==JSON.stringify(group.scope))throw new Error('Group scope mismatch');
    const expected=group.rows.map(row=>`${row.sourceId}:${row.status}`).sort().join(',');
    if(cells[6].replaceAll(/\s/g,'').split(',').sort().join(',')!==expected)throw new Error('Group source IDs/status mismatch');
  }
  if(seen.size!==groups.length)throw new Error('Missing duplicate review rows');
  const cell=value=>String(value??'NULL').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','&#124;').replaceAll('\r',' ').replaceAll('\n','<br>');
  const table=(headers,rows)=>`| ${headers.map(cell).join(' | ')} |\n|${headers.map(()=>'---').join('|')}|\n${rows.map(row=>`| ${row.map(cell).join(' | ')} |`).join('\n')}\n`;
  const directory=path.join(privateRoot,`duplicates-${dump.sourceSha256.slice(0,8)}-${randomUUID().slice(0,8)}`);await mkdir(directory);
  const preamble=`# T12 — วิเคราะห์กลุ่มเลขซ้ำ\n\nSnapshot SHA-256: ${dump.sourceSha256}\n\nข้อเสนอรอตรวจรับ ไม่ลบ/รวม/เปลี่ยนเลข ไม่เปลี่ยนสิทธิ์หรือสถานะ ไม่มีการอ่านไฟล์ PDF จริง การเทียบข้อความใช้ค่าดิบ case-sensitive ไม่ trim/normalize เนื้อหา\n\n`;
  const categoryTable=table(['กลุ่ม','นิยาม','จำนวนกลุ่ม','จำนวนแถว'],Object.entries(categoryNames).map(([key,label])=>[key,label,summary.categories[key].groups,summary.categories[key].rows]));
  const detail=table(['กลุ่ม','ชุด / ปี / หลัก / แทรก','ประเภท','source ID : status','n / c','เจ้าของต่างค่ากี่แบบ','flags ต่างค่ากี่แบบ','ค่าเลขดิบกี่แบบ','ฟิลด์ต่าง (ไม่เผยเนื้อหา)','child ต่าง','ข้อเสนอ (ยังไม่รับรอง)','ผู้รับรอง / วันที่'],groups.map(group=>[
    group.groupId,group.scope.join(' / '),group.category,group.rows.map(row=>`${row.sourceId}:${row.status}`).join(', '),`${group.normalRows} / ${group.cancelledRows}`,group.ownerVariants,group.visibilityVariants,group.rawKeyVariants,group.differingFields.join(', '),[group.recipientDifferences?'ผู้รับ':null,group.departmentDifferences?'ปลายทาง':null].filter(Boolean).join(', ')||'ไม่พบ',group.proposal,'',
  ]));
  const comparison=`C1 เปรียบเทียบ genbook ทุกฟิลด์ยกเว้น gen_book_id และ child payload ทุกฟิลด์ยกเว้น child PK/parent ID\n\nC2 เปรียบเทียบเฉพาะฟิลด์: ${coreFields.join(', ')} และ child payload; ฟิลด์อื่นรวมสถานะ เหตุผลยกเลิก เวลา และค่าเลขดิบอาจต่าง\n\nChildren เปรียบเทียบเป็น multiset: ไม่นับลำดับแถว แต่รักษาจำนวนแถวซ้ำ ไม่ถือว่าเนื้อหาทั้งไฟล์หรือเจตนาคำขอเหมือนกัน ไม่มีการเลือก source ID หลักจากผลนี้\n\n`;
  await writeFile(path.join(directory,'README.md'),preamble+categoryTable+'\n'+comparison+detail,{encoding:'utf8',flag:'wx'});
  await writeFile(path.join(directory,'evidence.json'),JSON.stringify(analysis,null,2),{encoding:'utf8',flag:'wx'});
  const link=path.relative(review,path.join(directory,'README.md')).replaceAll('\\','/');let filled=0;
  const updated=baseline.split('\n').map(line=>{
    if(!/^\| D\d+ \|/.test(line))return line;
    const cells=line.split('|'),group=byId.get(cells[1].trim());
    if(cells[7].trim())return line;
    cells[7]=` ข้อเสนอ ${group.category} (ยังไม่รับรอง): ${cell(group.proposal)} — [หลักฐาน](${link}) `;filled++;return cells.join('|');
  }).join('\n');
  if(await readFile(file,'utf8')!==baseline)throw new Error('Review file changed; evidence saved but proposals not applied');
  await writeFile(file,updated,'utf8');
  return {directory:path.relative(root,directory).replaceAll('\\','/'),...summary,proposalsFilled:filled};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==4)throw new Error('Usage: node tools/migration/investigate-duplicates.mjs <snapshot.sql.gz> <review-directory>');
  console.log(JSON.stringify(await investigateDuplicates(process.argv[2],process.argv[3])));
}
