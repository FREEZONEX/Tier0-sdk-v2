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

/** Reject stale inputs before they can recreate retired calls, DTOs or compatibility labels. */
export function assertNoRetiredControls(input, source) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  for (const name of [...retiredControlOperations, ...retiredControlSchemas, '/uns/controls/', '/openapi/v1/controls/']) {
    if (text.includes(name)) throw new Error(`Retired Controls contract ${name} in ${source}; sync the current Backend contract.`);
  }
  // This exact SDK label is retired. A policy version such as
  // cloud-hosted-app-control/v1 is a different, still-current wire value.
  if (/(?<![\w/-])control\/v1(?![\w/-])/.test(text)) {
    throw new Error(`Retired Controls contract control/v1 in ${source}; sync the current Backend contract.`);
  }
}
