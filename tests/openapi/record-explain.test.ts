import { describe, expect, it, vi } from 'vitest';
import { createClient, UnsV2Error, type UnsV2Request } from '../../src/index.js';

const query = {
  collectionId: 'orders',
  pipeline: [
    { $match: { siteId: { $in: ['site-a', 'site-b'] } } },
    { $lookup: { collectionId: 'lines', localField: 'lineId', foreignField: '_id', as: 'line' } },
    { $group: { _id: '$siteId', quantity: { $sum: '$quantity' } } },
    { $sort: [['_id', 1]] },
  ],
  page: { mode: 'offset', page: 3, size: 25 },
} satisfies UnsV2Request<'recordAggregatePipeline'>;

describe('aggregate query plans over the existing explain API', () => {
  it('preserves the aggregate pipeline, page and successful requestId without reading records', async () => {
    const plan = { Plan: { 'Node Type': 'Limit', 'Plan Rows': 26, 'Total Cost': 12.5 } };
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      code: 200, msg: '', requestId: 'aggregate-plan-1',
      data: { op: 'aggregate', plan, writesCommitted: false, executionGuaranteed: false },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = createClient({ apiHost: 'https://tier0.invalid', apiKey: 'test-key', fetch });
    const response = await client.uns.recordExplain({ ...query, op: 'aggregate' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe('https://tier0.invalid/openapi/v2/uns/collections/orders/records:explain');
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({ ...query, op: 'aggregate' });
    expect(response.requestId).toBe('aggregate-plan-1');
    expect(response.data).toEqual({ op: 'aggregate', plan, writesCommitted: false, executionGuaranteed: false });
    expect(response.data).not.toHaveProperty('matchedCount');
    expect(response.data).not.toHaveProperty('sampleIds');
  });

  it('preserves the existing bounded find explanation', async () => {
    const result = { op: 'find', matchedCount: 12, capped: false, sampleIds: ['order-a'],
      plan: { Plan: { 'Node Type': 'Index Scan' } }, writesCommitted: false, executionGuaranteed: false };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ code: 200, msg: '', requestId: 'find-plan-1', data: result }), {
      headers: { 'content-type': 'application/json' },
    }));
    const client = createClient({ apiHost: 'https://tier0.invalid', apiKey: 'test-key', fetch });
    expect((await client.uns.recordExplain({ collectionId: 'orders', filter: { siteId: 'site-a' }, limit: 100 })).data).toEqual(result);
  });

  it('surfaces a server rejection without falling back to executing the aggregate', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      code: 422, msg: 'aggregate explain is not supported', requestId: 'old-server', data: null,
      error: { code: 'INVALID_REQUEST', reason: 'aggregate explain is not supported', details: [],
        execution: 'notStarted', retry: { safe: false } },
    }), { status: 422, headers: { 'content-type': 'application/json' } }));
    const client = createClient({ apiHost: 'https://tier0.invalid', apiKey: 'test-key', fetch });
    await expect(client.uns.recordExplain({ ...query, op: 'aggregate' })).rejects.toBeInstanceOf(UnsV2Error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
