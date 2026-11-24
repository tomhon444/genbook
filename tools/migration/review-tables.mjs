import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { readDump, profileDump } from './dump.mjs';

// Read-only review artifacts. No SQL, DB connection, executable import manifest,
// or approval is produced. A new directory preserves any previously filled forms.
const file = process.argv[2];
if (!file || process.argv.length !== 3) throw new Error('Usage: node tools/migration/review-tables.mjs <snapshot.sql.gz>');
const dump = await readDump(file);
const profile = profileDump(dump);
const canonical = value => /^\d+$/.test(value ?? '') ? String(Number(value)) : null;
const documents = dump.tables.genbook.records;
const sourceIds = new Set(documents.map(row => row.gen_book_id));
const knownSeries = new Set(dump.tables.bookdept.records.map(row => canonical(row.bookdept_id)));
const seriesCounts = new Map(), owners = new Map(), departments = new Map(), numbers = new Map();
const anomalies = [];
const add = (code,table,id,reference) => anomalies.push({ code, table, sourceId:id, reference, decision:'', reviewer:'', reviewedAt:'', status:'รอตรวจรับ' });
for (const row of documents) {
  const series = canonical(row.bookdept);
  seriesCounts.set(series,(seriesCounts.get(series) ?? 0)+1);
  const owner = owners.get(row.user_request) ?? { count:0, departments:new Set() };
  owner.count++; owner.departments.add(row.user_dept); owners.set(row.user_request,owner);
  departments.set(row.user_dept,(departments.get(row.user_dept) ?? 0)+1);
  const key=JSON.stringify([series,Number(row.gen_book_year),Number(row.book_number),Number(row.book_number_insert ?? 0)]);
  const group=numbers.get(key) ?? []; group.push({sourceId:row.gen_book_id,status:row.status_genbook}); numbers.set(key,group);
  if (!knownSeries.has(series)) add('A02','genbook',row.gen_book_id,`bookdept=${row.bookdept ?? 'NULL'}`);
  if (!['n','c'].includes(row.status_genbook) || !['0','1'].includes(row.secret) || !['0','1'].includes(row.publish)) add('A03','genbook',row.gen_book_id,`status=${row.status_genbook ?? 'NULL'}; secret=${row.secret ?? 'NULL'}; publish=${row.publish ?? 'NULL'}`);
  if (!row.user_request || !row.user_dept) add('A04','genbook',row.gen_book_id,`ผู้ขอ${row.user_request ? 'มีค่า':'ขาด'}; หน่วยงาน${row.user_dept ? 'มีค่า':'ขาด'}`);
  if (!row.user_datetime || row.user_datetime.startsWith('0000-')) add('A05','genbook',row.gen_book_id,'datetime ขาดหรือปีศูนย์');
}
for (const [table,code] of [['genbook_inform','A06'],['genbook_dept','A07']]) {
  const data=dump.tables[table];
  for (const row of data.records) if (!sourceIds.has(row.gen_book_id)) add(code,table,row[data.primaryKey],`gen_book_id=${row.gen_book_id ?? 'NULL'}`);
}
const duplicates=[...numbers].filter(([,rows])=>rows.length>1).map(([key,rows],index)=>({ groupId:`D${String(index+1).padStart(4,'0')}`,scope:JSON.parse(key),rows,decision:'',reviewer:'',reviewedAt:'',status:'รอตรวจรับ' }));
if (duplicates.length!==profile.duplicateGroups || duplicates.reduce((sum,group)=>sum+group.rows.length-1,0)!==profile.duplicateExcess) throw new Error('Duplicate reconciliation mismatch');
for (const [code,count] of [['A02',profile.missingSeries],['A03',profile.unknownFlags],['A04',profile.missingOwner],['A05',profile.missingDatetime],['A06',profile.orphanChildren.genbook_inform],['A07',profile.orphanChildren.genbook_dept]]) {
  if (anomalies.filter(row=>row.code===code).length!==count) throw new Error('Anomaly reconciliation mismatch');
}
const directory=`.local/t12/review-${dump.sourceSha256.slice(0,8)}-${randomUUID().slice(0,8)}`;
await mkdir('.local/t12',{recursive:true});
await mkdir(directory); // Exclusive creation: never overwrite a filled review set.
const cell=value=>String(value ?? 'NULL').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('|','&#124;').replaceAll('\r',' ').replaceAll('\n','<br>');
const table=(headers,rows)=>`| ${headers.map(cell).join(' | ')} |\n|${headers.map(()=> '---').join('|')}|\n${rows.map(row=>`| ${row.map(cell).join(' | ')} |`).join('\n')}\n`;
const header=title=>`# ${title}\n\nSnapshot SHA-256: ${dump.sourceSha256}\n\nร่างสำหรับตรวจรับ ข้อมูลจริงเฉพาะในเครื่อง ยังไม่อนุมัติ mapping/counter/cutover รายการอาจซ้อนกัน ห้ามรวมยอดเป็นจำนวนหนังสือที่ต้องลบ\n\n`;
async function save(name,title,headers,rows,notes='') { await writeFile(`${directory}/${name}.md`,header(title)+notes+table(headers,rows),'utf8'); }
await save('01-series','T12 — ตารางจับคู่ชุดเลข',
  ['รหัสเดิม','series_id ที่เสนอ (ยังไม่รับรอง)','prefix ใน snapshot','ปีเดิม','หน่วยงานชุดเดิม','หนังสือหลัก','ประวัติ (แถว)','ข้อเสนอ','series_id ที่รับรอง','เปิด/พักที่รับรอง','ผู้รับรอง / วันที่'],
  dump.tables.bookdept.records.map(row=>[row.bookdept_id,String(row.bookdept_id).padStart(5,'0'),row.book_number,row.book_year,row.dept_id,row.book_idbook,seriesCounts.get(canonical(row.bookdept_id)) ?? 0,
    !row.book_number || !['y','b'].includes(row.book_year) ? 'พัก; ต้องแก้ข้อมูลที่ขาดก่อน' : row.book_year==='b' ? 'ต้องยืนยันความรองรับปีงบประมาณ' : canonical(row.bookdept_id)==='6' ? 'document_date ตาม T01; ตรวจ prefix/สิทธิ์' : 'calendar ตาม T01; ตรวจ prefix/สิทธิ์','','','']),
  `รหัสปลายทางเป็นเพียงข้อเสนอให้คงรหัสเดิมแบบ 5 หลัก ไม่อนุมานว่าชุดใดยังเปิดใช้งาน \`*\` เป็นชุดร่วม ไม่ใช่หน่วยงานบุคคล การพัก 00047 ยืนยันใน T01 แต่ยังไม่ใช่การรับรอง mapping แถวนี้ ยอดประวัติของชุดที่พบรวม ${documents.length-profile.missingSeries} แถว อีก ${profile.missingSeries} แถวอ้างชุดที่ไม่พบ อยู่ใน A02\n\n`);
