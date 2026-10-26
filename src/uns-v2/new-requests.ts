import type { RequestOptions } from '../openapi/client.js';
import type { UnsV2Client } from './client.js';
import type { MetadataBulkInsertOne, UnsV2Request, UnsV2Response } from './generated.js';

/**
 * Explicit conveniences for NEW intents on canonical routes. Never use these to
 * resume a request originally sent through a compatibility operation: its action,
 * payload and durable receipt identity must stay unchanged during recovery.
 * Existing raw methods and collection helpers do not call this facade.
 */
export function bindUnsV2NewRequests(raw: UnsV2Client) {
  return Object.freeze({
    /** One bulk call, preserving input indexes. Defaults match the record insert-many contract. */
    recordInsertMany(request: UnsV2Request<'recordInsertMany'>, options?: RequestOptions) {
      const { documents, ...rest } = request;
      return raw.recordBulkWrite({ ...rest, atomic: request.atomic ?? false, ordered: request.ordered ?? true,
        operations: documents.map(document => ({ insertOne: document })) }, options);
    },
    /** One atomic metadata bulk call; the result is the canonical bulk receipt. */
    metadataInsertMany(request: UnsV2Request<'metadataInsertMany'>, options?: RequestOptions) {
      const { documents, ...rest } = request;
      return raw.metadataBulkWrite({ ...rest, atomic: true,
        // Both schemas accept the same JSON documents. The narrowed input's
        // optional-never exclusions are not representable by the bulk JSON index type.
        operations: documents.map(document => ({ insertOne: document as MetadataBulkInsertOne })) }, options);
    },
    async metadataFindOne(request: UnsV2Request<'metadataFindOne'>, options?: RequestOptions): Promise<UnsV2Response<'metadataFindOne'>> {
      const response = await raw.metadataFind({ ...request, limit: 1 }, options);
      return { ...response, data: { value: response.data.items[0] ?? null } };
    },
    async recordDistinct(request: UnsV2Request<'recordDistinct'>, options?: RequestOptions): Promise<UnsV2Response<'recordDistinct'>> {
      const { field, filter, ...rest } = request;
      const response = await raw.recordAggregatePipeline({ ...rest,
        pipeline: [{ $match: filter ?? {} }, { $group: { _id: '$' + field } }] }, options);
      return { ...response, data: { values: response.data.items.map(item => item._id), pageInfo: response.data.pageInfo } };
    },
    async metadataDistinct(request: UnsV2Request<'metadataDistinct'>, options?: RequestOptions): Promise<UnsV2Response<'metadataDistinct'>> {
      const { field, ...rest } = request;
      const response = await raw.metadataAggregate({ ...rest, pipeline: [{ $distinct: field }] }, options);
      return { ...response, data: { values: response.data.items.map(item => item.value), pageInfo: response.data.pageInfo } };
    },
  });
}

export type UnsV2NewRequests = ReturnType<typeof bindUnsV2NewRequests>;
