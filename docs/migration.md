# Migration

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