await save('02-owners','T12 — ตารางจับคู่ผู้ขอ',
  ['user_request เดิม','จำนวนหนังสือ','หน่วยงานเดิมที่พบ','staffId ที่ตรวจรับ','หลักฐานบัญชี / วิธีจัดการบัญชีเลิกใช้งาน','ผู้ตรวจรับ / วันที่','สถานะ'],
  [...owners].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([id,row])=>[id,row.count,[...row.departments].map(value=>value ?? 'NULL').join(', '),'','','','รอตรวจรับ']),
  'ต้องจับคู่กับบัญชีคณะที่ตรวจสอบแล้วตาม T13 ไม่ใช้ user_login แทนเจ้าของ และไม่ให้รหัสที่หายไปเป็นบัญชีรวมโดยอัตโนมัติ\n\n');
await save('03-departments','T12 — ตารางจับคู่หน่วยงานเจ้าของ ณ วันออก',
  ['user_dept เดิม','จำนวนหนังสือ','departmentId ที่ตรวจรับ','ชื่อ/หลักฐานอ้างอิง','วิธีจัดการหน่วยงานยุบ/เปลี่ยนรหัส','ผู้ตรวจรับ / วันที่','สถานะ'],
  [...departments].sort(([a],[b])=>String(a).localeCompare(String(b))).map(([id,count])=>[id,count,'','','','','รอตรวจรับ']));
await save('04-duplicates','T12 — บัญชีกลุ่มเลขซ้ำ',
  ['กลุ่ม','ชุดที่ normalize (ไม่ใช่ mapping ที่รับรอง)','ปี','เลขหลัก','เลขแทรก (NULL=0)','source ID : สถานะเดิม','ผลพิจารณา / หลักฐาน','ผู้รับรอง / วันที่','สถานะ'],
  duplicates.map(group=>[group.groupId,...group.scope,group.rows.map(row=>`${row.sourceId}:${row.status}`).join(', '),'','','รอตรวจรับ']),
  `${profile.duplicateGroups} กลุ่ม / ${profile.duplicateExcess} แถวเกิน แสดง n/c ตามต้นทาง ต้องเก็บแต่ละ source ID ไว้ ไม่ลบ เปลี่ยนเลข หรือ reuse อัตโนมัติ ผลพิจารณาต้องอธิบายการแสดงประวัติและการกันเลขของทั้งกลุ่ม\n\n`);
