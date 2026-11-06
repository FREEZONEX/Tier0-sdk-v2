import { createDataClient } from '../../src/data/index.js';
createDataClient({ apiKey: 'static' });
// @ts-expect-error Data client state cannot be shared across a dynamic getter.
createDataClient({ getApiKey: () => 'user' });
// @ts-expect-error An async provider is not a stable Data client identity.
createDataClient({ apiKeyProvider: async () => 'user' });
