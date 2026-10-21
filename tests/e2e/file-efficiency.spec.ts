import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { components } from '../../apps/web/src/api/schema';

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
import { changeLanguage, composerTools } from './workspace-navigation';
import { writeFile } from 'node:fs/promises';

for (const direct of [false, true]) test(`${direct ? 'DM' : 'channel'} image preview and original stay deliberate; optimization and retry keep exact chosen bytes`, async ({ page, browser }, info) => {
  test.setTimeout(100000); await register(page, 'Image owner'); const context = await browser.newContext({ baseURL:'http://127.0.0.1:5174',viewport:page.viewportSize()! }); const peer = await context.newPage();
  try {
    const person = await register(peer, 'Image peer');
    let path:string, url:string;
    if(direct){const c=await command<components['schemas']['DirectConversationDto']>(page,'/api/v1/direct-messages',{clientRequestId:crypto.randomUUID(),userId:person.id});path=`/api/v1/direct-messages/${c.id}`;url=`/messages/${c.id}`;}
    else {const c=await command<components['schemas']['CommunityDetails']>(page,'/api/v1/communities',{clientRequestId:crypto.randomUUID(),name:'Image crew'});const invite=await command<{code:string}>(page,`/api/v1/communities/${c.id}/invites`,{clientRequestId:crypto.randomUUID(),lifetimeHours:1,maxUses:5});await command(peer,'/api/v1/communities/join',{code:invite.code});path=`/api/v1/communities/${c.id}/channels/${c.channels[0]!.id}`;url=`/communities/${c.id}/channels/${c.channels[0]!.id}`;}
    await page.goto(url);
    const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=1200;c.height=800;const x=c.getContext('2d')!;const image=x.createImageData(c.width,c.height);let seed=42;for(let i=0;i<image.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;image.data[i]=seed&255;image.data[i+1]=(seed>>>8)&255;image.data[i+2]=(seed>>>16)&255;image.data[i+3]=255;}x.putImageData(image,0,0);return c.toDataURL('image/jpeg',1).split(',')[1]!;});
    const original=Buffer.from(encoded,'base64');expect(original.length).toBeLessThan(5*1024*1024);await composerTools(page);await page.getByLabel('Attach a file',{exact:true}).setInputFiles({name:'photo.jpg',mimeType:'image/jpeg',buffer:original});
    await page.getByRole('button',{name:'Optimize image',exact:true}).click();await expect(page.getByRole('button',{name:'Use original file',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Use original file',exact:true}).click();
    let stored:components['schemas']['MessageDto']|components['schemas']['DirectMessageDto']|undefined;let dropped=false;
    await page.route('**/attachments',async route=>{if(route.request().method()!=='POST'||dropped)return route.continue();dropped=true;const r=await route.fetch();expect(r.status()).toBe(201);stored=await r.json();return route.abort();});
    await page.getByRole('button',{name:direct?'Send direct message':'Send message',exact:true}).click();await page.getByRole('button',{name:'Retry send',exact:true}).click();await expect(page.locator('.message-list .message-attachment')).toHaveCount(1);
    expect(stored!.attachment!.hasPreview).toBe(true);expect(Number(stored!.attachment!.size)).toBe(original.length);const a=stored!.attachment!;
    let originals=0,previews=0;page.on('request',r=>{if(!r.url().includes(`/attachments/${a.id}`))return;if(new URL(r.url()).searchParams.has('preview'))previews++;else originals++;});
    expect(previews).toBe(0);expect(originals).toBe(0);const attachment=page.locator('.message-list .message-attachment');await attachment.getByRole('button',{name:'View small preview: photo.jpg',exact:true}).click();await expect(attachment.locator('img')).toBeVisible();expect(previews).toBe(1);expect(originals).toBe(0);
    await attachment.getByRole('button',{name:'View full image',exact:true}).click();await expect(attachment.getByRole('button',{name:'View full image',exact:true})).toBeDisabled();expect(originals).toBe(1);
    const download=page.waitForEvent('download');await attachment.getByRole('button',{name:'Download file: photo.jpg',exact:true}).click();const file=await download;const stream=await file.createReadStream();const blocks:Buffer[]=[];for await(const chunk of stream!)blocks.push(Buffer.from(chunk));expect(Buffer.concat(blocks)).toEqual(original);
    const previewBytes=await (await peer.request.get(path+`/attachments/${a.id}?preview=true`)).body();expect(previewBytes.length).toBe(Number(a.previewSize));expect(previewBytes.length).toBeLessThan(original.length);
    await composerTools(page);await page.getByLabel('Attach a file',{exact:true}).setInputFiles({name:'optimized.jpg',mimeType:'image/jpeg',buffer:original});await page.getByRole('button',{name:'Optimize image',exact:true}).click();await expect(page.getByRole('button',{name:'Use original file',exact:true})).toBeEnabled();
    const response=page.waitForResponse(r=>r.url().endsWith('/attachments')&&r.request().method()==='POST');await page.getByRole('button',{name:direct?'Send direct message':'Send message',exact:true}).click();const smaller=await(await response).json() as components['schemas']['MessageDto'];expect(Number(smaller.attachment!.size)).toBeLessThan(original.length);
    await writeFile(info.outputPath('media-profile.json'),JSON.stringify({kind:direct?'direct':'channel',originalBytes:original.length,previewBytes:previewBytes.length,optimizedBytes:Number(smaller.attachment!.size),previewOriginalRequests:{previews,originals},limitations:'Synthetic deterministic JPEG; file size difference is not a universal traffic or quality claim.'},null,2));
    await changeLanguage(page,'ru');await expect(page.getByRole('button',{name:'Посмотреть миниатюру: optimized.jpg',exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('images-ru.png')});
    await command(page,path+`/messages/${stored!.id}/delete`,{clientRequestId:crypto.randomUUID(),expectedVersion:stored!.version});await expect(page.locator(`li[data-message-id="${stored!.id}"]`)).toHaveCount(0);expect((await peer.request.get(path+`/attachments/${a.id}?preview=true`)).status()).toBe(404);
  } finally {await context.close();}
});

test('opening a seventh message image releases the oldest decoded view',async({page})=>{
  await register(page,'Media budget owner');const c=await command<components['schemas']['CommunityDetails']>(page,'/api/v1/communities',{clientRequestId:crypto.randomUUID(),name:'Media budget crew'});const path=`/api/v1/communities/${c.id}/channels/${c.channels[0]!.id}`;
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  for(let n=0;n<7;n++){const csrf=await(await page.request.get('/api/v1/account/csrf')).json() as{requestToken:string};const response=await page.request.post(path+'/attachments',{headers:{'X-CSRF-TOKEN':csrf.requestToken},multipart:{clientMessageId:crypto.randomUUID(),file:{name:`small-${n}.png`,mimeType:'image/png',buffer:image}}});expect(response.status()).toBe(201);}
  await page.goto(`/communities/${c.id}/channels/${c.channels[0]!.id}`);await expect(page.locator('.message-attachment')).toHaveCount(7);expect(await page.locator('.attachment-preview').count()).toBe(0);
  for(let n=0;n<7;n++){await page.getByRole('button',{name:`View image: small-${n}.png`,exact:true}).click();await expect(page.locator('.attachment-preview')).toHaveCount(Math.min(6,n+1));}
  await expect(page.getByRole('button',{name:'View image: small-0.png',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Hide image: small-6.png',exact:true})).toBeVisible();
});
