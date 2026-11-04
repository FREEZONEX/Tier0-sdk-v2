import { it, expect } from 'vitest';
import { createDataClient } from '../../src/data/index.js';
import { defineCollection } from '../../src/data/define.js';
import { z } from 'zod';

it.each(['notStarted', 'rolledBack'] as const)('resumes a %s seed after a transient credential gap between retry attempts', async execution => {
 let gets=0, ensures=0, writes=0;
 const collection=defineCollection({alias:'orders',name:'Orders',schema:z.object({value:z.number()}),seed:[{_id:'one',value:1}]});
 const envelope=(data:unknown)=>new Response(JSON.stringify({code:200,msg:'ok',requestId:'t',data}),{status:200});
 const data=createDataClient({apiHost:'https://example.invalid',getApiKey:()=>++gets===3?undefined:'same-key',collections:[collection],fetch:async url=>{
   if(new URL(String(url)).pathname.includes('ensure')) return envelope({appId:'app',results:[{alias:'orders',collectionId:'c1',revision:1,status:++ensures===1?'created':'unchanged'}]});
   if(++writes===1) return new Response(JSON.stringify({code:503,msg:'busy',requestId:'t',data:null,error:{code:'TEMPORARILY_UNAVAILABLE',details:[],execution,retry:{safe:true,afterMs:0}}}),{status:503});
   return envelope({status:'committed',results:[]});
 }});
 await expect(data.ensure()).rejects.toMatchObject({code:'DATA_NOT_CONFIGURED',execution,attempts:1});
 await expect(data.ensure()).resolves.toBeDefined();
 expect(writes).toBe(2);
});

it('resumes only the unsent second chunk after first chunk succeeds', async () => {
 let gets=0, ensures=0; const sizes:number[]=[];
 const collection=defineCollection({alias:'orders',name:'Orders',schema:z.object({value:z.number()}),seed:Array.from({length:201},(_,i)=>({_id:`item-${i}`,value:i}))});
 const envelope=(data:unknown)=>new Response(JSON.stringify({code:200,msg:'ok',requestId:'t',data}),{status:200});
 const data=createDataClient({apiHost:'https://example.invalid',getApiKey:()=>++gets===3?undefined:'same-key',collections:[collection],fetch:async (url,init)=>{
  if(new URL(String(url)).pathname.includes('ensure')) return envelope({appId:'app',results:[{alias:'orders',collectionId:'c1',revision:1,status:++ensures===1?'created':'unchanged'}]});
  sizes.push(JSON.parse(String(init?.body)).operations.length); return envelope({status:'committed',results:[]});
 }});
 await expect(data.ensure()).rejects.toMatchObject({code:'DATA_NOT_CONFIGURED',execution:'notStarted'});
 await expect(data.ensure()).resolves.toBeDefined();
 expect(sizes).toEqual([200,1]);
});

it('resumes the rolled-back second chunk without replaying the committed first chunk', async () => {
 let gets=0, ensures=0; const writes:{size:number,key:string}[]=[];
 const collection=defineCollection({alias:'orders',name:'Orders',schema:z.object({value:z.number()}),seed:Array.from({length:201},(_,i)=>({_id:`item-${i}`,value:i}))});
 const envelope=(data:unknown)=>new Response(JSON.stringify({code:200,msg:'ok',requestId:'t',data}),{status:200});
 const data=createDataClient({apiHost:'https://example.invalid',getApiKey:()=>++gets===4?undefined:'same-key',collections:[collection],fetch:async (url,init)=>{
  if(new URL(String(url)).pathname.includes('ensure')) return envelope({appId:'app',results:[{alias:'orders',collectionId:'c1',revision:1,status:++ensures===1?'created':'unchanged'}]});
  const body=JSON.parse(String(init?.body)); writes.push({size:body.operations.length,key:body.idempotencyKey});
  if(writes.length===2) return new Response(JSON.stringify({code:503,msg:'busy',requestId:'t',data:null,error:{code:'TEMPORARILY_UNAVAILABLE',details:[],execution:'rolledBack',retry:{safe:true,afterMs:0}}}),{status:503});
  return envelope({status:'committed',results:[]});
 }});
 await expect(data.ensure()).rejects.toMatchObject({code:'DATA_NOT_CONFIGURED',execution:'rolledBack',attempts:1});
 await expect(data.ensure()).resolves.toBeDefined();
 expect(writes.map(write=>write.size)).toEqual([200,1,1]);
 expect(writes[1].key).toBe(writes[2].key);
 expect(writes[0].key).not.toBe(writes[1].key);
});

it('does not resume an unsent seed after a prior committed result', async () => {
 let ensures=0,writes=0;
 const collection=defineCollection({alias:'orders',name:'Orders',schema:z.object({value:z.number()}),seed:[{_id:'one',value:1}]});
 const envelope=(data:unknown)=>new Response(JSON.stringify({code:200,msg:'ok',requestId:'t',data}),{status:200});
 const data=createDataClient({apiHost:'https://example.invalid',apiKey:'same-key',collections:[collection],fetch:async url=>{
  if(new URL(String(url)).pathname.includes('ensure')) return envelope({appId:'app',results:[{alias:'orders',collectionId:'c1',revision:1,status:++ensures===1?'created':'unchanged'}]});
  writes++; return new Response(JSON.stringify({code:503,msg:'committed',requestId:'t',data:null,error:{code:'TEMPORARILY_UNAVAILABLE',details:[],execution:'committed',retry:{safe:true,afterMs:0}}}),{status:503});
 }});
 await expect(data.ensure()).rejects.toMatchObject({execution:'committed',retry:{safe:false}});
 await expect(data.ensure()).rejects.toMatchObject({code:'SEED_RECOVERY_REQUIRED',execution:'committed',retry:{safe:false}});
 expect(writes).toBe(1);
});

it('does not resend unknown seed across later ensures', async () => {
 let ensures=0,writes=0;
 const collection=defineCollection({alias:'orders',name:'Orders',schema:z.object({value:z.number()}),seed:[{_id:'one',value:1}]});
 const envelope=(data:unknown)=>new Response(JSON.stringify({code:200,msg:'ok',requestId:'t',data}),{status:200});
 const data=createDataClient({apiHost:'https://example.invalid',apiKey:'same-key',collections:[collection],fetch:async url=>{
  if(new URL(String(url)).pathname.includes('ensure')) return envelope({appId:'app',results:[{alias:'orders',collectionId:'c1',revision:1,status:++ensures===1?'created':'unchanged'}]});
  writes++; throw new Error('lost response');
 }});
 const first=await data.ensure().catch(e=>e);
 const second=await data.ensure().catch(e=>e);
 expect(first).toMatchObject({execution:'unknown',outcomeUnknown:true});
 expect(second).toMatchObject({execution:'unknown',outcomeUnknown:true,idempotencyKey:first.idempotencyKey});
 expect(writes).toBe(1);
});
