import type { CloudStreamRunError, CloudStreamRunsListResponse } from '../../src/index.js';

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
const scopeError: CloudStreamRunError = {
  code: 'SOURCE_TARGET_SCOPE_MISMATCH', stage: 'validate_binding', message: 'Source request denied.',
  repair: 'Check the credential scope.', sourceRequest: 'notDispatched',
};
const failed: Run = { ...base, status: 'failed', error: scopeError };
const unknown: Run = { ...base, status: 'unknown', error: {
  code: 'RESULT_UNKNOWN', stage: 'unknown', message: 'Result unknown.', repair: 'Check the run outcome.',
} };
// @ts-expect-error A known diagnostic includes a safe repair instruction.
const missingRepair: CloudStreamRunError = { code: 'EXECUTION_FAILED', stage: 'execution', message: 'Failed.' };
// @ts-expect-error This field describes only a known, unsent Source request.
const inventedDispatch: CloudStreamRunError = { ...scopeError, sourceRequest: 'notStarted' };
void [missing, nullable, safe, exact, invalidTimestamp, invalidKind, failed, unknown, missingRepair, inventedDispatch];
