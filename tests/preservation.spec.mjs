import { test,expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes,randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { startIdentity } from '../tools/local-auth/provider.mjs';
import { startDatabase } from '../tools/issuance/database.mjs';
import { preserveSnapshot,seedReservedCounters } from '../tools/migration/preservation.mjs';
import { preservationFixture } from '../tools/migration/preservation-fixture.mjs';
import { promotionFixture } from '../tools/migration/promotion-fixture.mjs';
import { promoteSnapshot } from '../tools/migration/promote.mjs';

const origin='http://127.0.0.1:3110',password='Synthetic-preservation-only-42',approvalReference='Synthetic HTTP test disposition approval';
let database,provider,child,logs;
const input=()=>({requestId:randomUUID(),seriesId:'TEST-S1',subject:'Synthetic next',recipient:'Synthetic',recipientDepartmentIds:[],externalOrganization:'Synthetic',signer:'Synthetic',confidential:true,documentDate:new Date(Date.now()+7*3600000).toISOString().slice(0,10)});
async function login(request,username='owner'){
  const response=await request.post(`${origin}/api/auth/login`,{headers:{Origin:origin,Cookie:''},data:{username,password}});
  expect(response.status()).toBe(200);return response.headers()['set-cookie'].split(';')[0];
}
const post=(request,cookie,data=input())=>request.post(`${origin}/api/issuance`,{headers:{Origin:origin,Cookie:cookie},data});

test.beforeAll(async()=>{
  test.setTimeout(120000);
  database=await startDatabase({port:3325});
  await preserveSnapshot(database.admin,preservationFixture(),{approvalReference});
  const secret=randomBytes(32).toString('hex');
  provider=await startIdentity({secret,ttlMs:300000,users:[{username:'owner',staffId:'TEST-001',departmentId:'204'},{username:'outside',staffId:'TEST-002',departmentId:'TEST-D1'}].map(user=>({...user,password,displayName:'ผู้ใช้จำลอง',departmentName:'หน่วยงานจำลอง',active:true,faculty:true}))});
  logs=createWriteStream('.local/t12-preservation-e2e.log');
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3110'],{windowsHide:true,env:{...process.env,NODE_ENV:'development',NEXT_TEST_DIST:'t05',AUTH_PROVIDER:'local',LOCAL_IDENTITY_URL:provider.url,LOCAL_IDENTITY_SECRET:secret,ISSUANCE_DATABASE_URL:database.url},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(logs);child.stderr.pipe(logs);
  await expect.poll(async()=>{try{return(await fetch(`${origin}/login`)).status;}catch{return 0;}},{timeout:90000}).toBe(200);
});
test.afterAll(async()=>{child?.kill();await provider?.close();await database?.close();logs?.end();});

test('HTTP hides all preserved raw/disposition rows and maintenance gate rejects allocation even for recreated unknown series',async({request})=>{
  expect((await request.get(`${origin}/api/history`)).status()).toBe(401);
  for(const username of ['owner','outside']){
    const headers={Cookie:await login(request,username)};
    const result=await request.get(`${origin}/api/history`,{headers});expect(result.status()).toBe(200);expect((await result.json()).documents).toHaveLength(0);
    for(const sourceId of ['1','3','4','5'])expect((await request.get(`${origin}/api/history?snapshot=${preservationFixture().sourceSha256}&sourceId=${sourceId}`,{headers})).status()).toBe(404);
  }
  const cookie=await login(request);
  expect((await post(request,cookie)).status()).toBe(503);
  await database.admin.query("INSERT INTO issuance_series(id,name,document_type,prefix,year_basis,enabled) VALUES ('00096','Synthetic','Synthetic','Synthetic','calendar',1); INSERT INTO issuance_grants(owner_id,series_id) VALUES ('TEST-001','00096')");
  expect((await post(request,cookie,{...input(),seriesId:'00096'})).status()).toBe(503);
  const [[count]]=await database.admin.query('SELECT (SELECT COUNT(*) FROM issuance_documents) documents,(SELECT COUNT(*) FROM issuance_counters) counters');
  expect([Number(count.documents),Number(count.counters)]).toEqual([0,0]);
});

test('browser history remains empty and shows closed-allocation message without private content',async({page})=>{
  await page.goto(`${origin}/login`);await page.getByLabel('ชื่อบัญชี').fill('owner');await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);await page.getByLabel('รหัสผ่าน',{exact:true}).press('Enter');
  await expect(page).toHaveURL(`${origin}/workspace`);
  await page.goto(`${origin}/workspace/history`);
  await page.getByRole('button',{name:'ค้นหาหนังสือ',exact:true}).click();await expect(page.getByText('ไม่พบหนังสือที่คุณอ่านได้ในหน้านี้',{exact:true})).toBeVisible();
  await expect(page.getByText('Restricted synthetic raw',{exact:true})).toHaveCount(0);
  await page.goto(`${origin}/workspace/issuance`);
  await page.getByLabel('เลขหนังสือ',{exact:true}).selectOption('TEST-S1');await page.getByLabel('เรื่อง',{exact:true}).fill('Synthetic test');await page.getByLabel('ผู้รับ 1',{exact:true}).fill('Synthetic');await page.getByLabel('หน่วยงานรับเรื่องภายนอกคณะ').fill('Synthetic');await page.getByLabel('ผู้ลงนาม',{exact:true}).fill('Synthetic');await page.getByRole('radio',{name:'ลับ',exact:true}).check();
  await page.getByRole('button',{name:'ยืนยันขอเลข',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'ระบบกำลังตรวจรับข้อมูลเดิม'})).toContainText('ยังไม่เปิดออกเลข');
});

