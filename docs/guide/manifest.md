# Manifest Configuration

The `cumulocity.json` manifest is generated automatically from your package metadata and the `c8y.manifest` configuration.

This is where the deployment identity of your service lives: context path, roles, resources, settings, probes, and related platform behavior.

## Auto-generated Fields

The following fields are derived from your `package.json` automatically:

| Field                   | Source                                    |
| ----------------------- | ----------------------------------------- |
| `name` (scope stripped) | `package.json` `name`                     |
| `version`               | `package.json` `version`                  |
| `provider.name`         | `package.json` `author`                   |
| `provider.domain`       | `package.json` `author.url` or `homepage` |
| `provider.support`      | `package.json` `bugs` or `author.email`   |
| `contextPath`           | defaults to package name                  |

For all available manifest options, see the [Cumulocity Microservice Manifest documentation](https://cumulocity.com/docs/microservice-sdk/general-aspects/#microservice-manifest).

## Why This Matters Early

The manifest is not only a deployment artifact. It affects runtime assumptions too:

- the service context path used by generated clients,
- the roles available to middleware and user assignment,
- the tenant options keys that become part of the typed surface,
- and the probe endpoints used by orchestration.

## Custom Roles

Custom roles defined in the manifest are automatically available as TypeScript types for use in middleware and runtime code during development.

## Health Probes

Health probe endpoints (`/_c8y_nitro/liveness` and `/_c8y_nitro/readiness`) are automatically injected if not manually defined.

If you define your own `httpGet` probes, the module respects those instead of generating defaults.

## Tenant Options (Settings)

Define your microservice's settings in the manifest to get type-safe keys for `useTenantOption()`:

```ts
export default defineNitroConfig({
  c8y: {
    manifest: {
      settings: [
        { key: 'myOption', defaultValue: 'default' },
        { key: 'credentials.secret', defaultValue: 'change-me' }, // Encrypted option
      ],
      settingsCategory: 'my-service', // Optional, defaults to contextPath/name
    },
  },
  modules: [c8y()],
})
```

> **Important**: `manifest.settings[].defaultValue` is required and must be a non-empty string. `''` is rejected during manifest generation so invalid settings fail early during development/build.

> **Note on Encrypted Options**: Keys prefixed with `credentials.` are stored encrypted by Cumulocity. See more details [here](https://cumulocity.com/api/core/#operation/postOptionCollectionResource).

> **Auto-injected role**: When `settings` are defined, `ROLE_OPTION_MANAGEMENT_READ` is automatically added to `requiredRoles` so the microservice can read its own tenant options. You do not need to add it manually. If you have already added `ROLE_OPTION_MANAGEMENT_READ`, no duplicate is inserted.
>
> Only the read role is auto-added. To **write or delete** tenant options at runtime you must add `ROLE_OPTION_MANAGEMENT_ADMIN` to `requiredRoles` yourself.
