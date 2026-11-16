# Migration

## 0.11.2 to 0.11.3

The fake tenant of `c8y-nitro/testing` now runs on [fake-c8y](https://github.com/schplitt/fake-c8y), which emulates much more of the platform: users and roles, applications, bulk operations, device registration, retention rules, audit records, statistics, availability, generated measurements, and cascading deletes. Every test now gets its own instance of your service by default (tests can share one with `c8y.startService()` in a `beforeAll`), and callers of `serverFetch({ as })` are users of the fake tenant whose roles the platform checks.

### Breaking changes in `c8y-nitro/testing`

- **A new service instance per test.** Before, the Nitro app ran for the whole file and c8y-nitro cleared its caches before every test. Now every test gets its own instance of your service by default: plugins run again before each test, on the data the test arranges, so startup work (realtime subscriptions, credential reads) sees that data. To test caching or other state that lives across requests, let tests share one with `beforeAll(() => c8y.startService())`, or set `c8yTest({ service: 'per-file' })`. See [Service Instances](/guide/testing#service-instances).
- **Callers must exist in the fake tenant.** `serverFetch(path, { as })` makes that one call as a user the fake tenant stores, and throws for any other. Seed your personas once: `c8y.seed({ users: [operator, visitor] })` (and custom roles they have that your manifest does not list: `c8y.seed({ roles: ['MY_ROLE'], users: [...] })`; a user with its own `tenant` is seeded in that tenant). `as` also accepts the user name. Because the caller is a stored user, the platform checks its roles: a caller that reads the inventory through `useUserClient()` needs `ROLE_INVENTORY_READ`, like on the platform. Seeded users also have the two `ROLE_USER_MANAGEMENT_OWN_*` roles every platform user gets. The default `user` keeps full access.
- **`as: null` is removed.** The platform's API gateway never forwards a request without valid credentials, so a service never sees a caller who is not logged in. Remove such tests.
- **An override that throws** answers 500 and fails the test as a request that failed inside the fake tenant. Return a `Response` with the status you want instead.
- **Arrange calls at file and `describe` level run before your own `beforeEach` hooks** (before, they ran in registration order with them).

### Other changes you may notice

- **IDs** have the platform's format (`47100001` instead of `1`). They are still the same in every test and every run. Do not assert on literal IDs: use the ref (`pump.id`).
- **Deleting a managed object** deletes its measurements, events, alarms, and operations too, like the platform.
- **Requests that used to fail with 501** (for example tenant statistics or user management) are now answered. Remove overrides you only added to answer them, or keep them: overrides still win.
- **Service users have your manifest's `requiredRoles`** (plus `ROLE_SYSTEM`, like on the platform). A platform request your service sends as a service user that needs a role the manifest does not list answers 403 `security/Forbidden` (before, service users had full access). Add the missing role to `requiredRoles` in your manifest. Realtime needs `ROLE_NOTIFICATION_2_ADMIN`: without it, the realtime client stops with a 403 in the log and no listener opens.
- **Settings defaults apply:** the `defaultValue`s of your manifest's `settings` are tenant options of your settings category, like after a deployment. Tests that expected an unset option should delete it with `c8y.tenantOptions.delete()`.
- **Users you seed** with `c8y.seed({ users })` are checked against their roles when your service calls the platform with their credentials. The default `user` keeps full access. `c8yTest({ roles: 'off' })` turns the checks off.
- **Notification 2.0:** subscriptions your service creates at startup stay connected for every test on that instance. Subscriptions created during a test are removed before the next test, and realtime clients created after startup are closed.
- **Unsupported requests** during the service's startup, or after a test ended (background work), fail the test with a message that says when they happened. Their 501 answer has the error code `fake-c8y/unsupported` (was `c8y-nitro/testing/unsupported`).
- **Fake timers no longer hold notifications back:** Notification 2.0 delivery and `c8y.notifications.settled()` run on the real timers, also after `vi.useFakeTimers()`, unless a setup file installs fake timers before `c8y-nitro/testing` is loaded.
- **`c8y.notifications.settled()` no longer waits up to 500 ms** for a just-created subscription to get a consumer. For a listener your service opens later, poll `c8y.notifications.consumers()` first. See [When to poll first](/guide/testing#when-to-poll-first).
- **A service whose startup does not finish** fails the test, instead of the test running on a half-started service. The start waits until the startup work that runs through the fake tenant is done (requests, realtime clients that are connecting) and fails if that work still runs 5 seconds after your plugins have finished.
- **`targetTenant`** is no longer read: a request works in the tenant of its credentials.
- **Override handlers' `query`** has the first value of a repeated query parameter (before: the last).
- **A new service instance** stops the `c8yTasks()` jobs of the old one (your plugins schedule theirs again), and emits its first `c8y:tenantCredentialsUpdated` from `null`, like a freshly started service.
- **Types:** the data and `c8y.db` types are re-exported from fake-c8y, and `c8y.db` is read-only. `C8yRequest` (in `c8y.calls`) no longer has `params` (it was always empty), and gains `id`, `status`, and `durationMs`. `C8yUnhandledRequest` gains `kind`. `C8yRequestContext` (override handlers) no longer extends `C8yRequest`: it has the request fields plus `callCount` and `next()`, and its `request` is a copy whose body you can still read. `C8yTestUser` is fake-c8y's `C8yUser` (it adds the optional `password` and `groups`; `password` has no effect in tests, as passwords are not checked), and `C8yTestState` extends fake-c8y's `C8yWorldState`. `C8yNotificationSubscription` is fake-c8y's `NotificationSubscription`. `C8yServerFetchInit['as']` is now `C8yCaller` (a user name or `{ userName, tenant? }`) and no longer accepts `null`.

### For contributors

The contract scenarios, the `test:contract` and `gen:testing-capabilities` scripts, and the platform behavior reference moved to fake-c8y.

## 0.10.x to 0.11.0

This release upgrades the Nitro peer dependency from `3.0.260903-beta` to the Nitro v3
release candidate `3.0.261102-rc`. `c8y-nitro` itself has no breaking API changes.

### Required changes

#### 1. Update Nitro

The peer dependency is pinned exactly, so Nitro must be bumped in lockstep:

```sh
pnpm add -D nitro@3.0.261102-rc
```

Nitro now requires Node.js `>=22.22.0`. `c8y-nitro` already requires Node.js 24, so
this does not affect you if you already meet that requirement.

#### 2. Add your builder

Nitro no longer installs a builder as its own dependency. Add the one you configure
(`builder: 'rolldown'` in the recommended setup) to your dev dependencies:

```sh
pnpm add -D rolldown
```

Without it, the first `nitro dev` or `nitro build` asks to install it, and in CI
installs it automatically. Either way, your `package.json` and lockfile change in the
middle of a build.

### Recommended changes

#### Use `defineConfig` from `nitro`

`defineNitroConfig` from `nitro/config` is deprecated. It still works, but switch to
`defineConfig`:

```ts [nitro.config.ts]
import c8y from 'c8y-nitro'
import { defineConfig } from 'nitro'

export default defineConfig({
  preset: 'node_server',
  modules: [c8y()],
})
```

Replace the `defineNitroConfig` import from `nitro/config` and rename the call. The
config object itself is unchanged.

#### Check the Nitro release notes

If your service uses Nitro features beyond what `c8y-nitro` configures, review
[Upgrading from Beta](https://nitro.build/blog/v3-rc) for the RC's breaking
changes. Examples are custom build hooks (`rollup:before` and `rollup:reload` were
renamed), `experimental.vite`, and file names with dotted suffixes in scanned
directories.

## 0.9.x to 0.10.0

This release upgrades the Nitro peer dependency from `3.0.260429-beta` to
`3.0.260903-beta`. Nitro removed its TypeScript type generation in that window, which
changes how your project picks up types. Everything you must change is in
[Required changes](#required-changes); the rest is context.

### Required changes

#### 1. Update Nitro

The peer dependency is pinned exactly, so Nitro must be bumped in lockstep:

```sh
pnpm add -D nitro@3.0.260903-beta
```

#### 2. Replace your `tsconfig.json` extends

Nitro no longer generates `node_modules/.nitro/types/tsconfig.json`, so extending it
now fails with `error TS5083: Cannot read file`. Extend Nitro's shared config instead
and include the declarations `c8y-nitro` generates:

```json [tsconfig.json]
{
  "extends": "nitro/tsconfig", // [!code ++]
  "extends": "./node_modules/.nitro/types/tsconfig.json", // [!code --]
  "include": ["**/*", "node_modules/.c8y-nitro/*.d.ts"] // [!code ++]
}
```

The `include` entry is required. Without it TypeScript cannot see the manifest-derived
role names, tenant option keys, or the [`c8y-nitro/runtime`](/reference/runtime-module)
module, and you get `Cannot find module 'c8y-nitro/runtime'`.

`nitro/tsconfig` sets stricter defaults than the config Nitro used to generate
(`verbatimModuleSyntax`, `isolatedModules`, `noImplicitOverride`). Override anything you
need under your own `compilerOptions`.

#### 3. Replace `nitro prepare`

The `nitro prepare` command no longer exists. If you had a script for it, point it at the
new [`typegen`](/reference/cli#typegen) command:

```json [package.json]
{
  "scripts": {
    "typegen": "c8y-nitro typegen" // [!code ++]
    "typegen": "nitro prepare" // [!code --]
  }
}
```

You only need this when type checking a checkout that has not been built — `nitro dev`
and `nitro build` write the same declarations. A typical CI job becomes:

```sh
pnpm install && pnpm c8y-nitro typegen && tsc --noEmit
```

#### 4. Delete stale generated types

The declarations moved from `node_modules/.nitro/types/c8y-nitro.d.ts` to
`node_modules/.c8y-nitro/types.d.ts`. Nitro still owns `node_modules/.nitro` for its dev
bundle and build metadata, but no longer writes types there. Old files are harmless but
stale — remove them so a forgotten `include` fails loudly instead of silently resolving
outdated role names:

```sh
rm -rf node_modules/.nitro/types
```

### Behavior changes

#### The API client is no longer generated during production builds

[API client generation](/guide/api-client) previously ran on every build. It now runs on
`nitro dev` (initial start and every reload) and via `c8y-nitro typegen`.

This matters if a pipeline ran `nitro build` and expected a freshly regenerated client
afterwards — add `c8y-nitro typegen` to that pipeline. In exchange, production builds no
longer create the output directory when it is absent, which previously left stray
directories in Docker builds where the UI project is not checked out.

### What changed in Nitro

These are Nitro's changes, not `c8y-nitro`'s, but you will hit them on upgrade.

#### Type generation was removed entirely

Nitro generated five files into `node_modules/.nitro/types`. All are gone:

| File                 | What It Did                     | Replacement                           |
| -------------------- | ------------------------------- | ------------------------------------- |
| `nitro-routes.d.ts`  | Typed `$fetch` by route         | None — feature removed                |
| `nitro-config.d.ts`  | Typed `useRuntimeConfig()` keys | Augment `NitroRuntimeConfig` yourself |
| `nitro-imports.d.ts` | Auto-import declarations        | None — auto-imports removed           |
| `nitro.d.ts`         | Tied the above together         | None                                  |
| `tsconfig.json`      | Config to extend                | `nitro/tsconfig`                      |

If you relied on typed `$fetch`, those calls are now loosely typed. To keep typed runtime
config, declare the keys yourself:

```ts
declare module 'nitro/types' {
  interface NitroRuntimeConfig {
    myKey?: string
  }
}
```

#### Caching defaults changed

Nitro moved to ocache 0.3. If you use `defineCachedFunction` or `defineCachedHandler`
directly, review the [Nitro caching guide](https://nitro.build/docs/cache) — `swr` now
defaults to `false`, query parameters are ignored by default, cookies are stripped from
cached requests and responses, and cache resolution has a new 30 second timeout.

Cache keys are hashed differently, so existing entries are cold after upgrading. This is
invisible with in-memory storage but matters if you mount a persistent `cache:` driver.

The [cache configuration](/guide/cache) that `c8y-nitro` exposes is unaffected.

#### Route rules

`basicAuth` is no longer a route rule and now throws at build time. Use h3's `basicAuth`
middleware instead. A new `cors` rule replaces manual CORS wiring. See the
[Nitro routing guide](https://nitro.build/docs/routing).
