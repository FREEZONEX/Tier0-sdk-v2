import { createClient } from '../../src/index.js';
import { createDataClient } from '../../src/data/index.js';

const apiKeyProvider = async ({ signal }: { signal: AbortSignal }): Promise<string> => {
  signal.throwIfAborted();
  return 'fixture';
};
createClient({ apiKeyProvider });
// @ts-expect-error Data client state must not follow dynamic credentials.
if (false) createDataClient({ apiKeyProvider });
// @ts-expect-error Providers must resolve to a string key.
createClient({ apiKeyProvider: async () => 1 });
