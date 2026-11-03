/**
 * Internal preparation for a future authenticated server identity contract.
 * No verifier is configured by createDataClient; provider mode remains blocked.
 */
export class DataPrincipalError extends Error {
  readonly code = 'DATA_PRINCIPAL_UNCONFIRMED';
  readonly execution?: 'unknown';
  readonly outcomeUnknown?: true;
  readonly idempotencyKey?: string;
  readonly retry = { safe: false } as const;
  constructor(priorUnknown?: { idempotencyKey: string }) {
    super('Tier0 SDK: the data principal could not be confirmed.');
    this.name = 'DataPrincipalError';
    this.execution = priorUnknown ? 'unknown' : undefined;
    this.outcomeUnknown = priorUnknown ? true : undefined;
    this.idempotencyKey = priorUnknown?.idempotencyKey;
  }
}

/** Opaque identifiers supplied by an SDK-controlled, authenticated verifier. */
export interface VerifiedDataPrincipal {
  authority: string;
  workspace: string;
  credentialPrincipal: string;
  effectivePrincipal: string;
  idempotencyScope: string;
}

/**
 * A future adapter must bind its result to this exact credential, endpoint and
 * employee assertion, and must not return an unverified provider claim.
 */
export type PrincipalVerifier = (input: {
  credential: string;
  endpoint: string;
  dataSubject?: string;
  signal: AbortSignal;
}) => Promise<VerifiedDataPrincipal>;

const fields = ['authority', 'workspace', 'credentialPrincipal', 'effectivePrincipal', 'idempotencyScope'] as const;
function valid(value: VerifiedDataPrincipal): boolean {
  return value != null && fields.every(field => typeof value[field] === 'string' &&
    value[field].length > 0 && value[field].length <= 1024 && value[field].trim() === value[field]);
}

/** A client is pinned to one server-confirmed credential principal for its lifetime. */
export class DataPrincipalFence {
  private base?: Pick<VerifiedDataPrincipal, 'authority' | 'workspace' | 'credentialPrincipal'> & { endpoint: string };
  private failed = false;

  constructor(private readonly verify: PrincipalVerifier) {}

  /** One operation owns its effective principal and idempotency scope across attempts. */
  operation() {
    let effective: Pick<VerifiedDataPrincipal, 'effectivePrincipal' | 'idempotencyScope'> | undefined;
    let failed = false;
    const assertCurrent = () => {
      if (this.failed || failed) throw new DataPrincipalError();
    };
    const failOperation = (): never => { failed = true; throw new DataPrincipalError(); };
    return {
      assertCurrent,
      prepare: async (input: { credential: string; endpoint: string; dataSubject?: string; signal: AbortSignal }) => {
        assertCurrent();
        const attempt = Object.freeze({ credential: input.credential, endpoint: input.endpoint,
          dataSubject: input.dataSubject, signal: input.signal });
        if (attempt.signal.aborted || !attempt.credential || !attempt.endpoint) return failOperation();
        let proof: VerifiedDataPrincipal;
        try {
          proof = await new Promise<VerifiedDataPrincipal>((resolve, reject) => {
            const abort = () => { attempt.signal.removeEventListener('abort', abort); reject(new DataPrincipalError()); };
            attempt.signal.addEventListener('abort', abort, { once: true });
            if (attempt.signal.aborted) return abort();
            Promise.resolve().then(() => {
              if (attempt.signal.aborted) throw new DataPrincipalError();
              return this.verify(attempt);
            }).then(resolve, reject).finally(() => attempt.signal.removeEventListener('abort', abort));
          });
        } catch { return failOperation(); }
        assertCurrent();
        let identity: VerifiedDataPrincipal;
        try {
          identity = { authority: proof.authority, workspace: proof.workspace, credentialPrincipal: proof.credentialPrincipal,
            effectivePrincipal: proof.effectivePrincipal, idempotencyScope: proof.idempotencyScope };
          if (attempt.signal.aborted || !valid(identity)) return failOperation();
        } catch { return failOperation(); }
        const base = { authority: identity.authority, workspace: identity.workspace,
          credentialPrincipal: identity.credentialPrincipal, endpoint: attempt.endpoint };
        if (this.base && (this.base.authority !== base.authority || this.base.workspace !== base.workspace ||
          this.base.credentialPrincipal !== base.credentialPrincipal || this.base.endpoint !== base.endpoint)) {
          this.failed = true;
          throw new DataPrincipalError();
        }
        const current = { effectivePrincipal: identity.effectivePrincipal, idempotencyScope: identity.idempotencyScope };
        if (effective && (effective.effectivePrincipal !== current.effectivePrincipal || effective.idempotencyScope !== current.idempotencyScope)) {
          failed = true;
          throw new DataPrincipalError();
        }
        this.base ??= base;
        effective ??= current;
        // This object is attempt-local. The fence stores no credential or assertion.
        return Object.freeze({ credential: attempt.credential, endpoint: attempt.endpoint, dataSubject: attempt.dataSubject,
          signal: attempt.signal, assertCurrent: () => {
            assertCurrent();
            if (attempt.signal.aborted) return failOperation();
          } });
      },
    };
  }
}
