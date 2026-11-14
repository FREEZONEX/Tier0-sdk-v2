import type { AppContext } from '../uns-v2/generated.js';
import type { DataCall } from './call.js';
import type { EnsureState } from './bootstrap.js';
import { MAX_ATOMIC_ITEMS } from './collection.js';
import { DataError } from './error.js';

/** Tested client ceiling for the explicit synchronous record transaction API. */
export const MAX_TRANSACTION_ITEMS = 10_000;
export interface TransactionLimits {
  maxItems: number;
  maxBodyBytes: number;
  timeoutMs: number;
}
const legacyLimits: TransactionLimits = { maxItems: MAX_ATOMIC_ITEMS, maxBodyBytes: 16 << 20, timeoutMs: 10_000 };
const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

/** Read capabilities with the same App principal; missing capability means the
 * legacy limit, while authorization errors or malformed responses are errors. */
export async function readTransactionLimits(call: DataCall, ensure: () => Promise<EnsureState>, signal?: AbortSignal): Promise<TransactionLimits> {
  const state = await ensure();
  // Existing-ID clients without an App context keep the conservative contract.
  if (!state.appId) return { ...legacyLimits };
  const context = await call<AppContext>('dataAppContext', {}, { signal });
  if (!context || context.appId !== state.appId) throw new DataError({ code: 'DATA_BAD_RESPONSE', status: 502, execution: 'notStarted',
    message: 'Transaction capabilities do not belong to this App.' });
  const limits = context.limits?.transaction;
  if (limits === undefined) return { ...legacyLimits };
  if (!limits || !positiveInteger(limits.maxItems) || !positiveInteger(limits.maxBodyBytes) || !positiveInteger(limits.timeoutMs))
    throw new DataError({ code: 'DATA_BAD_RESPONSE', status: 502, execution: 'notStarted', message: 'Invalid transaction limits in App context.' });
  return { maxItems: Math.min(MAX_TRANSACTION_ITEMS, limits.maxItems), maxBodyBytes: limits.maxBodyBytes, timeoutMs: limits.timeoutMs };
}

export function assertTransactionCapacity(count: number, maxItems: number) {
  if (count > maxItems) throw new DataError({ code: 'BATCH_LIMIT_EXCEEDED', status: 400, execution: 'notStarted',
    message: `data.transact needs ${count} atomic steps; this client/server supports ${maxItems}. No transaction was sent. Do not split work that must commit together.`,
    details: { requestedItems: count, maxItems } });
}
