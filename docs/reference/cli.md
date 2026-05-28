# CLI Commands

`c8y-nitro` ships a CLI for bootstrap and development-tenant management.

## Available Commands

| Command     | Description                                                           |
| ----------- | --------------------------------------------------------------------- |
| `bootstrap` | Manually register the microservice and retrieve bootstrap credentials |
| `roles`     | Manage development user roles                                         |
| `options`   | Manage tenant options on the development tenant                       |

Show help with:

```sh
pnpm dlx c8y-nitro -h
```

All commands are aimed at the development workflow, not at replacing your production deployment pipeline.

## Bootstrap

Use the bootstrap command when you want explicit control over registration instead of relying on automatic development bootstrap.

```sh
pnpm dlx c8y-nitro bootstrap
```

## Roles

Manage custom manifest roles assigned to your development user.

```sh
pnpm dlx c8y-nitro roles
```

## Options

Manage tenant options on the configured development tenant.

```sh
pnpm dlx c8y-nitro options
```