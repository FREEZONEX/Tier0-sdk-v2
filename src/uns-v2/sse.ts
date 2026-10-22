/**
 * Minimal `text/event-stream` parser (WHATWG server-sent events). Unlike
 * EventSource it also dispatches a named event without data lines, and
 * reports comment lines, so a keep-alive in either form is visible.
 */

export interface ServerSentEvent {
  /** `message` when the server names no event. */
  event: string;
  data: string;
  /** Last `id:` seen on the stream so far, as EventSource keeps it. */
  id?: string;
}

/** A line longer than this is not an event stream (e.g. a proxy page without newlines). */
export const SSE_MAX_LINE_BYTES = 1 << 20;

export class ServerSentEventsError extends Error {}

/** Yields each dispatched event and each comment line; `retry:` is ignored. Throws ServerSentEventsError on an oversized line. */
export async function* parseServerSentEvents(stream: ReadableStream<Uint8Array>): AsyncGenerator<ServerSentEvent | { comment: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // A trailing "\r" may be the first half of "\r\n": keep it for the next chunk.
      const lines = buffer.split(/\r\n|\n|\r(?!$)/);
      buffer = done ? '' : (lines.pop() ?? '');
      // UTF-16 length bounds the UTF-8 size from below; good enough to stop runaway input.
      if (buffer.length > SSE_MAX_LINE_BYTES) throw new ServerSentEventsError('Server-sent event line too long.');
      for (const line of lines) {
        if (line === '') {
          if (data.length > 0 || event) yield { event: event || 'message', data: data.join('\n'), ...(id === undefined ? {} : { id }) };
          event = '';
          data = [];
          continue;
        }
        if (line.startsWith(':')) {
          yield { comment: line.slice(1).trimStart() };
          continue;
        }
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const raw = colon < 0 ? '' : line.slice(colon + 1);
        const text = raw.startsWith(' ') ? raw.slice(1) : raw;
        if (field === 'event') event = text;
        else if (field === 'data') data.push(text);
        else if (field === 'id' && !text.includes('\u0000')) id = text;
      }
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
