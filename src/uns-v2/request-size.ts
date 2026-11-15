/** Local refusal before transport; kept separate from errors returned by UNS. */
export class UnsV2RequestSizeError extends TypeError {
  constructor(readonly requestedBytes: number, readonly maxBodyBytes: number) {
    super(`Tier0 SDK: UNS v2 request body exceeds the ${maxBodyBytes}-byte contract limit.`);
  }
}
