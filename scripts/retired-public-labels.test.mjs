import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNoRetiredControls } from './retired-controls.mjs';

test('rejects stale public projections without banning historical identities', () => {
  const current = {
    cloudContractRevision: 'hosted-control/1+stream-control-probe-retirement/1',
    history: { id: 'control:123', cursorKind: 'control', trigger: 'control' },
    operations: ['streamRequestGrantGet', 'streamRequestGrantSet', 'appStreamAccessList'].map(name => ({name, resource: 'stream'})),
  };
  assert.doesNotThrow(() => assertNoRetiredControls(current, 'fixture'));
  for (const operation of current.operations) {
    const stale = {...current, operations: [{...operation, resource: 'control'}]};
    for (const input of [stale, JSON.stringify(stale)]) {
      assert.throws(() => assertNoRetiredControls(input, 'fixture'), /resource metadata/);
    }
  }
  for (const container of ['manifest', 'openapi']) {
    for (const name of ['CloudStreamRunsListResponse', 'DocUnsV2StreamRunsListResponse']) {
      const kind = {enum: ['delivery', 'control', 'http']};
      const schemas = {[name]: {properties: {data: {properties: {items: {items: {properties: {kind}}}}}}}};
      const staleRun = container === 'manifest' ? {schemas} : {components: {schemas}};
      for (const input of [staleRun, JSON.stringify(staleRun)]) {
        assert.throws(() => assertNoRetiredControls(input, 'fixture'), /run kind/);
      }
      kind.enum = ['delivery', 'request', 'http'];
      for (const input of [staleRun, JSON.stringify(staleRun)]) {
        assert.doesNotThrow(() => assertNoRetiredControls(input, 'fixture'));
      }
    }
  }
});

test('rejects retired public versions and reason while accepting neutral values', () => {
  for (const value of ['cloud-hosted-app-control/v1', 'cloud-control-app/v1', 'app_control_ceiling']) {
    assert.throws(() => assertNoRetiredControls({value}, 'fixture'), /Retired Controls contract/);
  }
  for (const value of ['cloud-hosted-app-stream/v1', 'cloud-stream-app/v1', 'app_stream_ceiling']) {
    assert.doesNotThrow(() => assertNoRetiredControls({value}, 'fixture'));
  }
});
