# OpenAPI

Nitro can generate and serve an OpenAPI document for your routes. `c8y-nitro` builds on that and transforms the served document so it makes sense for a deployed Cumulocity microservice.

## Enabling OpenAPI

Enable Nitro's OpenAPI support in your `nitro.config.ts`:

```ts
export default defineNitroConfig({
  experimental: {
    openAPI: true,
  },
  openAPI: {
    // serve the document at runtime in production builds
    production: true,
  },
  modules: [c8y()],
})
```

With this in place, Nitro serves the document at `/_openapi.json` together with the Scalar (`/_scalar`) and Swagger (`/_swagger`) UIs. When OpenAPI is enabled for production, the manifest generation also injects the spec route as `openApiSpec` into `cumulocity.json` automatically.

::: warning Prerendered documents cannot be transformed
`openAPI: { production: 'prerender' }` bakes the document into a static asset at build time. It is served before the transform middleware runs, so internal routes stay listed and the server URL points at the build machine. Use `production: true` instead; `c8y-nitro` warns about this at build time.
:::

## What Gets Transformed

Whenever OpenAPI is enabled, `c8y-nitro` registers a middleware that adjusts the served document per request:

### Internal Routes Are Stripped

By default the following paths are removed from the document:

- everything starting with `/_` — the generated probes under `/_c8y_nitro/**`, the tenant option invalidation route, and the OpenAPI/Scalar/Swagger routes themselves
- user-defined probe paths from `manifest.livenessProbe.httpGet.path` and `manifest.readinessProbe.httpGet.path`

You can extend or disable this via the [`openapi` module options](/reference/module-options#openapi):

```ts
export default defineNitroConfig({
  c8y: {
    openapi: {
      // additional path prefixes to hide
      excludeRoutes: ['/internal'],
      // set to false to keep internal routes listed
      excludeInternalRoutes: true,
    },
  },
  modules: [c8y()],
})
```

### The Server URL Is Rewritten

Out of the box, Nitro advertises the URL the service itself was reached at. For a deployed microservice that is an internal cluster address — not the URL users can actually call.

The middleware rewrites `servers` to the public endpoint of the requesting user's tenant:

```json
{
  "servers": [
    {
      "url": "https://tenant.example.com/service/my-service",
      "description": "Cumulocity microservice endpoint"
    }
  ]
}
```

The tenant domain is resolved through the requesting user's client via `/tenant/currentTenant` (see [`useUserTenantDomain()`](/reference/utilities#tenant)) and cached per tenant ID for 24 hours by default (configurable via [`cache.tenantDomainTTL`](/reference/module-options#cache)). Because the lookup uses the requesting user's credentials, subscribed tenants each see their own domain.

If the domain cannot be resolved (for example an unauthenticated request), the middleware falls back to deriving the URL from `X-Forwarded-Proto`/`X-Forwarded-Host` headers, and finally to the plain request origin.

In dev mode the request origin (your local server) is advertised directly, since the service is not reached through the platform proxy there.
