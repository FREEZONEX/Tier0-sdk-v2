const retired = [
  'streamRuntimeCapabilitiesGet',
  'CloudStreamRuntimeCapabilitiesGetReq',
  'CloudStreamRuntimeCapabilitiesGetResponse',
  '/uns/streams/runtime/capabilities/get',
];

/** Reject stale contract inputs before they can recreate the retired public probe. */
export function assertNoRetiredStreamProbe(input, source) {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  for (const name of retired) {
    if (text.includes(name)) throw new Error(`Retired Stream probe ${name} in ${source}; sync a current Backend contract.`);
  }
}
