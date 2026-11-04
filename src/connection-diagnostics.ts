/** Static advice only: never include credentials, response bodies or configured URLs. */
export function invalidResponseHint(status: number): string {
  if (status === 404 || status === 405) {
    return 'Check apiHost / TIER0_API_HOST: use this environment\'s OpenAPI gateway base URL, not its platform webpage or MCP URL. Confirm that the gateway exposes /openapi/v2 routes; obtain the address from the environment deployment guide or administrator.';
  }
  if (status === 401) {
    return 'Check that apiHost / TIER0_API_HOST targets the intended OpenAPI gateway, then check that the API key is present, valid and belongs to that environment. An intermediary may also require authentication.';
  }
  if (status === 403) {
    return 'Check the credential\'s permissions for this operation and any gateway access restrictions. A non-JSON response alone does not prove the API key is invalid.';
  }
  if (status === 502 || status === 503 || status === 504) {
    return 'The gateway or upstream service may be temporarily unavailable. Check service health; do not replace the API key based on this response. Before repeating a write, check whether it committed.';
  }
  return 'Check apiHost / TIER0_API_HOST and the gateway response format against the environment deployment guide; OpenAPI JSON responses are required.';
}
