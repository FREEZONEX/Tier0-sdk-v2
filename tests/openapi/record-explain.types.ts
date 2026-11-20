import type {
  UnsV2Client,
  UnsV2Integer,
  UnsV2OperationName,
  UnsV2Request,
  UnsV2Response,
  UnsV2RecordExplainReq,
  UnsV2RecordExplainResponse,
} from '../../src/uns-v2/index.js';

declare const client: UnsV2Client;

async function filterExplainCompatibility() {
  const implicit = await client.recordExplain({ collectionId: 'orders', filter: { status: 'OPEN' } });
  const explicit = await client.recordExplain({ collectionId: 'orders', op: 'find', filter: { status: 'OPEN' } });
  const update = await client.recordExplain({ collectionId: 'orders', op: 'updateMany' });
  const remove = await client.call('recordExplain', { collectionId: 'orders', op: 'deleteMany' });
  for (const result of [implicit, explicit, update, remove]) {
    const count: UnsV2Integer = result.data.matchedCount;
    const capped: boolean = result.data.capped;
    const ids: string[] = result.data.sampleIds;
    void [count, capped, ids];
  }
}

async function aggregateExplainHasNoExecutionResults() {
  // @ts-expect-error Aggregate explain must identify the pipeline it plans.
  client.recordExplain({ collectionId: 'orders', op: 'aggregate' });
  // @ts-expect-error The generic core follows the same request contract.
  client.call('recordExplain', { collectionId: 'orders', op: 'aggregate' });
  const named = await client.recordExplain({ collectionId: 'orders', op: 'aggregate', pipeline: [{ $count: 'total' }] });
  const direct = await client.call('recordExplain', { collectionId: 'orders', op: 'aggregate', pipeline: [{ $count: 'total' }] });
  for (const result of [named, direct]) {
    const operation: 'aggregate' = result.data.op;
    const writes: false = result.data.writesCommitted;
    // @ts-expect-error Planning never executes the pipeline to compute a match count.
    result.data.matchedCount;
    // @ts-expect-error Planning never reads sample records.
    result.data.sampleIds;
    void [operation, writes];
  }
}

async function dynamicExplainKeepsUnion(request: UnsV2RecordExplainReq) {
  const result: UnsV2RecordExplainResponse = await client.recordExplain(request);
  // @ts-expect-error An unknown operation must be narrowed before accessing count fields.
  result.data.matchedCount;
  if (result.data.op !== 'aggregate') {
    const count: UnsV2Integer = result.data.matchedCount;
    return count;
  }
  return result.data.plan;
}

function genericCallStillWorks<Name extends UnsV2OperationName>(name: Name, request: UnsV2Request<Name>): Promise<UnsV2Response<Name>> {
  return client.call(name, request);
}

void [filterExplainCompatibility, aggregateExplainHasNoExecutionResults, dynamicExplainKeepsUnion, genericCallStillWorks];
