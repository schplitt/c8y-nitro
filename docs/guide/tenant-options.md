# Tenant Options

Tenant options are runtime settings for your microservice. They are a good fit for values that differ between tenants or should be changed without rebuilding the service.

## Define Options in the Manifest

Add settings to `c8y.manifest.settings`:

```ts
export default defineNitroConfig({
  c8y: {
    manifest: {
      settingsCategory: 'my-service',
      requiredRoles: ['ROLE_OPTION_MANAGEMENT_READ'],
      settings: [
        { key: 'featureMode', defaultValue: 'standard', editable: true },
        { key: 'credentials.apiKey', defaultValue: 'change-me' },
      ],
    },
  },
  modules: [c8y()],
})
```

Each setting must have a non-empty `defaultValue`. Empty defaults are rejected while generating the manifest so bad settings fail early.

## Read Options at Runtime

```ts
import { useTenantOption } from 'c8y-nitro/utils'

const featureMode = await useTenantOption('featureMode')
const apiKey = await useTenantOption('credentials.apiKey')
```

Keys defined in the manifest are generated into the `C8YTenantOptionKey` type, so TypeScript can help you avoid typos after Nitro prepares its generated types.

## Category Resolution

The option category is resolved in this order:

1. `manifest.settingsCategory`
2. generated manifest `contextPath`
3. generated manifest `name`

Use an explicit `settingsCategory` when you want stable option storage independent from package naming or context-path changes.

## Missing Options

If Cumulocity returns 404 for an option, `useTenantOption()` returns `undefined`. Other errors, such as missing permissions, are thrown.

## Encrypted Options

Keys prefixed with `credentials.` are stored encrypted by Cumulocity. Use this for secrets that tenants configure through platform options.

## Cache Control

Tenant options are cached for 10 minutes by default. You can tune the default or override individual keys:

```ts
export default defineNitroConfig({
  c8y: {
    cache: {
      defaultTenantOptionsTTL: 600,
      tenantOptions: {
        'featureMode': 60,
        'credentials.apiKey': 300,
      },
    },
  },
  modules: [c8y()],
})
```

You can also manage already-created caches at runtime:

```ts
await useTenantOption.invalidate('featureMode')
const fresh = await useTenantOption.refresh('featureMode')
await useTenantOption.invalidateAll()
const values = await useTenantOption.refreshAll()
```

`invalidateAll()` and `refreshAll()` only operate on keys that have already been accessed in the current process.

## Debug Invalidation Route

Set `enableTenantOptionsInvalidationRoute: true` to expose:

```txt
GET /_c8y_nitro/invalidate-tenant-options?key=featureMode
GET /_c8y_nitro/invalidate-tenant-options?all=true
```

This is meant for debugging and operational troubleshooting. Keep it disabled unless you have a clear reason to expose it.