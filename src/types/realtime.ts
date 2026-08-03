import type { ConsumerResilienceOptions, SubscriptionApi } from 'c8y-realtime'

/**
 * Options for the Notification 2.0 realtime clients (backed by `c8y-realtime`).
 *
 * Resolved once at build time into runtime config and spread **identically**
 * into every per-tenant `RealtimeClient` the pool creates — so all subscribed
 * tenants behave consistently in a multi-tenant deployment. Only the
 * credentials differ per tenant.
 */
export interface C8yRealtimeOptions {
  /**
   * Base name for this app's realtime topics/consumers (must be alphanumeric).
   *
   * Leave unset to derive it deterministically from the microservice
   * `contextPath` (a short hash is appended so distinct services never collide
   * on one platform topic). The derived name is **stable** across restarts and
   * redeploys, so a reconnecting service resumes the same persistent
   * subscription and its backlog. Set this only if you need to pin the name
   * explicitly; it is a permanent identity — changing it later orphans the old
   * subscriptions.
   */
  name?: string
  /**
   * Delete **every** remote subscription this service created when Nitro shuts
   * down. Keep `false` so persistent backlogs survive a redeploy.
   * @default false
   */
  deleteSubscriptionsOnClose?: boolean
  /**
   * Delete a `(type, device)` remote subscription once its last handler is
   * removed. This is the only path that deletes a remote subscription — tenant
   * churn never does.
   * @default true
   */
  deleteSubscriptionOnEmpty?: boolean
  /**
   * Acknowledge each notification after its handlers resolve.
   * @default true
   */
  autoAck?: boolean
  /**
   * Drop duplicate notifications redelivered on the same stream (e.g. on
   * reconnect).
   * @default true
   */
  dedupe?: boolean
  /**
   * Open the connection automatically as handlers are registered. Set `false`
   * to connect manually via the client's `start()`.
   * @default true
   */
  autoStart?: boolean
  /**
   * Subscription delivery mode applied to every tenant's client.
   */
  subscription?: {
    /**
     * APIs for the `onAny` firehose topic. Typed topics always use their own
     * type. Defaults to `['*']`.
     */
    apis?: SubscriptionApi[]
    /**
     * Target a non-persistent topic (no server-side backlog; cheaper, but a
     * disconnect loses messages). Defaults to `false`.
     */
    nonPersistent?: boolean
  }
  /**
   * Reconnect/backoff behaviour, applied identically to every tenant's client.
   */
  resilience?: ConsumerResilienceOptions
}
