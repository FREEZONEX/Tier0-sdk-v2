import { z } from 'zod';
import { createDataClient, DataError, defineCollection, runAsApp, type Doc, type NewDoc } from '../../src/data/index.js';

const workOrders = defineCollection({
  alias: 'work_orders',
  schema: z.object({ code: z.string(), status: z.enum(['DRAFT', 'DONE']), qty: z.number().int().optional() }),
  indexes: [{ path: 'code', unique: true }],
  seed: [{ _id: 'wo-1', code: 'WO-1', status: 'DRAFT' }],
});
// @ts-expect-error a seed document carries a fixed _id
defineCollection({ alias: 'unseeded', schema: z.object({ a: z.string() }), seed: [{ a: 'x' }] });

const data = createDataClient({ collections: [workOrders] });
const orders = data.collection(workOrders);
orders.find({ status: 'DRAFT' }, { sort: { '_meta.createdAt': -1 }, limit: 50 }).toArray().then(rows => {
  const order: Doc<typeof workOrders> = rows[0];
  const revision: number = order._meta.revision;
  const status: 'DRAFT' | 'DONE' = order.status;
  void revision;
  void status;
});
const draft: NewDoc<typeof workOrders> = { code: 'WO-2', status: 'DRAFT' };
orders.insertOne(draft);
// @ts-expect-error status is a declared enum
orders.insertOne({ code: 'WO-3', status: 'LOST' });
orders.findOneAndUpdate({ _id: 'wo-1', status: 'DRAFT' }, { $set: { status: 'DONE' } }).then(moved => {
  if (moved === null) return;
  const code: string = moved.code;
  void code;
});
data.transact([{ opId: 'done', action: 'record.update', collection: workOrders, filter: { _id: 'wo-1' }, update: { $set: { status: 'DONE' } } }]);
runAsApp(() => data.collection<{ code: string }>('work_orders').countDocuments());
const failure: unknown = undefined;
if (failure instanceof DataError) {
  const answer: { status: number; code: string; reason?: string; outcomeUnknown: boolean } = failure;
  void answer;
}
