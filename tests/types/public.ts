import { createClient, getCurrentAppId, type Tier0Client, type UnsV2Integer, type CloudSourceDocument, type CloudSourceConfig, type CloudSourceCreateCredentials, type components } from '../../src/index.js';
import { useTier0Query, useTier0Mutation } from '../../src/react.js';
import { useTier0Request } from '../../src/vue.js';
const sdk: Tier0Client = createClient({ apiHost: 'https://api.example.invalid', apiKey: 'placeholder' });
// @ts-expect-error Retired convenience API has no alias.
sdk.controls;
// @ts-expect-error Stream interactions belong to the independent @tier0/sdk package.
sdk.streams;
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
    program: { name: 'typed-receipts', script: 'module.exports=api=>{};' } });
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
const httpClient: CloudSourceDocument = { name: 'client', protocol: 'http-api',
  config: { role: 'client', endpoint: 'https://fixture.invalid', options: {} } };
const httpServer: CloudSourceDocument = { name: 'server', protocol: 'http-api',
  config: { role: 'server', endpoint: 'http://managed', options: {} } };
sdk.source.documents.create({ dryRun: true, document: httpClient });
sdk.source.documents.create({ dryRun: true, document: httpServer });
sdk.source.documents.list({ protocol: 'http-api' });
// @ts-expect-error The old HTTP protocol is not a new management document protocol.
const retiredHttpProtocol: CloudSourceDocument['protocol'] = 'http';
// @ts-expect-error HTTP Push has no creation alias; use an HTTPServer Source and Stream route.
const retiredPushProtocol: CloudSourceDocument['protocol'] = 'http_push';
// @ts-expect-error The protocol filter cannot advertise retired Push Sources.
sdk.source.documents.list({ protocol: 'http_push' });
// @ts-expect-error Connection roles come from the public contract.
const invalidHttpRole: CloudSourceConfig['role'] = 'listener';
// @ts-expect-error Enterprise projection roles cannot be copied to the Cloud document root.
const misplacedHttpRole: CloudSourceDocument = { ...httpClient, role: 'client' };
void [retiredHttpProtocol, retiredPushProtocol, invalidHttpRole, misplacedHttpRole];

const inlineAuth: CloudSourceCreateCredentials[] = [
  { kind: 'basic', material: { username: 'fixture', password: 'fixture-only' } },
  { kind: 'bearer', material: { token: 'fixture-only' } },
  { kind: 'apiKey', material: { headerName: 'X-API-Key', value: 'fixture-only' } },
  { kind: 'oauth2ClientCredentials', material: { tokenUrl: 'https://fixture.invalid/token', clientId: 'fixture', clientSecret: 'fixture-only' } },
  { kind: 'oauth2ClientCredentials', method: 'REQUEST', material: { tokenUrl: 'https://fixture.invalid/token', clientId: 'fixture', clientSecret: 'fixture-only', clientAuthentication: 'client_secret_basic' } },
];
for (const credentials of inlineAuth) sdk.source.documents.create({ dryRun: true, document: httpClient, credentials, idempotencyKey: 'fixture-inline' });
// @ts-expect-error APIKey inline material uses headerName/value.
const oldApiKeyMaterial: CloudSourceCreateCredentials = { kind: 'apiKey', material: { name: 'X-API-Key', key: 'fixture-only' } };
// @ts-expect-error APIKey only accepts REQUEST binding.
const invalidApiKeyMethod: CloudSourceCreateCredentials = { kind: 'apiKey', method: 'GET', material: { headerName: 'X-API-Key', value: 'fixture-only' } };
// @ts-expect-error Vendor SESSION is not an inline HTTP credential method.
const vendorSessionInline: CloudSourceCreateCredentials = { kind: 'bearer', method: 'SESSION', material: { token: 'fixture-only' } };
// @ts-expect-error The independent credential endpoint remains Core-only.
sdk.source.credentials.create({});
void [oldApiKeyMaterial, invalidApiKeyMethod, vendorSessionInline];

const sqlCredentials: CloudSourceCreateCredentials = { kind: 'usernamePassword', material: { username: 'fixture', password: 'fixture-only' } };
sdk.source.documents.create({ document: { name: 'PG', protocol: 'sql', config: { endpoint: 'postgres://fixture.invalid/database', options: {} } }, credentials: sqlCredentials, idempotencyKey: 'sql-create' });
// @ts-expect-error SQL 连接不接受 HTTP method。
const sqlHTTPMethod: CloudSourceCreateCredentials = { kind: 'usernamePassword', method: 'GET', material: { username: 'fixture', password: 'fixture-only' } };
void sqlHTTPMethod;

// @ts-expect-error Single-model Source documents no longer select a config version.
const retiredConfigSelector: CloudSourceConfig = { configVersion: 2, endpoint: 'https://fixture.invalid', options: {} };
// @ts-expect-error Full Stream programs no longer select an interpreter generation.
sdk.stream.documents.create({ dryRun: true, program: { name: 'single-model', script: 'module.exports=api=>{};', sdkVersion: 'tier0-stream/v2' } });
// @ts-expect-error Native Stream script objects use code/timeoutMs without a generation selector.
sdk.stream.documents.validate({ document: { name: 'single-model', model: 'program', script: { code: 'module.exports=api=>{};', timeoutMs: 1000, sdkVersion: 'tier0-stream/v2' } } });
sdk.capabilities.discover().then(response => {
  // @ts-expect-error Internal interpreter generations are not part of public discovery.
  void response.interpreterContractVersions;
});
void retiredConfigSelector;
