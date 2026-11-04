import { describe, expect, it } from 'vitest';
import { createDataClient, currentDataSubject, runAsApp, runWithRequestContext, runWithRequiredEmployeeContext } from '../../src/data/index.js';

const header = 'X-Tier0-App-Data-Subject';

function fixture() {
  const sent: Headers[] = [];
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    sent.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ code: 200, msg: 'ok', requestId: 'test', data: { count: 1, capped: false } }), { status: 200 });
  };
  const data = createDataClient({ apiHost: 'https://example.invalid', apiKey: 'fixture-app-key', fetch });
  return { data, sent };
}

describe('required employee request context', () => {
  it.each([undefined, '', '  ', 'not-a-token', 'a.b.', 'a.b.c,d.e.f', 'a'.repeat(8193) + '.b.c'])(
    'rejects missing or malformed subject before invoking the handler or sending a request',
    subject => {
      const { data, sent } = fixture();
      const headers = new Headers();
      if (subject !== undefined) headers.set(header, subject);
      let invoked = false;
      expect(() => runWithRequiredEmployeeContext(headers, () => {
        invoked = true;
        return data.collection({ collectionId: 'existing' }).countDocuments();
      })).toThrow('employee data subject is required');
      expect(invoked).toBe(false);
      expect(sent).toHaveLength(0);
    },
  );

  it('keeps concurrent employees separate on actual SDK record requests', async () => {
    const { data, sent } = fixture();
    await Promise.all(['a.first.c', 'a.second.c'].map(subject =>
      runWithRequiredEmployeeContext(new Headers({ [header]: subject }), async () => {
        await Promise.resolve();
        expect(currentDataSubject()).toBe(subject);
        await data.collection({ collectionId: 'existing' }).countDocuments();
      }),
    ));
    expect(sent.map(headers => headers.get(header)).sort()).toEqual(['a.first.c', 'a.second.c']);
    expect(currentDataSubject()).toBeUndefined();
  });

  it('preserves the Request abort signal before dispatch', async () => {
    const { data, sent } = fixture();
    const controller = new AbortController();
    controller.abort();
    const request = new Request('https://example.invalid', { headers: { [header]: 'a.employee.c' }, signal: controller.signal });
    await expect(runWithRequiredEmployeeContext(request, () =>
      data.collection({ collectionId: 'existing' }).countDocuments(),
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(sent).toHaveLength(0);
  });

  it('propagates a Gateway rejection without retrying as the App', async () => {
    const sent: Headers[] = [];
    const fetch: typeof globalThis.fetch = async (_input, init) => {
      sent.push(new Headers(init?.headers));
      return new Response(JSON.stringify({
        code: 403, msg: 'Forbidden', requestId: 'test', data: { reason: 'EMPLOYEE_FORBIDDEN' },
        error: { code: 'FORBIDDEN', details: [], execution: 'notStarted', retry: { safe: false } },
      }), { status: 403 });
    };
    const data = createDataClient({ apiHost: 'https://example.invalid', apiKey: 'fixture-app-key', fetch });
    await expect(runWithRequiredEmployeeContext(new Headers({ [header]: 'a.employee.c' }), () =>
      data.collection({ collectionId: 'existing' }).countDocuments(),
    )).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(sent).toHaveLength(1);
    expect(sent[0].get(header)).toBe('a.employee.c');
  });

  it('retains the existing optional context and explicit App background behavior', async () => {
    const { data, sent } = fixture();
    await runWithRequestContext(new Headers(), () => data.collection({ collectionId: 'existing' }).countDocuments());
    await runWithRequiredEmployeeContext(new Headers({ [header]: 'a.employee.c' }), () =>
      runAsApp(() => data.collection({ collectionId: 'existing' }).countDocuments()),
    );
    expect(sent.map(headers => headers.get(header))).toEqual([null, null]);
  });
});
