import assert from 'node:assert/strict';

const coreCodes = new Set(['namespace.v2', 'source', 'stream']);
const requestCodes = new Set(['stream.requests.v1', 'stream.requests.invoke.v1']);
const requestVersionCase = /^(cloud|enterprise)-stream\.requests(?:\.invoke)?\.v1-versions-(empty|missing-sdk-contract|missing-api-contract|wrong-api-contract|wrong-sdk-contract|unadvertised-api)$/;
const requestDuplicateCase = /^(cloud|enterprise)-duplicate-known-stream\.requests(?:\.invoke)?\.v1$/;

// The shared schema's validity is unchanged. This SDK consumes only the core
// domains; request-domain validation belongs to the App interaction SDK.
export function dataCapabilityVector(vector) {
  const requestOnlyCase = requestVersionCase.test(vector.name) || requestDuplicateCase.test(vector.name);
  if (requestOnlyCase) {
    assert.equal(vector.valid, false, 'the original shared invalid vector must stay invalid');
    assert.ok(vector.response.capabilities.length > 0);
    assert.ok(vector.response.capabilities.every(item => requestCodes.has(item.code)),
      'a request-only exception must never hide malformed core capabilities');
  }
  const expected = vector.expectedCapabilities ?? vector.response.capabilities;
  return {
    consumerValid: vector.valid || requestOnlyCase,
    unconsumedRequestSemantics: requestOnlyCase,
    expected: {
      ...vector.response,
      capabilities: expected.filter(item => coreCodes.has(item.code)),
    },
  };
}
