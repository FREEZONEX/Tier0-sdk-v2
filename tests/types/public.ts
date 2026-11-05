import { createClient, getCurrentAppId, type Tier0Client, type UnsV2Integer, type SourceDefinition, type SourceCredentials, type components } from '../../src/index.js';
import { useTier0Query, useTier0Mutation } from '../../src/react.js';
import { useTier0Request } from '../../src/vue.js';
const sdk: Tier0Client = createClient({ apiHost: 'https://api.example.invalid', apiKey: 'placeholder' });
// @ts-expect-error Retired convenience API has no alias.
sdk.controls;
sdk.streams.requests.use({ code: "orders.approve" });
// @ts-expect-error The data SDK does not re-export retired error classes.
type RetiredControlError = import('../../src/index.js').ControlError;
// @ts-expect-error The data SDK does not rename the old unknown error into a second Stream API.
type RetiredUnknownError = import('../../src/index.js').ControlResultUnknownError;
sdk.uns.recordFind({ collectionId: 'orders' }, { signal: new AbortController().signal });
sdk.source.documents.list({ includeDocument: false });
sdk.source.discover({ id: '101', expectedRevision: 1 });
sdk.stream.programs.deploy({ id: '123', dryRun: true });
// @ts-expect-error Source management belongs to its own domain
sdk.uns.sourceList({});
// @ts-expect-error Stream management belongs to its own domain
sdk.uns.streamProgramDeploy({ id: '123', dryRun: true });
// @ts-expect-error Native documents cannot be passed as runtime programs
sdk.stream.documents.validate({ program: { name: 'native', protocol: 'http-api', config: {} } });
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
    program: { name: 'typed-receipts', script: { code: 'module.exports=api=>{};', timeoutMs: 5000 } } });
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

// @ts-expect-error The retired readiness probe has no facade or compatibility alias.
sdk.stream.runtime.capabilities({});

// Both HTTP roles use the native management envelope, with the role inside config.
const httpClient: SourceDefinition = { name: 'client', protocol: 'http-api',
  role: 'client', endpoint: 'https://fixture.invalid', http: { anonymous: true } };
const httpServer: SourceDefinition = { name: 'server', protocol: 'http-api',
  role: 'server', endpoint: 'http://managed' };
sdk.source.documents.create({ dryRun: true, document: httpClient });
sdk.source.documents.create({ dryRun: true, document: httpServer });
sdk.source.documents.list({ protocol: 'http-api' });
// @ts-expect-error The old HTTP protocol is not a new management document protocol.
const retiredHttpProtocol: SourceDefinition['protocol'] = 'http';
// @ts-expect-error HTTP Push has no creation alias; use an HTTPServer Source and Stream route.
const retiredPushProtocol: SourceDefinition['protocol'] = 'http_push';
// @ts-expect-error The protocol filter cannot advertise retired Push Sources.
sdk.source.documents.list({ protocol: 'http_push' });
// @ts-expect-error Connection roles come from the public contract.
const invalidHttpRole: SourceDefinition['role'] = 'listener';
// Cloud and Enterprise share the same top-level role.
const misplacedHttpRole: SourceDefinition = { ...httpClient, role: 'client' };
void [retiredHttpProtocol, retiredPushProtocol, invalidHttpRole, misplacedHttpRole];

const inlineAuth: SourceCredentials[] = [
  { kind: 'basic', username: 'fixture', secret: 'fixture-only' },
  { kind: 'bearer', secret: 'fixture-only' },
  { kind: 'custom', values: { username: 'fixture', privateKey: 'fixture-only' } },
  { kind: 'oauth2', secret: 'fixture-only' },
];
for (const credentials of inlineAuth) sdk.source.documents.create({ dryRun: true, document: httpClient, credentials, idempotencyKey: 'fixture-inline' });
// @ts-expect-error APIKey inline material uses headerName/value.
const oldApiKeyMaterial: SourceCredentials = { kind: 'apiKey', material: { name: 'X-API-Key', key: 'fixture-only' } };
// @ts-expect-error APIKey only accepts REQUEST binding.
const invalidApiKeyMethod: SourceCredentials = { kind: 'apiKey', method: 'GET', material: { headerName: 'X-API-Key', value: 'fixture-only' } };
// @ts-expect-error Vendor SESSION is not an inline HTTP credential method.
const vendorSessionInline: SourceCredentials = { kind: 'bearer', method: 'SESSION', secret: 'fixture-only' };
// @ts-expect-error The independent credential endpoint remains Core-only.
sdk.source.credentials.create({});
void [oldApiKeyMaterial, invalidApiKeyMethod, vendorSessionInline];

const sqlCredentials: SourceCredentials = { kind: 'basic', username: 'fixture', secret: 'fixture-only' };
sdk.source.documents.create({ document: { name: 'PG', protocol: 'edge-sql', endpoint: 'postgres://fixture.invalid/database', sql: { queries: { inventory: 'SELECT id FROM inventory' }, tlsMode: 'verify-full' } }, credentials: sqlCredentials, idempotencyKey: 'sql-create' });
// @ts-expect-error SQL 连接不接受 HTTP method。
const sqlHTTPMethod: SourceCredentials = { kind: 'usernamePassword', method: 'GET', material: { username: 'fixture', password: 'fixture-only' } };
void sqlHTTPMethod;

sdk.source.documents.credentials.update({ id: '101', expectedRevision: 2,
  credentials: { kind: 'oauth2', secret: 'fixture-only' }, dryRun: true, idempotencyKey: 'rotate-oauth-fixture' });
sdk.stream.documents.create({ document: { name: 'edge-reader', model: 'program',
  script: { code: 'module.exports=api=>{};', timeoutMs: 5000 },
  sources: [{ alias: 'plant', target: { fleetNodeId: '101-202', sourceId: '303', configRevision: 2 } }],
} });
// @ts-expect-error A binding cannot mix a local Source identity and a remote target.
const mixedBinding: import('../../src/index.js').StreamSourceAlias = { alias: 'plant', sourceId: '101', configRevision: 2, target: { fleetNodeId: '101-202', sourceId: '303', configRevision: 2 } };
// @ts-expect-error A binding must select a local identity or a target.
const missingBinding: import('../../src/index.js').StreamSourceAlias = { alias: 'plant' };
void [mixedBinding, missingBinding];

// @ts-expect-error Single-model Source documents no longer select a config version.
const retiredConfigSelector: SourceDefinition = { configVersion: 2, endpoint: 'https://fixture.invalid', options: {} };
// @ts-expect-error Full Stream programs no longer select an interpreter generation.
sdk.stream.documents.create({ dryRun: true, program: { name: 'single-model', script: { code: 'module.exports=api=>{};', timeoutMs: 5000 }, sdkVersion: 'tier0-stream/v2' } });
// @ts-expect-error Native Stream script objects use code/timeoutMs without a generation selector.
sdk.stream.documents.validate({ document: { name: 'single-model', model: 'program', script: { code: 'module.exports=api=>{};', timeoutMs: 1000, sdkVersion: 'tier0-stream/v2' } } });
sdk.capabilities.discover().then(response => {
  // @ts-expect-error Internal interpreter generations are not part of public discovery.
  void response.interpreterContractVersions;
});
void retiredConfigSelector;
