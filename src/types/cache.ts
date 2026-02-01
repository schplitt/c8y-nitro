export interface C8yCacheOptions {
  /**
   * Cache TTL for subscribed tenant credentials in seconds.
   * @default 600 (10 minutes)
   */
  credentialsTTL?: number
}
