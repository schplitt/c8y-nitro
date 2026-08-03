import type { ICredentials, IMicroserviceClientRequestHeaders } from '@c8y/client'

/**
 * Whether two sets of tenant credentials are equivalent for the purposes of
 * change detection: same tenant, user, and password. Used to detect a
 * service-user password rotation (which keeps the tenant id but changes the
 * secret), not just tenants entering/leaving the subscription set.
 * @param a - First credentials, or `undefined` when the tenant is absent
 * @param b - Second credentials, or `undefined` when the tenant is absent
 */
export function credsEqual(a?: ICredentials, b?: ICredentials): boolean {
  if (!a || !b) {
    return a === b
  }
  return a.tenant === b.tenant && a.user === b.user && a.password === b.password
}

/**
 * Converts undici Request headers to the format expected by MicroserviceClientRequestAuth.\
 * Extracts the following headers from the request:
 * - `authorization`: Used for Basic Auth or Bearer token authentication
 * - `cookie`: Used to extract XSRF-TOKEN and authorization token from cookies
 *
 * The MicroserviceClientRequestAuth class will automatically:
 * - Extract XSRF-TOKEN from cookies for CSRF protection
 * - Extract authorization token from cookies (prioritized over header auth)
 * - Fall back to Authorization header if no cookie-based auth is present
 *
 * @param request - The HTTP request containing headers
 * @returns Headers object compatible with \@c8y/client's MicroserviceClientRequestAuth
 */
export function convertRequestHeadersToC8yFormat(request: Request): IMicroserviceClientRequestHeaders {
  const headers: IMicroserviceClientRequestHeaders = {}

  // Extract Authorization header (Basic or Bearer)
  const authorization = request.headers.get('authorization')
  if (authorization) {
    headers.authorization = authorization
  }

  // Extract cookies (contains XSRF-TOKEN and authorization cookie)
  const cookie = request.headers.get('cookie')
  if (cookie) {
    headers.cookie = cookie
  }

  return headers
}
