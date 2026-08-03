# Module Options

This page maps the public `c8y` configuration surface from code to practical meaning.

## Shape

```ts
interface C8yNitroModuleOptions {
  dev?: C8yDevOptions
  manifest?: C8YManifestOptions
  apiClient?: C8YAPIClientOptions
  zip?: C8YZipOptions
  docker?: C8yDockerOptions
  cache?: C8yCacheOptions
  realtime?: C8yRealtimeOptions
  openapi?: C8yOpenAPIOptions
  enableTenantOptionsInvalidationRoute?: boolean
  skipBootstrap?: boolean
}
```

## `dev`

```json
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

```json
apiClient?: {
  dir: string
  contextPath?: string
}
```

- `dir`: required output directory for the generated Angular client.
- `contextPath`: optional override for the service endpoint path.

## `zip`

```json
zip?: {
  name?: string | ((packageName: string, version: string) => string)
  outputDir?: string
  manifest?: C8YManifestOptions
}
```

Use this when the build artifact itself needs different naming or placement.

## `docker`

```json
docker?: {
  baseImage?: string
  extraInstructions?: string[]
}
```

Customizes the Dockerfile generated for the microservice image.

- `baseImage`: replaces the default `node:24-slim` base image.
- `extraInstructions`: raw Dockerfile instructions (one per entry) inserted after `WORKDIR` and before the build output `COPY`, so their layers stay cached across rebuilds.

The rest of the template is not configurable: `ENV NODE_ENV`/`PORT`, `EXPOSE 80` and the `CMD` entrypoint are the Cumulocity microservice contract and stay under module control.

A common use case is installing CA certificates or native runtime libraries the slim image does not ship:

```ts
export default defineNitroConfig({
  c8y: {
    docker: {
      extraInstructions: [
        'RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*',
      ],
    },
  },
})
```

Note that `apt-get` assumes a Debian-based `baseImage` (the default is); adjust the instructions if you switch to a different distribution.

## `cache`

```json
cache?: {
  credentialsTTL?: number
  defaultTenantOptionsTTL?: number
  tenantOptions?: Record<string, number>
}
```

- `credentialsTTL`: TTL for subscribed tenant credentials.
- `defaultTenantOptionsTTL`: base TTL for tenant options.
- `tenantOptions`: per-key tenant option TTL overrides.

## `openapi`

```json
openapi?: {
  excludeInternalRoutes?: boolean
  excludeRoutes?: string[]
}
```

Controls how the OpenAPI document served by Nitro is transformed. See the [OpenAPI guide](/guide/openapi) for details.

- `excludeInternalRoutes`: strips routes starting with `/_` and probe paths from the document. Defaults to `true`.
- `excludeRoutes`: additional path prefixes to strip.

## `realtime`

```json
realtime?: {
  name?: string
  deleteSubscriptionsOnClose?: boolean
  deleteSubscriptionOnEmpty?: boolean
  autoAck?: boolean
  dedupe?: boolean
  autoStart?: boolean
  subscription?: { apis?: string[], nonPersistent?: boolean }
  resilience?: ConsumerResilienceOptions
}
```

Options for the Notification 2.0 realtime clients (backed by `c8y-realtime`), applied identically to every subscribed tenant's pooled client. See the [Realtime guide](/guide/realtime).

- `name`: base name for this app's realtime topics/consumers (alphanumeric). Derived from the microservice `contextPath` if unset — stable across restarts and unique per service. It is a permanent identity; changing it orphans existing subscriptions.
- `deleteSubscriptionsOnClose`: delete every remote subscription this service created on shutdown. Defaults to `false` so persistent backlogs survive a redeploy.
- `deleteSubscriptionOnEmpty`: delete a `(type, device)` remote subscription once its last handler is removed. Defaults to `true`. This is the only path that deletes a remote subscription — tenant churn never does.
- `autoAck`: acknowledge each notification after its handlers resolve. Defaults to `true`.
- `dedupe`: drop duplicate notifications redelivered on the same stream. Defaults to `true`.
- `autoStart`: connect automatically as handlers are registered. Defaults to `true`.
- `subscription`: delivery mode — `apis` for the `onAny` firehose topic, and `nonPersistent` (no server-side backlog; cheaper but a disconnect loses messages).
- `resilience`: reconnect/backoff behaviour.

## `enableTenantOptionsInvalidationRoute`

When set to `true`, exposes `GET /_c8y_nitro/invalidate-tenant-options` for cache invalidation debugging.

Supported query params:

- `key`: invalidates one created tenant option cache
- `all`: invalidates all created tenant option caches and takes priority over `key`

## `skipBootstrap`

When set to `true`, disables automatic development bootstrap entirely.