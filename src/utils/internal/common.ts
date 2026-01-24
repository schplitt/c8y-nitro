import type { IMicroserviceClientRequestHeaders } from '@c8y/client'

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
