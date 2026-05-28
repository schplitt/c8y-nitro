# Module Options

This page maps the public `c8y` configuration surface from code to practical meaning.

## Shape

```ts
interface C8yNitroModuleOptions {
  dev?: C8yDevOptions
  manifest?: C8YManifestOptions
  apiClient?: C8YAPIClientOptions
  zip?: C8YZipOptions
  cache?: C8yCacheOptions
  enableTenantOptionsInvalidationRoute?: boolean
  skipBootstrap?: boolean
}
```

## `dev`

```ts
dev?: {
  injectUser?: boolean
}
```

Controls development-only helpers.

- `injectUser`: injects the configured development user into incoming requests during Nitro dev mode. Defaults to `true`.

## `manifest`

Controls the generated `cumulocity.json`.

Common fields you are likely to set first:

- `contextPath`
- `requiredRoles`
- `roles`
- `settings`
- `settingsCategory`
- `resources`
- `requestedResources`
- `livenessProbe`
- `readinessProbe`

Fields such as `name`, `version`, `apiVersion`, `type`, and provider metadata are generated or inferred and are not part of `C8YManifestOptions`.

## `apiClient`

```ts
apiClient?: {
  dir: string
  contextPath?: string
}
```

- `dir`: required output directory for the generated Angular client.
- `contextPath`: optional override for the service endpoint path.

## `zip`

```ts
zip?: {
  name?: string | ((packageName: string, version: string) => string)
  outputDir?: string
  manifest?: C8YManifestOptions
}
```

Use this when the build artifact itself needs different naming or placement.

## `cache`

```ts
cache?: {
  credentialsTTL?: number
  defaultTenantOptionsTTL?: number
  tenantOptions?: Record<string, number>
}
```

- `credentialsTTL`: TTL for subscribed tenant credentials.
- `defaultTenantOptionsTTL`: base TTL for tenant options.
- `tenantOptions`: per-key tenant option TTL overrides.

## `enableTenantOptionsInvalidationRoute`

When set to `true`, exposes `GET /_c8y_nitro/invalidate-tenant-options` for cache invalidation debugging.

Supported query params:

- `key`: invalidates one created tenant option cache
- `all`: invalidates all created tenant option caches and takes priority over `key`

## `skipBootstrap`

When set to `true`, disables automatic development bootstrap entirely.