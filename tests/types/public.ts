import { createClient, type Tier0Client, type components } from '../../src/index.js';
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
sdk.stream.programs.validate({ document: { name: 'native', protocol: 'http', config: {} } });
sdk.mqttAuth.delete({ id: 9007199254740993n });
const info = sdk.system.info();
info.then(value => { const broker: string | undefined = value.mqttBroker; void broker; });
// @ts-expect-error retired project/flow APIs are not public
sdk.flow.list();
// @ts-expect-error app-member endpoint has not landed
sdk.members.listApp({ appId: 'app' });
// @ts-expect-error desktop is not an independent notification channel
const invalid: components['schemas']['SendNotificationReq'] = { recipientUserId: '1', title: 'x', content: 'x', type: 'x', idempotencyKey: 'x', channels: ['desktop'] };
useTier0Query(sdk, ['orders'], (c, signal) => c.uns.recordFind({ collectionId: 'orders' }, { signal }));
useTier0Mutation(sdk, (c, name: string) => c.mqttAuth.create({ name }));
useTier0Request(sdk, (c, id: string, signal) => c.uns.recordFind({ collectionId: id }, { signal }));
void invalid;
