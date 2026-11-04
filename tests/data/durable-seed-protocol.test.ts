import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createDataClient, defineCollection } from '../../src/data/index.js';

const definition = defineCollection({ alias:'orders', name:'Orders', schema:z.object({value:z.string()}), seed:[{value:'first'}] });
const digest = 'a'.repeat(64);
const ok = (data: unknown) => new Response(JSON.stringify({code:200, msg:'ok', requestId:'r', data}), {status:200});

describe('experimental durable seed protocol', () => {
  it('resumes from server progress after a committed response is lost and a new client starts', async () => {
    let next = 0;
    let applies = 0;
    const paths: string[] = [];
    const fetcher: typeof fetch = async (url) => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path.endsWith('/seed:register')) return ok({protocol:'app-seed/1', collectionId:'c1', planDigest:digest, nextChunk:next, chunkCount:1});
      if (path.endsWith('/seed:apply')) { applies++; next = 1; throw new TypeError('injected dropped response'); }
      if (path.endsWith('/ensure')) return ok({appId:'a', results:[{alias:'orders',collectionId:'c1',revision:1,status:'unchanged'}]});
      throw new Error(`unexpected path ${path}`);
    };
    const options = {apiHost:'https://example.invalid', apiKey:'same-key', collections:[definition], seedRecovery:'app-seed/1' as const, fetch:fetcher};
    await expect(createDataClient(options).ensure()).rejects.toBeDefined();
    expect(paths.some(path => path.endsWith('/ensure'))).toBe(false);
    await expect(createDataClient(options).ensure()).resolves.toBeDefined();
    expect(applies).toBe(1);
    expect(paths.filter(path => path.endsWith('/seed:register'))).toHaveLength(2);
    expect(paths.some(path => path.includes('bulkWrite'))).toBe(false);
  });

  it('fails closed when the endpoint is absent and never falls back to old ensure', async () => {
    const paths: string[] = [];
    const data = createDataClient({apiHost:'https://example.invalid', apiKey:'key', collections:[definition], seedRecovery:'app-seed/1',
      fetch:async url => { paths.push(new URL(String(url)).pathname); return new Response('not found', {status:404}); }});
    await expect(data.ensure()).rejects.toBeDefined();
    expect(paths).toHaveLength(1);
    expect(paths[0]).toMatch(/seed:register$/);
  });

  it('rejects malformed server progress before sending seed or old ensure', async () => {
    const paths:string[]=[];
    const data=createDataClient({apiHost:'https://example.invalid', apiKey:'key', collections:[definition], seedRecovery:'app-seed/1',
      fetch:async url => { paths.push(new URL(String(url)).pathname); return ok({protocol:'app-seed/1', collectionId:'c1', planDigest:digest, nextChunk:2, chunkCount:1}); }});
    await expect(data.ensure()).rejects.toThrow(/invalid durable seed registration response/);
    expect(paths).toHaveLength(1);
  });

  it.each(['register', 'apply'] as const)('reports unknown after committed %s returns malformed success and recovers from server progress', async (malformed) => {
    let registered = false;
    let next = 0;
    let applyCount = 0;
    let inject = true;
    const paths: string[] = [];
    const fetcher: typeof fetch = async url => {
      const path = new URL(String(url)).pathname;
      paths.push(path);
      if (path.endsWith('/seed:register')) {
        registered = true; // fixture simulates a committed server transaction
        if (malformed === 'register' && inject) { inject = false; return ok({protocol: 'invalid'}); }
        return ok({protocol:'app-seed/1', collectionId:'c1', planDigest:digest, nextChunk:next, chunkCount:1});
      }
      if (path.endsWith('/seed:apply')) {
        expect(registered).toBe(true);
        applyCount++;
        next = 1; // fixture simulates a committed chunk before the bad response
        if (malformed === 'apply' && inject) { inject = false; return ok({protocol:'app-seed/1'}); }
        return ok({protocol:'app-seed/1', replayed:false});
      }
      if (path.endsWith('/ensure')) return ok({appId:'a',results:[{alias:'orders',collectionId:'c1',revision:1,status:'unchanged'}]});
      throw new Error(`unexpected path ${path}`);
    };
    const options = {apiHost:'https://example.invalid', apiKey:'same-key', collections:[definition], seedRecovery:'app-seed/1' as const, fetch:fetcher};
    await expect(createDataClient(options).ensure()).rejects.toMatchObject({
      code:'DATA_BAD_RESPONSE', execution:'unknown', outcomeUnknown:true, retry:{safe:false}, attempts:1,
    });
    expect(paths.some(path => path.endsWith('/ensure'))).toBe(false);
    expect(applyCount).toBe(malformed === 'apply' ? 1 : 0);
    await expect(createDataClient(options).ensure()).resolves.toBeDefined();
    expect(applyCount).toBe(1);
  });

  it('keeps unknown and the actual attempt count when a safe rollback precedes malformed success', async () => {
    let attempts = 0;
    const data = createDataClient({apiHost:'https://example.invalid', apiKey:'key', collections:[definition], seedRecovery:'app-seed/1',
      fetch: async () => {
        attempts++;
        if (attempts === 1) return new Response(JSON.stringify({code:503,msg:'retry',requestId:'r',data:null,
          error:{code:'TEMPORARILY_UNAVAILABLE',details:[],execution:'rolledBack',retry:{safe:true,afterMs:0}}}), {status:503});
        return ok({protocol:'invalid'});
      }});
    await expect(data.ensure()).rejects.toMatchObject({code:'DATA_BAD_RESPONSE',execution:'unknown',retry:{safe:false},attempts:2});
    expect(attempts).toBe(2);
  });
});

it('does not claim success if ensure returns a different collection after seed completion', async () => {
  const paths:string[]=[];
  const data=createDataClient({apiHost:'https://example.invalid', apiKey:'key', collections:[definition], seedRecovery:'app-seed/1',
    fetch:async url => {
      const path=new URL(String(url)).pathname; paths.push(path);
      if(path.endsWith('/seed:register')) return ok({protocol:'app-seed/1',collectionId:'old',planDigest:digest,nextChunk:1,chunkCount:1});
      if(path.endsWith('/ensure')) return ok({appId:'a',results:[{alias:'orders',collectionId:'new',revision:1,status:'created'}]});
      throw new Error('unexpected request');
    }});
  await expect(data.ensure()).rejects.toMatchObject({code:'SEED_RECOVERY_REQUIRED',execution:'unknown',retry:{safe:false}});
  expect(paths.some(path=>path.includes('bulkWrite'))).toBe(false);
});
