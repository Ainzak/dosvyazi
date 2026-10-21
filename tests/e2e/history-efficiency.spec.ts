import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { components } from '../../apps/web/src/api/schema';
import { writeFile } from 'node:fs/promises';
import { changeLanguage } from './workspace-navigation';

async function command<T>(page: Page, path: string, body: unknown, method = 'POST'): Promise<T> {
  const csrf = await (await page.request.get('/api/v1/account/csrf')).json() as { requestToken: string };
  const response = await page.request.fetch(path, { method, data: body, headers: { 'X-CSRF-TOKEN': csrf.requestToken } });
  expect(response.ok(), `${method} ${path}: ${response.status()}`).toBe(true); return response.json() as Promise<T>;
}
async function register(page: Page, name: string) {
  await page.goto('/register'); await page.getByLabel('Display name', { exact: true }).fill(name);
  await page.getByLabel('Email address', { exact: true }).fill(`nav-${crypto.randomUUID()}@example.test`); await page.getByLabel('Password', { exact: true }).fill('Synthetic navigation test passphrase 42');
  await page.getByRole('button', { name: 'Create account', exact: true }).click(); await expect(page.getByRole('heading', { name: `Welcome, ${name}.`, exact: true })).toBeVisible();
  return await (await page.request.get('/api/v1/account/me')).json() as { id: string };
}

test('bounded long history retains explicit navigation with measured synthetic DOM and heap', async ({ page }, info) => {
  test.setTimeout(100000); await register(page, 'History QA');
  const c = await command<components['schemas']['CommunityDetails']>(page, '/api/v1/communities', { clientRequestId: crypto.randomUUID(), name: 'History profile' }); const channel = c.channels[0]!.id;
  const path = `/api/v1/communities/${c.id}/channels/${channel}`;
  const seed = await command<components['schemas']['MessageDto']>(page, path + '/messages', { clientMessageId: crypto.randomUUID(), content: 'Synthetic history seed' });
  const messages = Array.from({ length: 1000 }, (_, i) => ({ ...seed, id: crypto.randomUUID(), clientMessageId: crypto.randomUUID(), sequence: String(i + 1), content: `Synthetic history row ${i + 1} — ` + 'Repeatable plain text. '.repeat(5), version: '1' }));
  let requests = 0; await page.route('**/channels/*/messages*', async route => { if (route.request().method() !== 'GET') return route.continue(); const before = Number(new URL(route.request().url()).searchParams.get('before') ?? 1001); const eligible = messages.filter(m => Number(m.sequence) < before); requests++; return route.fulfill({ json: { messages: eligible.slice(-50), watermark: '1000', hasOlder: eligible.length > 50 } }); });
  await page.route('**/channels/*/events?*', route => route.fulfill({ json: { events: [], nextSequence: '1000', watermark: '1000', hasMore: false } }));
  await page.goto(`/communities/${c.id}/channels/${channel}`); await expect(page.locator('.message-list > li.message-row')).toHaveCount(50);
  const session = await page.context().newCDPSession(page); await session.send('Performance.enable');
  const started = Date.now(); const samples: number[] = [];
  for (let n = 0; n < 19; n++) { const start = Date.now(); const before = requests; await page.getByRole('button', { name: 'Load older messages', exact: true }).click(); await expect.poll(() => requests).toBeGreaterThan(before); await expect(page.getByText(`Synthetic history row ${Math.max(1, 901 - n * 50)} — ` + 'Repeatable plain text. '.repeat(5), { exact: true })).toBeAttached(); samples.push(Date.now() - start); }
  await session.send('HeapProfiler.collectGarbage'); const metrics = await session.send('Performance.getMetrics');
  const rows = await page.locator('.message-list > li.message-row').count(); const baseline = process.env.DOSVYAZI_PROFILE_LABEL === 'baseline';
  if (baseline) expect(rows).toBe(1000); else { expect(rows).toBeLessThanOrEqual(100); await page.getByRole('button', { name: 'Jump to latest messages', exact: true }).click(); await expect(page.getByText(messages[999]!.content, { exact: true })).toBeVisible(); }
  const result = { phase: process.env.DOSVYAZI_PROFILE_LABEL ?? 'after', viewport: info.project.name, messages: 1000, pageSize: 50, historyRequests: requests, renderedRows: rows, totalDomNodes: await page.locator('*').count(), retainedJsHeapBytes: metrics.metrics.find(x => x.name === 'JSHeapUsedSize')?.value, loadHistoryWallMs: Date.now() - started, pageWallMs: samples, browser: await page.context().browser()!.version(), limitations: 'Synthetic paginated payloads through real authenticated UI. Metadata cache retained; bounded rendering/media, not total history cache guarantee. CDP JS heap after requested GC is not process RAM. Wall timings include browser automation; no causal server/competitor claim.' };
  await writeFile(info.outputPath('profile.json'), JSON.stringify(result, null, 2)); await info.attach('history-profile', { body: JSON.stringify(result, null, 2), contentType: 'application/json' }); await page.screenshot({ path: info.outputPath('history.png') });
});

