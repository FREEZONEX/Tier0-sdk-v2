import { createClient, getCurrentAppId, type Tier0Client, type components } from '../../src/index.js';
import { useTier0Query, useTier0Mutation } from '../../src/react.js';
import { useTier0Request } from '../../src/vue.js';
const sdk: Tier0Client = createClient({ apiHost: 'https://api.example.invalid', apiKey: 'placeholder' });
sdk.uns.recordFind({ collectionId: 'orders' }, { signal: new AbortController().signal });
sdk.source.documents.list({ includeDocument: false });
sdk.source.documents.get({ id: '101' }).then(result => result.data.document.config);
sdk.source.documents.get({ id: '101', view: 'full' }).then(result => result.data.document.config);
sdk.source.documents.get({ id: '101', view: 'summary' }).then(result => {
  // @ts-expect-error Summary reads do not expose connection configuration.
  return result.data.document;
});
sdk.stream.documents.get({ id: '202' }).then(result => result.data.document.script);
sdk.stream.documents.get({ id: '202', view: 'summary' }).then(result => {
  // @ts-expect-error Summary reads do not expose scripts.
  return result.data.document;
});
const sourceDocument = { name: 'orders', protocol: 'http' as const, config: { configVersion: 2 as const, endpoint: 'https://fixture.invalid', options: {} } };
sdk.source.documents.create({ dryRun: true, items: [{ document: sourceDocument }] });
// @ts-expect-error Exactly one of document/items is accepted.
sdk.source.documents.create({ dryRun: true, document: sourceDocument, items: [{ document: sourceDocument }] });
// @ts-expect-error Batch creation cannot provision inline credentials.
sdk.source.documents.create({ dryRun: true, items: [{ document: sourceDocument }], credentials: { auth: {} } });
sdk.source.documents.update({ dryRun: true, id: '101', expectedRevision: 1, confirmedImpactRevision: 'confirmation', patch: { name: 'renamed' } });
// @ts-expect-error A patch requires CAS and exact-intent impact confirmation.
sdk.source.documents.update({ dryRun: true, id: '101', patch: { name: 'renamed' } });
// @ts-expect-error document and patch are mutually exclusive, including batch items.
sdk.source.documents.update({ dryRun: true, items: [{ id: '101', expectedRevision: 1, confirmedImpactRevision: 'confirmation', patch: { name: 'renamed' }, document: sourceDocument }] });
const runtimeProgram = { name: 'orders-stream', sdkVersion: 'tier0-stream/v2' as const, script: 'module.exports = api => {};', sourceBindings: [] };
sdk.stream.documents.create({ dryRun: true, program: runtimeProgram });
sdk.stream.documents.validate({ program: runtimeProgram });
// @ts-expect-error Exactly one native document or runtime program is required.
sdk.stream.documents.create({ dryRun: true });
sdk.stream.programs.deploy({ id: '123', dryRun: true });
// @ts-expect-error Source management belongs to its own domain
sdk.uns.sourceList({});
// @ts-expect-error Stream management belongs to its own domain
sdk.uns.streamProgramDeploy({ id: '123', dryRun: true });
// @ts-expect-error Native documents cannot be passed as runtime programs
sdk.stream.programs.validate({ document: { name: 'native', protocol: 'http', config: {} } });
sdk.mqttAuth.delete({ id: 9007199254740993n });
const info = sdk.system.info();
info.then(value => { const broker: string | undefined = value.mqttBroker; void broker; });
// @ts-expect-error retired project/flow APIs are not public
sdk.flow.list();
sdk.members.listApp({ appId: getCurrentAppId(), roleKeys: ['operator'], page: 1, size: 20 }).then(page => {
  const member = page.list[0];
  const userId: string = member.userId;
  const sourceType: string = member.roles[0].sources[0].type;
  void userId;
  void sourceType;
});
// @ts-expect-error appId is explicit; the SDK never reads APP_ID implicitly
sdk.members.listApp({});
// @ts-expect-error desktop is not an independent notification channel
const invalid: components['schemas']['SendNotificationReq'] = { recipientUserId: '1', title: 'x', content: 'x', type: 'x', idempotencyKey: 'x', channels: ['desktop'] };
useTier0Query(sdk, ['orders'], (c, signal) => c.uns.recordFind({ collectionId: 'orders' }, { signal }));
useTier0Mutation(sdk, (c, name: string) => c.mqttAuth.create({ name }));
useTier0Request(sdk, (c, id: string, signal) => c.uns.recordFind({ collectionId: id }, { signal }));
void invalid;
