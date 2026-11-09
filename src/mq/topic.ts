import { getEnvVar } from '../runtime-env.js';

/**
 * An App ID usable as one MQTT topic level and as the app segment of a hosted App key's clientId, as Backend
 * `share/hostedappkey` accepts it: `<ws>&h.<app>.<[a-z0-9]{8,32}>`, app `[A-Za-z0-9_-]{1,64}` (no `&`, `.`, `/` or wildcards).
 */
export const APP_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The MQTT topic `apps/<TIER0_APP_ID>/<TIER0_RUNTIME>/<suffix>` in the App's own namespace.
 *
 * An App's key (the `TIER0_API_KEY` the platform injects) may publish and
 * subscribe under `apps/<appId>/<preview|deployed>/#` only: the Preview key
 * under `preview`, the deployed key under `deployed`. Backend picks the
 * segment from the key, not from the environment; the platform sets
 * `TIER0_RUNTIME` to the same word in each (`preview` in Builder previews,
 * `deployed` in deployments), so this helper builds the topic the key is
 * allowed to use.
 *
 * `suffix` is the rest of the topic and may end in the `+` / `#` wildcards for
 * `subscribe`, e.g. `appTopic('alarms/#')`. It must not be empty or start
 * with `/`.
 *
 * Throws outside the platform: when `TIER0_APP_ID` is missing or is not a
 * valid topic level, or `TIER0_RUNTIME` is not `preview` or `deployed`. It
 * never guesses a segment, so local development does not land in a deployed
 * App's topics; set both variables there yourself.
 */
export function appTopic(suffix: string): string {
  if (typeof suffix !== 'string' || suffix === '' || suffix.startsWith('/')) {
    throw new TypeError('Tier0 SDK v2: appTopic(suffix) needs a non-empty topic suffix that does not start with "/".');
  }
  const appId = getEnvVar('TIER0_APP_ID')?.trim();
  if (!appId || !APP_SEGMENT.test(appId)) {
    throw new Error('Tier0 SDK v2: appTopic needs TIER0_APP_ID (the App ID the platform injects; letters, digits, "-" or "_").');
  }
  const runtime = getEnvVar('TIER0_RUNTIME')?.trim();
  if (runtime !== 'preview' && runtime !== 'deployed') {
    throw new Error(`Tier0 SDK v2: appTopic needs TIER0_RUNTIME "preview" or "deployed", not ${JSON.stringify((runtime ?? '').slice(0, 64))}.`);
  }
  return `apps/${appId}/${runtime}/${suffix}`;
}
