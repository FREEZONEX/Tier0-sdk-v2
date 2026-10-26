import assert from 'node:assert/strict';

// Only operates on fixtures created by check-live-workflows in this run.
export async function checkExtendedUns(client, collectionId, prefix, step, report) {
  const findOne = async request => (await client.uns.metadataFind({ ...request, limit: 1 })).data.items[0] ?? null;
  const idempotencyKey = name => `${prefix}-${name}`;
  const committed = result => {
    assert.equal(result.data.status, 'committed');
    assert.ok(!result.data.results?.some(item => item.error));
    return result;
  };
  let directoryId, topicId;
  try {
    await step('UNS directory create + get + update', async () => {
      const id = prefix + '-dir';
      committed(await client.uns.metadataInsertOne({ kind: 'directory', id, data: { name: prefix }, idempotencyKey: idempotencyKey('dir-create') }));
      directoryId = id;
      report.fixtures.directory = { id, state: 'created' };
      const current = (await findOne({ kind: 'directory', filter: { _id: id } }));
      committed(await client.uns.metadataUpdateOne({ kind: 'directory', filter: { _id: id }, update: { $set: { name: prefix + '-edit' } }, expectedRevision: current.revision, idempotencyKey: idempotencyKey('dir-update') }));
      assert.equal((await findOne({ kind: 'directory', filter: { _id: id } })).data.name, prefix + '-edit');
    });
    await step('UNS Topic create + get + update', async () => {
      const id = prefix + '-topic';
      committed(await client.uns.metadataInsertOne({ kind: 'topic', id, data: { name: prefix, viewMode: 'records', collectionId, parentId: directoryId }, idempotencyKey: idempotencyKey('topic-create') }));
      topicId = id;
      report.fixtures.topic = { id, state: 'created' };
      const current = (await findOne({ kind: 'topic', filter: { _id: id } }));
      committed(await client.uns.metadataUpdateOne({ kind: 'topic', filter: { _id: id }, update: { $set: { name: prefix + '-edit' } }, expectedRevision: current.revision, idempotencyKey: idempotencyKey('topic-update') }));
      assert.equal((await findOne({ kind: 'topic', filter: { _id: id } })).data.name, prefix + '-edit');
    });
    for (const [kind, id] of [['topic', topicId], ['directory', directoryId]]) {
      // Topic goes first, so its directory can be archived without live children.
      await step(`UNS ${kind} archive + restore + cleanup`, async () => {
        const current = (await findOne({ kind, filter: { _id: id } }));
        committed(await client.uns.metadataDeleteOne({ kind, filter: { _id: id }, expectedRevision: current.revision, idempotencyKey: idempotencyKey(`${kind}-archive`) }));
        report.fixtures[kind].state = 'archived';
        const archived = (await findOne({ kind, filter: { _id: id }, state: 'deleted' }));
        assert.ok(archived);
        committed(await client.uns.metadataRestore({ kind, items: [{ id, expectedRevision: archived.revision }], idempotencyKey: idempotencyKey(`${kind}-restore`) }));
        report.fixtures[kind].state = 'restored';
        const restored = (await findOne({ kind, filter: { _id: id } }));
        assert.equal(restored.id, id);
        committed(await client.uns.metadataDeleteOne({ kind, filter: { _id: id }, expectedRevision: restored.revision, idempotencyKey: idempotencyKey(`${kind}-cleanup`) }));
        report.fixtures[kind].state = 'archived';
      });
    }
  } catch { /* Report failure; cleanup only created resources. */ }
  finally {
    for (const [kind, id] of [['topic', topicId], ['directory', directoryId]]) {
      if (!id || report.fixtures[kind].state === 'archived') continue;
      try { await step(`UNS ${kind} cleanup after failure`, async () => {
        const current = (await findOne({ kind, filter: { _id: id } }));
        committed(await client.uns.metadataDeleteOne({ kind, filter: { _id: id }, expectedRevision: current.revision, idempotencyKey: idempotencyKey(`${kind}-fallback-cleanup`) }));
        report.fixtures[kind].state = 'archived';
      }); } catch { /* Cleanup failure remains visible. */ }
    }
  }
  try {
    await step('UNS record count + distinct', async () => {
      assert.equal(String((await client.uns.recordCount({ collectionId })).data.count), '1');
      assert.ok(JSON.stringify((await client.uns.recordAggregatePipeline({ collectionId, pipeline: [{ $match: {} }, { $group: { _id: '$name' } }], page: { mode: 'offset', page: 1, size: 200 } })).data).includes('SDK edited'));
    });
    const time = Date.now();
    await step('UNS sample append + history + latest + aggregate', async () => {
      committed(await client.uns.sampleAppend({ collectionId, recordId: 'device-1', dryRun: false, items: [{ time, data: { temperature: 23.5 } }], idempotencyKey: idempotencyKey('sample-append') }));
      const history = await client.uns.sampleFind({ collectionId, recordIds: ['device-1'], from: time - 1, to: time + 1, limit: 10 });
      assert.equal(history.data.items[0]?.data.temperature, 23.5);
      const latest = await client.uns.sampleLatestValues({ collectionId, recordIds: ['device-1'] });
      assert.equal(latest.data.series[0]?.sample.data.temperature, 23.5);
      await client.uns.sampleAggregate({ collectionId, recordIds: ['device-1'], from: time - 1, to: time + 1, pipeline: [] });
    });
    await step('UNS sample range delete + empty readback', async () => {
      await client.uns.sampleDeleteRange({ collectionId, recordIds: ['device-1'], from: time - 1, to: time + 1, dryRun: false });
      assert.equal((await client.uns.sampleFind({ collectionId, recordIds: ['device-1'], from: time - 1, to: time + 1, limit: 10 })).data.items.length, 0);
    });
  } catch { /* Independent lease/transaction checks still run. */ }
  let locks;
  try {
    await step('UNS record lock + renew', async () => {
      const acquired = await client.uns.recordLock({ collectionId, ids: ['device-1'], ttlMs: 30000 });
      locks = acquired.data.locks.map(({ id, token }) => ({ id, token }));
      assert.equal(locks.length, 1);
      assert.equal((await client.uns.recordRenew({ collectionId, locks })).data.locks.length, 1);
    });
  } catch { /* Lease cleanup in finally. */ }
  finally {
    if (locks?.length) try { await step('UNS record unlock', async () => {
      assert.equal(String((await client.uns.recordUnlock({ collectionId, locks })).data.unlockedCount), '1');
    }); } catch { /* Leases also expire after the bounded TTL. */ }
  }
  try {
    const items = [
      { opId: 'check', action: 'record.check', collectionId, filter: { _id: 'device-1', name: 'SDK edited' } },
      { opId: 'update', action: 'record.update', collectionId, filter: { _id: 'device-1' }, dependsOn: ['check'], operations: [{ op: 'set', path: 'name', value: 'SDK transaction' }] },
    ];
    await step('UNS transaction validate + execute + readback', async () => {
      const validation = await client.uns.recordTransactionExecute({ items, dryRun: true });
      assert.equal(validation.data.status, 'validated');
      committed(await client.uns.recordTransactionExecute({ items, dryRun: false, idempotencyKey: idempotencyKey('transaction') }));
      assert.equal((await client.uns.recordFind({ collectionId, filter: { _id: 'device-1' }, limit: 1 })).data.items[0].data.name, 'SDK transaction');
    });
    await step('UNS records:get', async () => {
      const result = await client.uns.recordGet({ collectionId, ids: ['device-1', 'device-missing'] });
      assert.deepEqual(result.data.items.map(item => item.id), ['device-1']);
      assert.deepEqual(result.data.missing, ['device-missing']);
    });
  } catch { /* Caller will delete the record and archive the collection. */ }
}
