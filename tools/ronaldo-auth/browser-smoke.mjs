import { chromium, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Uses only the generated local demo account, never live CENTRAL credentials.
const credentials = JSON.parse(await readFile('.local/ronaldo-account.json', 'utf8'));
if (credentials.username !== 'demo.staff') throw new Error('Synthetic demo account required');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:3000/login');
  await expect(page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true })).toBeEnabled();
  await page.getByLabel('ชื่อบัญชี').fill(credentials.username);
  await page.getByLabel('รหัสผ่าน', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await expect(page.locator('.header-profile')).toContainText('ผู้ใช้ทดสอบบริการกลาง');
  await page.getByRole('button', { name: 'ออกจากระบบ', exact: true }).click();
  await expect(page).toHaveURL(/\/login\?loggedOut=1/);
  console.log('PASS: browser login and logout via real Ronaldo Core HTTP adapter. Synthetic account only.');
} finally { await browser.close(); }
