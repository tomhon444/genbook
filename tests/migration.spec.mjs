import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { randomBytes,randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { startIdentity } from '../tools/local-auth/provider.mjs';
import { startDatabase } from '../tools/issuance/database.mjs';
import { importHistory } from '../tools/migration/import.mjs';
import { fixture } from '../tools/migration/fixture.mjs';

const origin='http://127.0.0.1:3108',password='Synthetic-T12-only-42';
let database,provider,child,logs;
async function login(request,username='owner') {
  const response=await request.post(`${origin}/api/auth/login`,{headers:{Origin:origin,Cookie:''},data:{username,password}});
  expect(response.status()).toBe(200);return response.headers()['set-cookie'].split(';')[0];
}
test.beforeAll(async()=>{
  test.setTimeout(120000);
  database=await startDatabase({port:3321});
  await database.admin.query("UPDATE issuance_series SET enabled=0 WHERE id='TEST-S1'");
  await importHistory(database.admin,fixture(),{dryRun:false});
  // Synthetic cutover only; production enabling is not implemented.
  await database.admin.query("UPDATE issuance_series SET enabled=1 WHERE id='TEST-S1'");
  const secret=randomBytes(32).toString('hex');
  provider=await startIdentity({secret,ttlMs:300000,users:[
    {username:'owner',staffId:'TEST-001',departmentId:'204'},
    {username:'peer',staffId:'TEST-002',departmentId:'204'},
    {username:'outside',staffId:'TEST-003',departmentId:'TEST-D1'},
  ].map(user=>({...user,password,displayName:'บุคลากรจำลอง',departmentName:'หน่วยงานจำลอง',active:true,faculty:true}))});
  logs=createWriteStream('.local/t12-e2e-server.log');
  child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3108'],{windowsHide:true,env:{...process.env,NODE_ENV:'development',NEXT_TEST_DIST:'t05',AUTH_PROVIDER:'local',LOCAL_IDENTITY_URL:provider.url,LOCAL_IDENTITY_SECRET:secret,ISSUANCE_DATABASE_URL:database.url},stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(logs);child.stderr.pipe(logs);
  await expect.poll(async()=>{try{return(await fetch(`${origin}/login`)).status;}catch{return 0;}},{timeout:90000}).toBe(200);
});
test.afterAll(async()=>{child?.kill();await provider?.close();await database?.close();logs?.end();});

test('HTTP history permissions, literal search, invalid paging and private staging exclusion',async({request})=>{
  expect((await request.get(`${origin}/api/history`)).status()).toBe(401);
  for(const [username,count] of [['owner',5],['peer',4],['outside',1]]){
    const cookie=await login(request,username),headers={Cookie:cookie};
    const response=await request.get(`${origin}/api/history`,{headers});
    expect(response.headers()['cache-control']).toBe('no-store');
    const data=await response.json();expect(data.documents).toHaveLength(count);
    expect(JSON.stringify(data)).not.toContain('payload');
    const detail=await request.get(`${origin}/api/history?snapshot=${fixture().sourceSha256}&sourceId=4`,{headers});
    expect(detail.status()).toBe(username==='owner'?200:404);
  }
  const headers={Cookie:await login(request)};
  expect((await request.get(`${origin}/api/history?page=-1`,{headers})).status()).toBe(400);
  expect((await request.get(`${origin}/api/history?snapshot=x&sourceId=4`,{headers})).status()).toBe(404);
  expect((await(await request.get(`${origin}/api/history?q=${encodeURIComponent("%' OR 1=1 --")}`,{headers})).json()).documents).toHaveLength(0);
});

test('HTTP concurrent issuance starts above canceled and duplicate historical numbers',async({request})=>{
  const cookie=await login(request);
  const responses=await Promise.all(Array.from({length:4},()=>request.post(`${origin}/api/issuance`,{headers:{Origin:origin,Cookie:cookie},data:{requestId:randomUUID(),seriesId:'TEST-S1',subject:'ต่อเลขจำลอง',recipient:'จำลอง',recipientDepartmentIds:[],externalOrganization:'จำลอง',signer:'จำลอง',confidential:true,documentDate:new Date(Date.now()+7*3600000).toISOString().slice(0,10)}})));
  expect(responses.map(response=>response.status())).toEqual([201,201,201,201]);
  const numbers=await Promise.all(responses.map(async response=>(await response.json()).document.number));
  const year=new Date(Date.now()+7*3600000).getUTCFullYear()+543;
  expect(numbers.sort()).toEqual(Array.from({length:4},(_,index)=>`ทดสอบ 001/${String(index+(year===2569?71:1)).padStart(4,'0')}`));
});

test('browser searches and opens preserved history, shows cancellation and duplicate source IDs',async({page})=>{
  await page.goto(`${origin}/login`);
  await page.getByLabel('ชื่อบัญชี').fill('owner');
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill(password);
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await expect(page).toHaveURL(`${origin}/workspace`);
  await page.goto(`${origin}/workspace/history`);
  await page.getByRole('button',{name:'ค้นหาหนังสือ',exact:true}).click();
  await expect(page.getByRole('button',{name:/ประวัติจำลอง/})).toHaveCount(5);
  await page.getByRole('button',{name:/ประวัติจำลองยกเลิก/}).click();
  await expect(page.getByRole('region',{name:'รายละเอียดประวัติหนังสือ'})).toContainText('ยกเลิก');
  await page.getByLabel('เลขหนังสือ (บางส่วน)',{exact:true}).fill('ทดสอบ 001/0042');
  await page.getByRole('button',{name:'ค้นหาหนังสือ',exact:true}).click();
  await expect(page.getByRole('button',{name:/ประวัติจำลอง/})).toHaveCount(2);
  await page.screenshot({path:'.local/t12/history-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('heading',{name:'หน้าหลัก',level:1})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'.local/t12/history-mobile.png',fullPage:true});
});
