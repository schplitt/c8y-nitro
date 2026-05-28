# Cache Configuration

`c8y-nitro` caches the two platform-backed lookups that are easy to overuse in real services: subscribed tenant credentials and tenant options.

The default TTL for both is 10 minutes.

## Configuration

```ts
export default defineNitroConfig({
  c8y: {
    enableTenantOptionsInvalidationRoute: false,
    cache: {
      credentialsTTL: 300, // Cache credentials for 5 minutes (in seconds)
      defaultTenantOptionsTTL: 600, // Default cache for tenant options (in seconds)
      tenantOptions: {
        'myOption': 300, // Per-key override: 5 minutes
        'credentials.secret': 60, // Per-key override: 1 minute
      },
    }
  },
  modules: [c8y()],
})
```

## When To Tune It

Lower the TTL when tenant options or subscription changes must be reflected quickly.

Raise the TTL when:

- the values are stable,
- startup cost is not the concern but repeated remote lookups are,
- or you want to reduce platform calls in multi-tenant traffic.

## Environment Variable Overrides

You can also override these at runtime using environment variables:

```sh
NITRO_C8Y_CREDENTIALS_CACHE_TTL=300
NITRO_C8Y_DEFAULT_TENANT_OPTIONS_TTL=300
```

> **Note**: The credentials cache is used by `useSubscribedTenantCredentials()` and `useDeployedTenantCredentials()` utilities. Both share the same cache.