test('synthetic reviewed mapping uses preserved floor through HTTP; counter gap rewind and deletion fail closed',async({request})=>{
  await database.admin.query("UPDATE issuance_series SET enabled=0 WHERE id='TEST-S1'");
  await seedReservedCounters(database.admin,{dump:preservationFixture(),approvalReference,reviewedBy:'Synthetic mapping reviewer',mappings:[{legacySeriesId:'00001',seriesId:'TEST-S1'}]});
  // Administrative test fixture only. Product code has no gate-opening command.
  await database.admin.query("UPDATE issuance_series SET enabled=1 WHERE id='TEST-S1'; UPDATE issuance_migration_gate SET state='open'");
  const cookie=await login(request),responses=await Promise.all(Array.from({length:4},()=>post(request,cookie)));
  expect(responses.map(response=>response.status())).toEqual([201,201,201,201]);
  const year=new Date(Date.now()+7*3600000).getUTCFullYear()+543;
  const numbers=await Promise.all(responses.map(async response=>(await response.json()).document.number));
  expect(numbers.sort()).toEqual(Array.from({length:4},(_,index)=>`ทดสอบ 001/${String(index+(year===2569?91:1)).padStart(4,'0')}`));
  if(year===2569){
    await database.admin.query("UPDATE issuance_counters SET last_number=50 WHERE series_id='TEST-S1'");expect((await post(request,cookie)).status()).toBe(409);
    await database.admin.query("DELETE FROM issuance_counters WHERE series_id='TEST-S1'");expect((await post(request,cookie)).status()).toBe(409);
  }
});

test('preserved snapshot promotes through reviewed source mapping and HTTP/browser enforce visibility while gate stays closed', async ({ request, page }) => {
  // Reset only this disposable synthetic DB after the preceding release fixture.
  await database.admin.query('DELETE FROM issuance_audit; DELETE FROM issuance_documents; DELETE FROM legacy_documents; DELETE FROM legacy_promotions; DELETE FROM issuance_counters; DELETE FROM legacy_reservation_links; DELETE FROM legacy_dispositions; DELETE FROM legacy_number_reservations; DELETE FROM legacy_preservation_batches; DELETE FROM legacy_staging; DELETE FROM legacy_batches; UPDATE issuance_series SET enabled=FALSE');
  const { dump, mapping, approvalReference: approval } = promotionFixture();
  await preserveSnapshot(database.admin, dump, { approvalReference: approval });
  const report = await promoteSnapshot(database.admin, dump, mapping, { approvalReference: approval, dryRun: false });
  expect(report.historyDocuments).toBe(4);
  expect((await promoteSnapshot(database.admin, dump, mapping, { approvalReference: approval })).replayed).toBe(true);
  const owner = await login(request), outside = await login(request, 'outside');
  for (const [cookie, total] of [[owner, 4], [outside, 1]]) {
    const headers = { Cookie: cookie };
    const history = await request.get(`${origin}/api/history`, { headers });
    expect((await history.json()).documents).toHaveLength(total);
    const search = await request.get(`${origin}/api/search`, { headers });
    expect((await search.json()).total).toBe(total);
    for (const id of ['3', '5']) expect((await request.get(`${origin}/api/history?snapshot=${dump.sourceSha256}&sourceId=${id}`, { headers })).status()).toBe(404);
  }
  expect((await request.get(`${origin}/api/history?snapshot=${dump.sourceSha256}&sourceId=6`, { headers: { Cookie: outside } })).status()).toBe(404);
  expect((await post(request, owner)).status()).toBe(503);
  await login(page.request);
  await page.goto(`${origin}/workspace/history`);
  const panel = page.locator('section[aria-labelledby="search-heading"]');
  await panel.getByRole('button', { name: 'ค้นหาหนังสือ', exact: true }).click();
  await expect(panel.getByRole('button', { name: /ทดสอบ 001\/0042/ })).toHaveCount(2);
  await panel.getByRole('button', { name: /ทดสอบ 001\/0070.2/ }).click();
  await expect(panel.getByRole('region', { name: 'รายละเอียดประวัติหนังสือ' })).toContainText('ยกเลิก');
  const [[state]] = await database.admin.query('SELECT state FROM issuance_migration_gate'); expect(state.state).toBe('blocked');
  const [[counter]] = await database.admin.query("SELECT last_number FROM issuance_counters WHERE series_id='TEST-S1' AND number_year=2569"); expect(counter.last_number).toBe(90);
});