test('DM long history keeps a visible anchor when pruning rows and can navigate back to latest', async ({ page,browser },info)=>{
  test.setTimeout(80000); await register(page,'DM history owner'); const context=await browser.newContext({baseURL:'http://127.0.0.1:5174',viewport:page.viewportSize()!}); const peer=await context.newPage();
  try {
    const other=await register(peer,'DM history peer');const c=await command<components['schemas']['DirectConversationDto']>(page,'/api/v1/direct-messages',{clientRequestId:crypto.randomUUID(),userId:other.id});const root=`/api/v1/direct-messages/${c.id}`;const seed=await command<components['schemas']['DirectMessageDto']>(page,root+'/messages',{clientMessageId:crypto.randomUUID(),content:'DM synthetic seed'});
    const messages=Array.from({length:350},(_,i)=>({...seed,id:crypto.randomUUID(),clientMessageId:crypto.randomUUID(),sequence:String(i+1),content:`DM history ${i+1}`}));
    await page.route('**/direct-messages/*/messages*',route=>{const before=Number(new URL(route.request().url()).searchParams.get('before')??351);const rows=messages.filter(m=>Number(m.sequence)<before);return route.fulfill({json:{messages:rows.slice(-50),watermark:'350',hasOlder:rows.length>50}});});
    await page.route('**/direct-messages/*/events?*',route=>route.fulfill({json:{events:[],nextSequence:'350',watermark:'350',hasMore:false}}));
    await page.goto(`/messages/${c.id}`);await expect(page.locator('.message-list > .message-row')).toHaveCount(50);await page.getByRole('button',{name:'Load older messages',exact:true}).click();await expect(page.locator('.message-list > .message-row')).toHaveCount(100);
    const list=page.locator('.message-list');await list.evaluate(e=>{e.scrollTop=0;});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const anchor=page.locator('.message-row').filter({has:page.getByText('DM history 251',{exact:true})});const before=await anchor.evaluate(e=>e.getBoundingClientRect().top-e.parentElement!.getBoundingClientRect().top);
    await page.getByRole('button',{name:'Load older messages',exact:true}).click();await expect(page.getByText('DM history 201',{exact:true})).toBeAttached();await expect(page.locator('.message-list > .message-row')).toHaveCount(100);const after=await anchor.evaluate(e=>e.getBoundingClientRect().top-e.parentElement!.getBoundingClientRect().top);expect(Math.abs(after-before)).toBeLessThan(4);
    await page.getByRole('button',{name:'Jump to latest messages',exact:true}).click();await expect(page.getByText('DM history 350',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Show earlier loaded messages',exact:true}).click();await expect(page.getByText('DM history 201',{exact:true})).toBeAttached();expect(await page.locator('.message-list > .message-row').count()).toBeLessThanOrEqual(100);await changeLanguage(page,'ru');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('dm-history-window-ru.png')});
  } finally {await context.close();}
});
