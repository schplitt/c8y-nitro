import { createError as _createError } from 'evlog'

export { useLogger } from 'evlog/nitro/v3'
export { createLogger } from 'evlog'

/**
 * Create a structured error for a Cumulocity microservice. Always prefer this
 * over Nitro/h3's built-in `createError`: the returned error is captured in the
 * wide log event **and** serialized into the JSON response under a `data` key.
 *
 * ## What the caller sees vs what stays on the server
 *
 * Every field **except `internal`** is sent to the client in the HTTP response.
 * `internal` is stripped from the response and only ever appears in your logs.
 *
 * | Field      | Sent to client? | Purpose                                                       |
 * | ---------- | :-------------: | ------------------------------------------------------------- |
 * | `message`  |       yes       | Short, safe summary of what went wrong.                       |
 * | `status`   |       yes       | HTTP status code (default `500`).                             |
 * | `code`     |       yes       | Stable machine-readable id (e.g. `'PAYMENT_DECLINED'`).       |
 * | `why`      |       yes       | Human-readable cause — safe to expose, no secrets.            |
 * | `fix`      |       yes       | What the caller can do about it.                              |
 * | `link`     |       yes       | Docs URL with more detail.                                    |
 * | `cause`    |  no (logged)    | The original `Error` you caught.                              |
 * | `internal` |  no (logged)    | Backend-only diagnostics — never reaches the client.          |
 *
 * ## Do NOT leak internal system errors
 *
 * Put anything sensitive or diagnostic (raw Cumulocity core responses, DB
 * errors, tokens, tenant internals) in `internal`, **not** in `message`/`why`.
 * `internal` is logged for debugging but never serialized to the response.
 *
 * @example
 * // User-facing error — every field here is visible to the caller:
 * throw createError({
 *   code: 'PAYMENT_DECLINED',
 *   message: 'Payment failed',
 *   status: 402,
 *   why: 'Card declined by issuer',
 *   fix: 'Try a different payment method',
 *   link: 'https://docs.example.com/payments/declined',
 * })
 *
 * @example
 * // Wrapping an upstream failure — keep the raw payload server-side only:
 * catch (cause) {
 *   throw createError({
 *     status: 502,
 *     message: 'Upstream request failed', // safe, generic — what the caller sees
 *     cause: cause as Error,
 *     internal: { upstreamStatus: cause?.res?.status, upstreamBody: cause?.data },
 *   })
 * }
 *
 * @see https://www.evlog.dev
 */
export const createError = _createError
