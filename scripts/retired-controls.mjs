export const retiredControlOperations = [
  'controlDiscover', 'controlDescribe', 'controlInvoke',
  'hostedAppControlPolicyGet', 'hostedAppControlPolicyUpdate', 'controlGrantGet', 'controlGrantSet',
  'controlAppCapabilities', 'controlAppList', 'controlAppGet', 'controlAppCreate', 'controlAppUpdate', 'controlAppPermissionsUpdate',
];

export const retiredControlSchemas = [
  'CloudControlDefinition', 'CloudControlDiscoverReq', 'CloudControlDiscoverResponse',
  'CloudControlDescribeReq', 'CloudControlDescribeResponse', 'CloudControlInvokeReq', 'CloudControlInvokeResponse',
  'CloudHostedAppControlPolicyGetReq', 'CloudHostedAppControlPolicyUpdateReq', 'CloudHostedAppControlPolicy',
  'CloudHostedAppControlPolicyGetResponse', 'CloudHostedAppControlPolicyMutationResponse',
  'CloudControlGrantGetReq', 'CloudControlGrantTargetRevision', 'CloudControlGrantSetReq',
  'CloudControlGrantTargetInfo', 'CloudControlGrantInfo', 'CloudControlGrantMutation',
  'CloudControlGrantGetResponse', 'CloudControlGrantSetResponse',
];

export const retiredControlLabels = [
  'cloud-hosted-app-control/v1', 'cloud-control-app/v1', 'app_control_ceiling',
];

/** Reject stale inputs before they can recreate retired calls, DTOs or compatibility labels. */
export function assertNoRetiredControls(input, source) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  for (const name of [...retiredControlOperations, ...retiredControlSchemas, ...retiredControlLabels, '/uns/controls/', '/openapi/v1/controls/']) {
    if (text.includes(name)) throw new Error(`Retired Controls contract ${name} in ${source}; sync the current Backend contract.`);
  }
  // Historical revision components and opaque ledger IDs are separate from
  // the retired public SDK and response-version labels.
  if (/(?<![\w/-])control\/v1(?![\w/-])/.test(text)) {
    throw new Error(`Retired Controls contract control/v1 in ${source}; sync the current Backend contract.`);
  }
  let contract = input;
  if (typeof input === 'string') {
    try { contract = JSON.parse(input); } catch { return; }
  }
  if (!contract || typeof contract !== 'object') return;
  for (const op of contract.operations ?? []) {
    if (['streamRequestGrantGet', 'streamRequestGrantSet', 'appStreamAccessList'].includes(op.name) && op.resource === 'control') {
      throw new Error(`Retired Controls contract resource metadata in ${source}; sync the current Backend contract.`);
    }
  }
  for (const schemas of [contract.schemas, contract.components?.schemas]) {
    for (const name of ['CloudStreamRunsListResponse', 'DocUnsV2StreamRunsListResponse']) {
      const run = schemas?.[name];
      if (run?.properties?.data?.properties?.items?.items?.properties?.kind?.enum?.includes('control')) {
        throw new Error(`Retired Controls contract run kind in ${source}; sync the current Backend contract.`);
      }
    }
  }
}
