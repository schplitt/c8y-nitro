# Configuration

The module is configured through the `c8y` key in your Nitro config.

## Minimal Setup

```ts
import c8y from 'c8y-nitro'

export default defineNitroConfig({
  preset: 'node-server',
  modules: [c8y()],
  c8y: {},
})
```

That is enough to enable the default module behavior.

## A Realistic Setup

```ts
import c8y from 'c8y-nitro'

export default defineNitroConfig({
  preset: 'node-server',
  builder: 'rolldown',
  experimental: {
    asyncContext: true,
    tasks: true,
  },
  modules: [c8y()],
  c8y: {
    manifest: {
      contextPath: 'my-service',
      requiredRoles: ['ROLE_INVENTORY_READ', 'ROLE_OPTION_MANAGEMENT_READ'],
      roles: ['ROLE_MY_SERVICE_ADMIN'],
    },
    cache: {
      credentialsTTL: 600,
      defaultTenantOptionsTTL: 600,
    },
    apiClient: {
      dir: '../ui/src/app/services',
    },
  },
})
```

## Configuration Areas

### `manifest`

Controls the generated `cumulocity.json`, including context path, roles, probes, resources, settings, and scaling-related fields.

### `apiClient`

Enables Angular client generation from your Nitro routes.

### `zip`

Controls the generated artifact name, output directory, and manifest overrides used during packaging.

### `cache`

Controls TTL values for credentials and tenant options.

### `dev`

Controls development-only behavior such as automatic user injection.

### `skipBootstrap`

Disables the automatic development bootstrap flow.

### `enableTenantOptionsInvalidationRoute`

Adds a debug route that invalidates tenant option caches in development or troubleshooting scenarios.

## Practical Defaults

- Use a Node preset such as `node-server` or `node-cluster`.
- Prefer `builder: 'rolldown'` for faster builds.
- Enable `experimental.asyncContext` if you want to avoid threading the request through deep helper stacks.
- Enable `experimental.tasks` if you want to use the task scheduling utilities.

## Where To Go Next

- Read [Module Options](/reference/module-options) for the exact public configuration surface.
- Read [Manifest & Probes](/guide/manifest) if you are shaping deployment behavior.
- Read [Auto-Bootstrap](/guide/auto-bootstrap) if you are configuring development tenant onboarding.