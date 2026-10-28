import type { CloudStreamRunsListResponse } from '../../src/index.js';

type Run = CloudStreamRunsListResponse['data']['items'][number];
const base: Run = { id: 'http:request', kind: 'http', release: '3', entryId: 'entry', trigger: 'http-request', status: 'admitted', createdAt: 1, finishedAt: null, durationMs: null };
const missing: Run = { ...base };
const nullable: Run = { ...base, responseSentAt: null };
const safe: Run = { ...base, responseSentAt: 1793210000000 };
const exact: Run = { ...base, responseSentAt: 9223372036854775807n };
// @ts-expect-error Timestamps use the exact numeric int64 contract, not strings.
const invalidTimestamp: Run = { ...base, responseSentAt: '1793210000000' };
// @ts-expect-error This increment does not introduce unrelated run kinds.
const invalidKind: Run = { ...base, kind: 'mqtt' };
void [missing, nullable, safe, exact, invalidTimestamp, invalidKind];