await save('05-anomalies','T12 — บัญชีข้อมูลขาดและ reference ขาด',
  ['รหัสปัญหา','ตาราง','source ID','ข้อเท็จจริง','ผลพิจารณา / ค่า mapping ที่รับรอง / หลักฐาน','ผู้รับรอง / วันที่','สถานะ'],
  anomalies.map(row=>[row.code,row.table,row.sourceId,row.reference,'','','รอตรวจรับ']),
  'A02 ชุดไม่พบ; A03 flags ไม่รู้จัก; A04 ผู้ขอ/หน่วยงานขาด; A05 datetime; A06/A07 child อ้างหนังสือไม่พบ\n\n');
await save('06-counters','T12 — กระทบยอดตัวนับรายชุดและปี',
  ['ชุดที่ normalize','ปีเดิม','จำนวนประวัติ','ยกเลิก','เลขหลักสูงสุดที่สังเกต','เลขหลักถัดไปเชิงคำนวณ','series_id ที่รับรอง','ยอดที่รับรองรอบสุดท้าย','เลขถัดไปที่รับรอง','ผู้รับรอง / วันที่','สถานะ'],
  profile.scopes.map(row=>[row.seriesId,row.year,row.count,row.cancelled,row.maxMain,row.maxMain<4294967295 ? row.maxMain+1 : 'เต็ม ต้องพิจารณา','','','','','รอตรวจรับ']),
  'รวมสถานะยกเลิกและเลขแทรกในการหาสูงสุด นี่ไม่ใช่คำสั่ง seed counter และไม่รับรองว่าสามารถเปิดชุดนั้นได้ ต้องใช้ snapshot รอบสุดท้ายหลังหยุดรับเลขเก่าและตรวจ mapping/ข้อผิดปกติครบ\n\n');
await writeFile(`${directory}/README.md`,header('T12 — ชุดตารางสำหรับตรวจรับ')+table(['ตาราง','จำนวนแถว','งานที่ต้องกรอก'],[
  ['[01 ชุดเลข](01-series.md)',dump.tables.bookdept.records.length,'mapping / เปิดหรือพัก / ผู้รับรอง'],
  ['[02 ผู้ขอ](02-owners.md)',owners.size,'บัญชีคณะที่จับคู่ / หลักฐาน / ผู้รับรอง'],
  ['[03 หน่วยงาน](03-departments.md)',departments.size,'รหัส ณ วันออก / หลักฐาน / ผู้รับรอง'],
  ['[04 เลขซ้ำ](04-duplicates.md)',duplicates.length,'ผลพิจารณาทุกกลุ่ม / หลักฐาน / ผู้รับรอง'],
  ['[05 ข้อมูลผิดปกติ](05-anomalies.md)',anomalies.length,'mapping หรือวิธีเก็บที่รับรองทุกแถว'],
  ['[06 ตัวนับ](06-counters.md)',profile.scopes.length,'ยอดรอบสุดท้าย / เลขถัดไป / ผู้รับรอง'],
])+ '\nกรอกผลพิจารณาในไฟล์ Markdown ได้โดยตรง เก็บไฟล์ชุดนี้ไว้เฉพาะในเครื่อง การสร้างชุดใหม่ไม่ทับแบบที่กรอกแล้ว ช่องว่างทุกช่องหมายถึงยังไม่รับรอง ตารางฟิลด์/สิทธิ์และการลงนามรวมอยู่ใน `docs/specs/t12-mapping-review.md` ของโปรเจกต์\n','utf8');
await writeFile(`${directory}/reconciliation.json`,JSON.stringify({sourceSha256:dump.sourceSha256,counts:profile.counts,seriesRows:dump.tables.bookdept.records.length,knownSeriesDocumentTotal:documents.length-profile.missingSeries,unmappedSeriesDocuments:profile.missingSeries,ownerRows:owners.size,departmentRows:departments.size,duplicateGroups:duplicates.length,duplicateExcess:profile.duplicateExcess,anomalyRows:anomalies.length,counterRows:profile.scopes.length,scopeDocumentTotal:profile.scopes.reduce((sum,row)=>sum+row.count,0),approved:false},null,2),'utf8');
console.log(JSON.stringify({directory,seriesRows:dump.tables.bookdept.records.length,ownerRows:owners.size,departmentRows:departments.size,duplicateGroups:duplicates.length,anomalyRows:anomalies.length,counterRows:profile.scopes.length,approved:false}));
