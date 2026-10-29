import { z } from 'zod';
import { createDataClient, DataError, defineCollection, runAsApp, type DeepPartial, type Doc, type InsertOneOptions, type NewDoc, type WithMeta } from '../../src/data/index.js';

const workOrders = defineCollection({
  alias: 'work_orders',
  name: '生产工单',
  schema: z.object({ code: z.string(), status: z.enum(['DRAFT', 'DONE']), qty: z.number().int().optional() }),
  indexes: [{ path: 'code', unique: true }],
  seed: [{ _id: 'wo-1', code: 'WO-1', status: 'DRAFT' }],
});
// @ts-expect-error a seed document carries a fixed _id
defineCollection({ alias: 'unseeded', name: '种子校验', schema: z.object({ a: z.string() }), seed: [{ a: 'x' }] });

const data = createDataClient({ collections: [workOrders] });
// @ts-expect-error a business name is required separately from the alias
defineCollection({ alias: 'missing_name', schema: z.object({ code: z.string() }) });
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
orders.insertOne(draft).then(result => {
  const id: string = result.insertedId;
  void id;
  // @ts-expect-error default insert retains the ID-only return type
  void result.value;
});
orders.insertOne(draft, { returnDocument: 'after', idempotencyKey: 'create-order' }).then(result => {
  const record: Doc<typeof workOrders> = result.value;
  const revision: number = record._meta.revision;
  void revision;
});
orders.insertOne(draft, { returnDocument: 'after', projection: { code: 1 } }).then(result => {
  const code: string | undefined = result.value.code;
  const id: string = result.value._id;
  const revision: number = result.value._meta.revision;
  // @ts-expect-error a projected snapshot cannot guarantee a required business field
  const status: 'DRAFT' | 'DONE' = result.value.status;
  void [code, id, revision, status];
});
const dynamicOptions: InsertOneOptions = Math.random() > 0.5 ? { returnDocument: 'after', projection: { code: 1 } } : {};
orders.insertOne(draft, dynamicOptions).then(result => {
  const optional: WithMeta<DeepPartial<NewDoc<typeof workOrders>>> | undefined = result.value;
  void optional;
});

const nestedOrders = defineCollection({ alias: 'nested_orders', name: '客户工单', schema: z.object({
  code: z.string(), customer: z.object({ name: z.string(), email: z.string() }),
  lines: z.array(z.object({ sku: z.string(), quantity: z.number() })), tags: z.array(z.string()),
}) });
const nestedHandle = createDataClient({ collections: [nestedOrders] }).collection(nestedOrders);
const nestedInput: NewDoc<typeof nestedOrders> = { code: 'A', customer: { name: 'A', email: 'a@example.invalid' }, lines: [{ sku: 'A', quantity: 1 }], tags: ['A'] };
nestedHandle.insertOne(nestedInput, { returnDocument: 'after' }).then(result => {
  const full: Doc<typeof nestedOrders> = result.value;
  const email: string = full.customer.email;
  const quantity: number = full.lines[0].quantity;
  void [email, quantity];
});
nestedHandle.insertOne(nestedInput, { returnDocument: 'after', projection: { 'customer.name': 1, 'lines.sku': 1, tags: 1 } }).then(result => {
  if (result.value.customer) {
    const email: string | undefined = result.value.customer.email;
    // @ts-expect-error checking the parent does not make an omitted nested field present
    const requiredEmail: string = result.value.customer.email;
    void [email, requiredEmail];
  }
  if (result.value.lines?.[0]) {
    const quantity: number | undefined = result.value.lines[0].quantity;
    // @ts-expect-error projected array elements may omit their nested fields
    const requiredQuantity: number = result.value.lines[0].quantity;
    void [quantity, requiredQuantity];
  }
  if (result.value.tags) {
    const tag: string = result.value.tags[0];
    void tag;
  }
});
const optionalProjection = Math.random() > 0.5 ? { 'customer.email': 0 as const } : undefined;
nestedHandle.insertOne(nestedInput, { returnDocument: 'after', projection: optionalProjection }).then(result => {
  // @ts-expect-error a runtime-optional projection cannot promise the complete document
  const full: Doc<typeof nestedOrders> = result.value;
  void full;
});
// @ts-expect-error inserts have no previous document
orders.insertOne(draft, { returnDocument: 'before' });
// @ts-expect-error projection requires a returned document
orders.insertOne(draft, { projection: { code: 1 } });
// @ts-expect-error none cannot be combined with projection
orders.insertOne(draft, { returnDocument: 'none', projection: { code: 1 } });
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
