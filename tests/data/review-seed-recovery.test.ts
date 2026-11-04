import { it, expect } from 'vitest';
import { createDataClient } from '../../src/data/index.js';
import { defineCollection } from '../../src/data/define.js';
import { z } from 'zod';

it('recovers an unsent seed after transient missing credential', async () => {
  let n=0; let sent:string[]=[];
  const data=createDataClient({apiHost:'https://example.invalid',getApiKey:()=>++n===2?undefined:'key-a',
    collections:[defineCollection({alias:'orders',name:'Orders',schema:z.object({value:z.number()}),seed:[{_id:'one',value:1}]})],
    fetch: async (url)=>{const p=new URL(String(url)).pathname;sent.push(p);return new Response(JSON.stringify({code:200,msg:'ok',requestId:'r',data:p.includes('ensure')?{appId:'a',results:[{alias:'orders',collectionId:'c1',revision:1,status:sent.length===1?'created':'unchanged'}]}:{status:'committed',results:[]}}),{status:200})}
  });
  await expect(data.ensure()).rejects.toMatchObject({code:'DATA_NOT_CONFIGURED',execution:'notStarted'});
  await expect(data.ensure()).resolves.toBeDefined();
  expect(sent.some(p=>p.includes('bulkWrite'))).toBe(true);
});

it.each(['unknown', 'committed'] as const)('does not replay a %s stale write into a newly ensured collection', async execution => {
  let ensures=0; const writes: {url:string,body:unknown}[]=[];
  const def=defineCollection({alias:'orders',name:'Orders',schema:z.object({value:z.number()})});
  const wrap=(data:unknown)=>new Response(JSON.stringify({code:200,msg:'ok',requestId:'r',data}),{status:200});
  const data=createDataClient({apiHost:'https://example.invalid',apiKey:'key',collections:[def],fetch:async (url,init)=>{
    const path=new URL(String(url)).pathname;
    if(path.includes('ensure')) return wrap({appId:'a',results:[{alias:'orders',collectionId:++ensures===1?'old':'new',revision:1,status:'unchanged'}]});
    writes.push({url:path,body:JSON.parse(String(init?.body))});
    if(writes.length===1) return new Response(JSON.stringify({code:403,msg:'forbidden',requestId:'r',data:{reason:'COLLECTION_NOT_FOUND'},error:{code:'FORBIDDEN',details:[],execution,retry:{safe:true}}}),{status:403});
    return wrap({id:'x',revision:1});
  }});
  const result=await data.collection(def).insertOne({_id:'x',value:1}).catch(e=>e);
  expect(result).toMatchObject({execution,retry:{safe:false},reason:'COLLECTION_NOT_FOUND',upstreamStatus:403,attempts:1});
  expect(result.idempotencyKey).toBeTruthy();
  expect(writes).toHaveLength(1);
  expect(ensures).toBe(1);
});

it('does not resume an unsent seed if the server returns a different App', async () => {
  let keyCalls = 0;
  let ensures = 0;
  let seedWrites = 0;
  const def = defineCollection({ alias: 'orders', name: 'Orders', schema: z.object({ value: z.number() }), seed: [{ _id: 'one', value: 1 }] });
  const data = createDataClient({ apiHost: 'https://example.invalid', getApiKey: () => ++keyCalls === 2 ? undefined : 'key-a', collections: [def],
    fetch: async url => {
      const path = new URL(String(url)).pathname;
      if (!path.includes('ensure')) seedWrites++;
      return new Response(JSON.stringify({ code: 200, msg: 'ok', requestId: 'r', data: path.includes('ensure')
        ? { appId: ++ensures === 1 ? 'app-a' : 'app-b', results: [{ alias: 'orders', collectionId: 'c1', revision: 1, status: ensures === 1 ? 'created' : 'unchanged' }] }
        : { status: 'committed', results: [] } }), { status: 200 });
    } });
  await expect(data.ensure()).rejects.toMatchObject({ code: 'DATA_NOT_CONFIGURED', execution: 'notStarted' });
  await expect(data.ensure()).rejects.toMatchObject({ code: 'SEED_RECOVERY_REQUIRED', retry: { safe: false } });
  expect(seedWrites).toBe(0);
});
