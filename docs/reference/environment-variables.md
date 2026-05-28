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

The CLI loads project config and env files before validating required variables. During development, auto-bootstrap writes generated bootstrap credentials back into the env file and also updates `process.env` so the current process can continue immediately.