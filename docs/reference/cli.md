# CLI Commands

`c8y-nitro` ships a CLI for bootstrap and development-tenant management.

## Available Commands

| Command     | Description                                                           |
| ----------- | --------------------------------------------------------------------- |
| `bootstrap` | Manually register the microservice and retrieve bootstrap credentials |
| `roles`     | Manage development user roles                                         |
| `options`   | Manage tenant options on the development tenant                       |
| `typegen`   | Generate the module's TypeScript declarations                         |

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

Before touching any options, the command syncs the microservice on the development tenant with your local manifest (the same check as [automatic bootstrap](/guide/auto-bootstrap)): a missing application is (re-)created, a changed placeholder manifest is updated, and missing or stale bootstrap credentials are refreshed in your env file.

Reads and writes then use different users:

- **Reads** use the **bootstrap user**. Encrypted `credentials.*` options are only returned decrypted to the microservice's own user — the development user gets `<<Encrypted>>` back.
- **Writes and deletes** use the **development user** (the bootstrap user is not allowed to modify tenant options).

When no bootstrap credentials are available (e.g. the sync failed and none are in your env file), reads fall back to the development user and `credentials.*` values stay encrypted.

## Typegen

Generate the module's TypeScript declarations without running a full build.

```sh
pnpm dlx c8y-nitro typegen
```

The declarations are written to `node_modules/.c8y-nitro/types.d.ts` and contain the
manifest-derived role names, tenant option keys, and settings category, plus the
declaration for the [`c8y-nitro/runtime`](/reference/runtime-module) virtual module.

`nitro dev` and `nitro build` write the same file, so you only need this command when
type checking a checkout that has not been built yet — for example
`pnpm install && pnpm dlx c8y-nitro typegen && tsc --noEmit` in CI.

::: tip
This replaces `nitro prepare`, which Nitro removed together with its type generation.
:::
