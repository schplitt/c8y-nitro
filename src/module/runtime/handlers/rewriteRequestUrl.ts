import { c8yManifest } from 'c8y-nitro/runtime'
import { defineMiddleware } from 'nitro'
import { buildPublicRequestUrl, tryGetUserTenantDomainFast } from '../../../utils/internal/tenant'

/**
 * Rewrites the incoming request URL to the public tenant endpoint.
 *
 * When deployed, the platform proxy forwards requests with the internal
 * cluster host (e.g. `service-scope-t123.<cluster>.svc.cluster.local`) and the
 * `/service/<contextPath>` prefix stripped. Any handler that derives absolute
 * URLs from the request (`event.url`, `getRequestURL(event)`) therefore leaks
 * internal cluster URLs into responses. This middleware swaps `event.url` for
 * the public one (`https://<tenant domain>/service/<contextPath>/...`) before
 * route handlers run, so request-derived URLs come out publicly reachable.
 *
 * The tenant domain is resolved from the requesting user's credentials and
 * memoized in-process, so the per-request overhead after the first resolution
 * is a hash and a Map lookup. Unauthenticated requests (probes, preflights)
 * are passed through untouched.
 *
 * Registered after the scanned runtime middlewares (see registerRuntime) so
 * they still observe the original URL, and before the OpenAPI transform,
 * which reuses the tenant domain resolved here from its cache.
 */
export default defineMiddleware(async (event, next) => {
  if (import.meta.dev) {
    return next()
  }

  const domain = await tryGetUserTenantDomainFast(event)

  if (domain && event.url.host !== domain) {
    event.url = buildPublicRequestUrl(domain, c8yManifest.contextPath ?? c8yManifest.name, event.url)

    // Keep header-based resolution (getRequestURL with xForwardedHost etc.)
    // consistent with the rewritten URL. Best effort: some runtimes expose
    // immutable request headers.
    try {
      event.req.headers.set('x-forwarded-host', domain)
      event.req.headers.set('x-forwarded-proto', 'https')
    } catch {
      // Immutable headers: event.url is still rewritten, which is what
      // getRequestURL falls back to when no forwarding headers are present.
    }
  }

  return next()
})
