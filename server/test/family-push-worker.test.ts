import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

describe('notification service worker',()=>{
 it('shows only generic alerts and opens only the gallery root',async()=>{
  const handlers=new Map<string,Function>();
  const showNotification=vi.fn(async()=>undefined);
  const openWindow=vi.fn(async()=>undefined);
  const self={location:{hostname:'gallery.example.test',origin:'https://gallery.example.test'},navigator:{language:'en-US'},
   addEventListener:(type:string,handler:Function)=>handlers.set(type,handler),
   registration:{showNotification},clients:{matchAll:vi.fn(async()=>[]),openWindow}};
  vm.runInNewContext(fs.readFileSync(new URL('../../client/public/sw.js',import.meta.url),'utf8'),{self,URL});
  const work:Promise<unknown>[]=[];
  const waitUntil=(p:Promise<unknown>)=>work.push(p);
  handlers.get('push')!({data:{json:()=>({kind:'unknown'})},waitUntil});
  handlers.get('push')!({data:{json:()=>({kind:'new-photos',title:'Private title',image:'https://example.test/private.jpg',url:'https://example.test/elsewhere'})},waitUntil});
  await Promise.all(work.splice(0));
  expect(showNotification).toHaveBeenCalledTimes(1);
  expect(showNotification).toHaveBeenCalledWith('Family gallery',expect.objectContaining({body:'New photographs are ready to view.',icon:'/icon-192.png',data:{kind:'new-photos'}}));
  const options=showNotification.mock.calls as unknown as Array<[string,Record<string,unknown>]>;
  expect(options[0]![1]).not.toHaveProperty('image');
  const close=vi.fn();
  handlers.get('notificationclick')!({notification:{data:{kind:'new-photos',url:'https://example.test/elsewhere'},close},waitUntil});
  await Promise.all(work);
  expect(close).toHaveBeenCalled();
  expect(openWindow).toHaveBeenCalledWith('https://gallery.example.test/');
 });
});