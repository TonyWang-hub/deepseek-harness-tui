/**
 * Package-local narrow structural types over Host services this package
 * touches at runtime without importing their declaring package's Cordis
 * `Context` merge. Importing `@deepseek-ai/dsh-client-connection`'s package
 * root (its Host half) would pull that half's `declare module '@deepseek-ai/cordis'`
 * augmentation into this package's TypeScript program — a client-aggregate
 * program (`tsconfig.client.json`) that must never see a Host-half merge (two
 * Host and Client compositions merge `Context` under the same keys with
 * different services; a program that saw both would poison itself). This
 * package instead reads `ctx.get('connection')` and narrows the untyped
 * result against the structural shape declared here, which is exactly the
 * one method this package calls.
 */

/**
 * The one Host `connection` service member this package calls. Structurally
 * compatible with `HostConnectionHandle` from `@deepseek-ai/dsh-client-connection`
 * (`packages/client/connection/src/rpc.ts`) without importing it.
 */
export interface HostConnectionLike {
  /**
   * Compose the Host's `/api` surface as a same-process fetch-shaped handler.
   * See `HostConnectionHandle.inProcessHandler` for the full trust-fence
   * exemption rationale this package relies on unchanged.
   * @returns fetch-shaped handler; answers 404 while no ApiProxy is composed yet.
   */
  inProcessHandler(): { fetch: typeof fetch }
}
