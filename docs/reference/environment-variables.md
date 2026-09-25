# Environment Variables

This page lists the environment variables used by the module, CLI, and runtime utilities.

## Development Tenant

These are required for auto-bootstrap and the CLI commands that operate on your development tenant.

| Variable                   | Description                                                       |
| -------------------------- | ----------------------------------------------------------------- |
| `C8Y_BASEURL`              | Cumulocity base URL, for example `https://example.cumulocity.com` |
| `C8Y_DEVELOPMENT_TENANT`   | Development tenant ID                                             |
| `C8Y_DEVELOPMENT_USER`     | Development user name                                             |
| `C8Y_DEVELOPMENT_PASSWORD` | Development user password                                         |

### `C8Y_NITRO_`-Prefixed Variants {#c8y-nitro-prefixed-variants}

Each development tenant variable also accepts a `C8Y_NITRO_`-prefixed variant that takes precedence over the unprefixed name:

| Unprefixed                 | Prefixed Variant                 |
| -------------------------- | -------------------------------- |
| `C8Y_BASEURL`              | `C8Y_NITRO_BASEURL`              |
| `C8Y_DEVELOPMENT_TENANT`   | `C8Y_NITRO_DEVELOPMENT_TENANT`   |
| `C8Y_DEVELOPMENT_USER`     | `C8Y_NITRO_DEVELOPMENT_USER`     |
| `C8Y_DEVELOPMENT_PASSWORD` | `C8Y_NITRO_DEVELOPMENT_PASSWORD` |

Use the prefixed names when a shared env file (for example at a monorepo root, see [`envFile`](./module-options#envfile)) also serves other tools that read generic `C8Y_*` variables - the prefixed values are unambiguously for c8y-nitro and win when both are set.

## Bootstrap Credentials

These are written by auto-bootstrap or by the `bootstrap` CLI command.

| Variable                 | Description                                   |
| ------------------------ | --------------------------------------------- |
| `C8Y_BOOTSTRAP_TENANT`   | Tenant ID for the microservice bootstrap user |
| `C8Y_BOOTSTRAP_USER`     | Bootstrap user name                           |
| `C8Y_BOOTSTRAP_PASSWORD` | Bootstrap user password                       |

Runtime client and credential utilities rely on these values to access subscribed tenant credentials.

## Runtime Config Overrides

Nitro runtime config values can be overridden through environment variables.

| Variable                               | Description                                   |
| -------------------------------------- | --------------------------------------------- |
| `NITRO_C8Y_CREDENTIALS_CACHE_TTL`      | Overrides `c8y.cache.credentialsTTL`          |
| `NITRO_C8Y_DEFAULT_TENANT_OPTIONS_TTL` | Overrides `c8y.cache.defaultTenantOptionsTTL` |

Values are in seconds.

## Where They Are Loaded

Both dev mode and the CLI load env files in this order (later wins): files configured via [`c8y.envFile`](./module-options#envfile), then the project's own `.env`, then `.env.local`. Real environment variables always win over file values, and `C8Y_NITRO_`-prefixed variants win over their unprefixed counterparts.

The CLI loads project config and env files before validating required variables. During development, auto-bootstrap writes generated bootstrap credentials back into the project's own env file (never into a shared `envFile` entry) and also updates `process.env` so the current process can continue immediately.