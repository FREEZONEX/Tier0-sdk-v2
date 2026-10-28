const retired = ['http_push', '/ingest/v1/messages'];

/** Refuse stale contract inputs that would recreate the removed Push configuration. */
export function assertNoRetiredHTTPPush(input, source) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  for (const name of retired) {
    if (text.includes(name)) throw new Error(`Retired HTTP Push ${name} in ${source}; sync a current Backend contract.`);
  }
}
