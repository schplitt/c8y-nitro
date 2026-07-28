# Native Dependencies

Some packages ship a compiled binary (a `.node` file) instead of pure JavaScript — native (NAPI) modules such as `@duckdb/node-api`, `better-sqlite3`, `sharp`, or `@parcel/watcher`. These need special handling so the binary actually ends up in your deployed microservice image.

This is a **Nitro** concern (`nitro.config.ts`), not a `c8y-nitro` module option. But it is the single most common thing to get wrong when building a Cumulocity microservice with a native dependency, so it is documented here.

## The one rule: never bundle a native module

Nitro's Node presets keep dependencies **external** by default: instead of inlining them into the server bundle, Nitro traces them and copies the real packages into `.output/server/node_modules`. This is exactly what a native module needs, because a `.node` binary **cannot be bundled into JavaScript**.

The wrong instinct — and the one agents reach for first — is to force everything to be "internal" via `noExternals`. Do **not** do this for native modules:

```ts
// ❌ WRONG for native modules — a .node binary cannot be inlined into JS
export default defineNitroConfig({
  noExternals: true
})
```

Leave Nitro's default (external + trace) in place. Your only job is to make sure the tracer copies the native package **and** its platform binaries. The rest of this page is how.

## Anatomy of the fix

For a native module you configure two, sometimes three, things:

1. **`rolldownConfig.external`** — tell the bundler to keep its hands off the package entirely, so its `require()` of the `.node` file is never followed into the bundle graph.
2. **`traceDeps`** — force Nitro to trace and copy the package(s), including the `.node` binaries, into `.output/server/node_modules`.
3. **(Optional) `traceOpts.nft.ignore`** — prune platform binaries you do not ship, when the package pulls in every platform's package.

### `traceDeps` glob rules

From Nitro's own definition, `traceDeps` entries:

- `pkg*` — **full package trace**: copy the whole package (all files, including `.node` binaries). This is what you almost always want for native modules — a plain `pkg` traces only reachable files and can miss binaries loaded via dynamic `require`.
- `!pkg` — **exclude** a package that would otherwise be traced.

## Worked example: `@duckdb/node-api`

DuckDB splits itself into an API package (`@duckdb/node-api`), a bindings loader (`@duckdb/node-bindings`), and one package **per platform** (`@duckdb/node-bindings-linux-x64`, `@duckdb/node-bindings-darwin-arm64`, …). The loader will `require()` whichever platform package matches at runtime.

```ts
import c8y from 'c8y-nitro'

export default defineNitroConfig({
  preset: 'node-server',
  builder: 'rolldown',
  modules: [c8y()],
  c8y: {},

  // 1. Keep the bundler out of every @duckdb/* package.
  rolldownConfig: {
    external: [/^@duckdb\//],
  },

  // 2. Full-copy the API + the bindings loader, then exclude the platform
  //    packages we do NOT ship. We keep only:
  //      - linux-x64    → what the Cumulocity Docker image runs
  //      - darwin-arm64 → local `pnpm preview` on Apple Silicon
  traceDeps: [
    '@duckdb/node-api*',
    '@duckdb/node-bindings*',
    '!@duckdb/node-bindings-darwin-x64',
    '!@duckdb/node-bindings-linux-arm64',
    '!@duckdb/node-bindings-linux-arm64-musl',
    '!@duckdb/node-bindings-linux-x64-musl',
    '!@duckdb/node-bindings-win32-x64',
    '!@duckdb/node-bindings-win32-arm64',
  ],
})
```

Add or remove platforms in the exclude list to match what you build for and develop on.

### Advanced: `traceOpts.nft.ignore`

If a package resolves its platform binaries in a way `traceDeps` exclusions cannot express cleanly, drop down to the node-file-trace `ignore` hook, which decides per resolved path:

```ts
export default defineNitroConfig({
  // ...
  traceOpts: {
    nft: {
      // Keep only the two platform packages we ship; drop every other
      // @duckdb/node-bindings-<platform> the loader references.
      ignore: (path: string) =>
        /@duckdb[/\\]node-bindings-/.test(path)
        && !/@duckdb[/\\]node-bindings-(?:linux-x64|darwin-arm64)[/\\]/.test(path),
    },
  },
})
```

Prefer the `traceDeps` `!pkg` form; reach for `traceOpts.nft.ignore` only when path-level filtering is genuinely needed.

## Make the deploy-target binary available locally

Cumulocity microservice images are built (`node:24-slim`, linux/amd64) from your **locally traced** `.output`. So the linux-x64 binary must be installed in your workspace even when you develop on macOS, or the traced `.output` will be missing it.

Tell pnpm to install the extra architecture in `pnpm-workspace.yaml`:

```yaml
# Install linux-x64 (glibc) native binaries alongside your machine's own, so
# the traced .output has the binary the Docker image needs.
supportedArchitectures:
  os: [current, linux]
  cpu: [current, x64]
  libc: [current, glibc]
```

Native packages that need a build step (rather than shipping a prebuilt binary) must also be allowed to run their install scripts under pnpm — see pnpm's `onlyBuiltDependencies` / build-approval settings.

## Runtime system libraries

Some native modules also need **system packages inside the image** at runtime — for example CA certificates for native-code TLS (libcurl), or shared libraries the `.node` binary links against. The default `node:24-slim` image is minimal and may not ship them.

Use the [`docker` module option](/reference/module-options#docker) to install them into the generated image:

```ts
export default defineNitroConfig({
  c8y: {
    docker: {
      extraInstructions: [
        'RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*',
      ],
    },
  },
})
```

## Verifying it worked

After a build, confirm the package and its binary are present in the traced output:

```sh
pnpm build
ls .output/server/node_modules/@duckdb/node-bindings-linux-x64
# → the package dir, containing the .node binary
```

If the directory is missing, the tracer did not copy it: re-check that the package is matched by a `pkg*` entry in `traceDeps` and not accidentally excluded, and that `rolldownConfig.external` covers it.

## Checklist

- [ ] Left Nitro on its default external/traced behavior — did **not** add the module to `noExternals`.
- [ ] Added `rolldownConfig.external` for the package scope (e.g. `/^@duckdb\//`).
- [ ] Added `traceDeps` entries using `pkg*` for a full copy.
- [ ] Excluded platform packages you do not ship (`!pkg` or `traceOpts.nft.ignore`).
- [ ] Added the deploy target's architecture to `pnpm-workspace.yaml` `supportedArchitectures`.
- [ ] Verified the `.node` binary exists under `.output/server/node_modules` after `pnpm build`.
