import { createClient, getCurrentAppId, type Tier0Client, type UnsV2Integer, type components } from '../../src/index.js';
import { useTier0Query, useTier0Mutation } from '../../src/react.js';
import { useTier0Request } from '../../src/vue.js';
const sdk: Tier0Client = createClient({ apiHost: 'https://api.example.invalid', apiKey: 'placeholder' });
sdk.uns.recordFind({ collectionId: 'orders' }, { signal: new AbortController().signal });
sdk.source.documents.list({ includeDocument: false });
sdk.stream.programs.deploy({ id: '123', dryRun: true });
// @ts-expect-error Source management belongs to its own domain
sdk.uns.sourceList({});
// @ts-expect-error Stream management belongs to its own domain
sdk.uns.streamProgramDeploy({ id: '123', dryRun: true });
// @ts-expect-error Native documents cannot be passed as runtime programs
sdk.stream.documents.validate({ program: { name: 'native', protocol: 'http', config: {} } });
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

export async function publishStreamFromReceipts(client: Tier0Client) {
  const created = await client.stream.documents.create({ dryRun: false, idempotencyKey: 'create',
    program: { name: 'typed-receipts', sdkVersion: 'tier0-stream/v2', script: 'module.exports=api=>{};' } });
  if (!('id' in created.data)) return;
  const deployed = await client.stream.programs.deploy({ id: created.data.id,
    expectedRevision: created.data.revision, dryRun: false, idempotencyKey: 'deploy' });
  if (!('id' in deployed.data)) return;
  const revision: UnsV2Integer = deployed.data.revision;
  const activeVersion: string = deployed.data.activeVersion;
  const release: UnsV2Integer | undefined = deployed.data.activeRelease;
  // @ts-expect-error Inactive programs and historical idempotency receipts may omit the release number.
  const assumedRelease: UnsV2Integer = deployed.data.activeRelease;
  void revision; void activeVersion; void assumedRelease;
  return release;
}

// @ts-expect-error Retired Source projection aliases have no fallback route.
sdk.source.list({});
// @ts-expect-error Retired Stream projection aliases have no fallback route.
sdk.stream.programs.get({ id: "301" });
// @ts-expect-error Namespace Agent routes have no v2 contract.
sdk.agent.nodes.searchSemantic({});
