import { createClient } from '../../src/index.js';
import { createDataClient } from '../../src/data/index.js';

const apiKeyProvider = async ({ signal }: { signal: AbortSignal }): Promise<string> => {
  signal.throwIfAborted();
  return 'fixture';
};
createClient({ apiKeyProvider });
// The configuration type remains shared; Data rejects the provider at runtime.
if (false) createDataClient({ apiKeyProvider });
// @ts-expect-error Providers must resolve to a string key.
createClient({ apiKeyProvider: async () => 1 });
