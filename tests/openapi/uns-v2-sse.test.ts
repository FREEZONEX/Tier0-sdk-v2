import { describe, expect, it } from 'vitest';
import { parseServerSentEvents } from '../../src/uns-v2/sse.js';

function stream(chunks: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function all(chunks: string[]) {
  const out: unknown[] = [];
  for await (const event of parseServerSentEvents(stream(chunks))) out.push(event);
  return out;
}

describe('parseServerSentEvents', () => {
  it('joins data lines, keeps the last id, and handles CRLF split across chunks', async () => {
    expect(await all(['id: 1\r', '\nevent: change\r\ndata: a\r\ndata:b\r\n\r', '\n', 'data: plain\n\n'])).toEqual([
      { event: 'change', data: 'a\nb', id: '1' },
      { event: 'message', data: 'plain', id: '1' },
    ]);
  });

  it('reports comments and named events without data, and drops an unterminated event', async () => {
    expect(await all([': keep-alive\n', 'event: heartbeat\n\n', 'retry: 10\n\n', 'data: never dispatched'])).toEqual([
      { comment: 'keep-alive' },
      { event: 'heartbeat', data: '' },
    ]);
  });
});
