# AGENTS.md

## Project Overview

**c8y-nitro** is a Nitro module for lightning-fast Cumulocity IoT microservice development. It automates Docker builds, generates `cumulocity.json` manifests, creates deployable microservice zip files, and can generate Angular API clients.

**Key Features:**

- ⚡️ Built on Nitro's high-performance engine
- 📁 Automatic zip creation with Docker image and manifest
- 🎯 API client generation for Angular applications
- 📦 Built-in liveness/readiness probes
- 🔄 Auto-bootstrap for development tenants
- 🛠️ TypeScript-first with full type safety

## Architecture

```
src/
├── index.ts                    # Main entry point - exports c8y() module function
├── cli/
│   ├── index.ts                # CLI entry point using citty
│   ├── commands/
│   │   ├── bootstrap.ts        # Manual bootstrap command
│   │   ├── roles.ts            # Role management command
│   │   └── options.ts          # Tenant options management command
│   └── utils/
│       ├── c8y-api.ts          # Cumulocity API helpers for CLI
│       ├── config.ts           # Config loading utilities
│       └── env-file.ts         # .env file management
├── module/
│   ├── apiClient.ts            # Angular API client generation
│   ├── autoBootstrap.ts        # Auto-bootstrap during dev
│   ├── c8yzip.ts               # Zip file creation logic
│   ├── constants.ts            # Shared constants (probe routes, etc.)
│   ├── docker.ts               # Dockerfile generation & image building
│   ├── manifest.ts             # cumulocity.json manifest generation
│   ├── probeCheck.ts           # Validates probe configuration
│   ├── register.ts             # Registers runtime handlers/middlewares
│   ├── runtime.ts              # Runtime setup for dev mode
│   ├── runtimeConfig.ts        # Runtime config setup (maps options to runtime config)
│   └── runtime/
│       ├── handlers/
│       │   └── liveness-readiness.ts  # Probe endpoint handler
│       ├── middlewares/
│       │   ├── c8y-client.ts         # Normalizes raw @c8y/client thrown HTTP errors into structured server errors
│       │   └── dev-user.dev.ts        # Dev-only user injection middleware
│       └── plugins/
│           ├── c8y-variables.dev.ts   # Dev-only C8Y env variable plugin
│           └── enrich-logs.ts         # Request log enrichment plugin
├── types/
│   ├── index.ts                # Main type exports (C8yNitroModuleOptions)
│   ├── apiClient.ts            # API client generation types
│   ├── cache.ts                # Cache configuration types
│   ├── credentials.ts          # Shared tenant credential map types (TenantCredentials)
│   ├── manifest.ts             # Manifest types (C8YManifest, C8YManifestOptions)
│   ├── roles.ts                # Role types
│   ├── tenantOptions.ts        # Tenant option key types
│   └── zip.ts                  # Zip options types
├── testing/                    # c8y-nitro/testing (public test API, see docs/guide/testing.md)
│   ├── index.ts                # `c8y` arrange/act/assert API (entry: c8y-nitro/testing)
│   ├── vite.ts                 # c8yTest() Vite plugin (entry: c8y-nitro/testing/vite)
│   ├── setup.ts                # Vitest setup file the plugin injects (patches FetchClient, resets per test)
│   ├── platform.ts             # Fake tenant: user/subscriptions/options state, request dispatch, overrides
│   ├── store.ts                # In-memory platform data per tenant (managed objects, relations, external ids, measurements, events, alarms, operations)
│   ├── data.ts                 # c8y.device()/managedObject() refs, c8y.seed(), c8y.db views
│   ├── api/                    # Emulated REST APIs: inventory.ts, identity.ts, data.ts (measurements/events/alarms/operations), query.ts (query language subset), http.ts (paging, errors, spec validation)
│   ├── capabilities.generated.ts # GENERATED from the OpenAPI spec (pnpm gen:testing-capabilities): query params, required fields, enums
│   ├── scope.ts                # Scope-aware arrange calls (collection-time beforeEach registration)
│   ├── router.ts               # Route pattern matcher for c8y.override()
│   ├── defaults.ts             # Default tenant/user/env values (safe to import in the Vite config)
│   └── types.ts                # Public testing types
└── utils/
    ├── index.ts                # Utility exports
    ├── client.ts               # Cumulocity client utilities (useUserClient, etc.)
    ├── paging.ts               # Paging utilities (fetchAllPages, paginate, paginatePages)
    ├── credentials.ts          # Credential management (useSubscribedTenantCredentials)
    ├── logging.ts              # Logging utilities (useLogger, createError) re-exported from evlog
    ├── middleware.ts           # Auth middlewares (hasUserRequiredRole, etc.)
    ├── resources.ts            # Resource utilities (useUser, useUserRoles)
    ├── schedule.ts             # One-shot Nitro task scheduling utilities
    ├── tenantOptions.ts        # Tenant options fetching (useTenantOption)
    └── internal/
      ├── common.ts           # Internal shared utilities
      ├── tenantOptionFetchers.ts # Internal tenant option fetcher registry for runtime handlers
      └── tenant.ts           # Internal current-user tenant resolution and cache helpers
tests/
├── contract/scenarios.ts       # Contract scenarios for the fake tenant (real @c8y/client; written to also run against a real tenant)
├── unit/                       # Unit tests for individual functions
│   ├── apiClient.test.ts       # API client generation tests
│   ├── c8yzip.test.ts          # Zip creation tests
│   ├── docker.test.ts          # Docker generation tests
│   ├── manifest.test.ts        # Manifest generation tests
│   └── runtime.test.ts         # Runtime setup tests
└── server/                     # Server integration tests (Nitro Vitest environment + c8yTest())
    ├── *.test.ts               # One Nitro app per file
    ├── utils.ts                # Request and log helpers
    └── fixture/                # Mini Nitro app for testing
        ├── nitro.config.ts     # Nitro config with c8y module
        └── routes/             # Test route handlers
playground/                     # Development playground microservice (incl. example tests in test/)
```

### Package Exports

The package has these entry points:

- `c8y-nitro` — Main module function `c8y()` for Nitro config
- `c8y-nitro/types` — TypeScript types for configuration
- `c8y-nitro/utils` — Runtime utilities for microservice handlers
- `c8y-nitro/testing` — `c8y` test API (runs in Nitro's Vitest environment; `vitest` and `vite` are optional peer dependencies)
- `c8y-nitro/testing/vite` — `c8yTest()` Vite plugin for `vitest.config.ts` (runs in Vitest's main process: must not import Nitro runtime modules)

#### Importing types: module (`c8y-nitro/types`) vs relative path

At runtime in a consumer, the module generates a `c8y-nitro.d.ts` containing
`declare module 'c8y-nitro/types' { … }`. This **shadows** (does not merge with)
the real `c8y-nitro/types` module, so a type is only visible through
`c8y-nitro/types` if it is _regenerated_ into that ambient block (see
`src/module/runtime.ts`). Everything else imported from `c8y-nitro/types`
silently becomes `any` in consumers.

Rule for imports inside `src/`:

- Import from the **`c8y-nitro/types` module** ONLY for types we generate/override
  per manifest — `C8YTenantOptionKey`, `C8YSettingsCategory`, `C8YRoles`,
  `C8YTenantOptionKeysCacheConfig`. These must be the augmentable module type.
- For **everything else, import by relative path** (e.g. `./tenantOptions`,
  `../types/manifest`). Relative imports get inlined into the emitted `.d.ts`, so
  they survive the shadowing.

Public API types (e.g. `TenantOption`, `TenantOptionCategory`) are therefore
**colocated with their API in `src/utils/*.ts`** and exported from
`c8y-nitro/utils` via `export * from './<file>'` — the same way `schedule.ts`
does it. Do NOT declare or export such types from `c8y-nitro/types`; a consumer
importing them from there would get `any`.

### Module Flow

1. **Setup Phase** (`src/index.ts`): Configures Nitro options, runs auto-bootstrap
2. **Dev Mode** (`runtime.ts`): Sets up dev middlewares, handlers, and plugins
3. **Build Phase** (`register.ts`): Registers probe handlers, validates config
4. **Post-Build** (`c8yzip.ts`): Creates Docker image → manifest → deployable zip

## Development

```sh
pnpm install       # Install dependencies
pnpm dev           # Build with watch mode
pnpm build         # Build with tsdown
pnpm test          # Run tests with Vitest (watch mode)
pnpm test:run      # Run tests once (non-watch mode)
pnpm lint          # Lint with ESLint
pnpm lint:fix      # Lint and auto-fix
pnpm typecheck     # TypeScript type checking
pnpm gen:roles     # Regenerate the known-role type from the c8y OpenAPI spec
```

### Generating role types (`gen:roles`)

`src/types/roles.generated.ts` holds `C8YKnownRole` — a union of the Cumulocity
platform roles (`ROLE_*`) parsed from the public core OpenAPI spec. It powers
autocomplete for `manifest.requiredRoles` and for `hasUserRequiredRole(...)` in
the middleware, while `(string & {})` still allows any unknown role.

This file is **generated, not hand-edited** — that's easy to miss when starting
out. To refresh it after the platform adds/removes roles:

```sh
pnpm gen:roles                          # fetch the live spec
pnpm gen:roles -- --file ./c8y-oas.json # or parse a local spec (offline)
```

The script lives at `scripts/generate-roles.ts` and runs directly on Node
(no build step). A scheduled GitHub workflow (`.github/workflows/generate-roles.yml`)
runs it weekly and opens a PR when the roles change, so manual runs are only
needed when you want an update sooner. Regenerating changes the public API, so
run `pnpm build` afterwards to refresh the tsnapi snapshot.

### Generating the testing capability table (`gen:testing-capabilities`)

`src/testing/capabilities.generated.ts` holds what the fake tenant of `c8y-nitro/testing` derives from the core OpenAPI spec instead of assuming: the query parameters of every emulated endpoint, required request-body fields, and enums (alarm severity/status, operation status). It is **generated, not hand-edited**:

```sh
pnpm gen:testing-capabilities                          # fetch the live spec
pnpm gen:testing-capabilities -- --file ./c8y-oas.json # or parse a local spec
```

When you emulate a new endpoint, add it to `ENDPOINTS` in `scripts/generate-testing-capabilities.ts` and regenerate.

### Testing the Playground

```sh
cd playground
pnpm dev        # Start dev server
pnpm build      # Build microservice (creates .zip)
pnpm test       # Run the example tests (test/) against the fake tenant
```

## Code Style

- ESM only (`"type": "module"`)
- TypeScript strict mode enabled
- Uses `tsdown` for building
- Uses `@schplitt/eslint-config` for linting
- Uses `vitest` for testing
- Requires Node.js >= 24.0.0

## Testing

- Write tests in the `tests/` directory
- Use `*.test.ts` file naming convention
- Run `pnpm test` for watch mode during development
- Run `pnpm test:run` for single test run (use this in automated workflows)
- Import modules from `../src`
- When changing code exercised by `tests/server/fixture/`, rebuild the package before running those fixture tests (`pnpm build`). The fixture app imports `c8y-nitro`, `c8y-nitro/utils`, and the runtime handlers from the built `dist/`, not from the live source tree.

`vitest.config.ts` defines three Vitest projects:

| Project              | Files                                   | Environment                             |
| -------------------- | --------------------------------------- | --------------------------------------- |
| `unit`               | `tests/unit/**/*.test.ts`               | Node                                    |
| `server`             | `tests/server/**/*.test.ts`             | Nitro (`tests/server/fixture`)          |
| `server-no-dev-user` | `tests/server/**/*.no-dev-user.test.ts` | Nitro, with `c8y.dev.injectUser: false` |

Run one project with `pnpm vitest run --project server`.

### Unit Tests

Unit tests are in `tests/unit/` and test individual functions in isolation:

```ts
import { expect, test } from 'vitest'
import { createC8yManifest } from '../../src/module/manifest'

test('should create manifest from package.json', async () => {
  const manifest = await createC8yManifest('/path/to/project')
  expect(manifest.name).toBeDefined()
})
```

### Server Integration Tests

Server tests are in `tests/server/` and use **Nitro's Vitest environment** (`nitro()` from `nitro/vite`, see <https://nitro.build/docs/testing>) plus our own public test API, **`c8yTest()` from `c8y-nitro/testing/vite`** (we dogfood it). Each test file gets its own Nitro app built from `tests/server/fixture/` (including the `c8y()` module), without starting a dev server. The app runs with the `nitro-dev` preset, so `.dev.ts` runtime files (dev user injection, env checks) are active. All platform requests of the real `@c8y/client` are answered by the fake tenant; see `docs/guide/testing.md` for the user-facing rules.

#### Test Structure

```
tests/server/
├── utils.ts                  # fetchJson() (via serverFetch), captureLogs(), sleep()
├── fixture/                  # Nitro app under test
│   ├── nitro.config.ts       # c8y module config shared by all server tests
│   ├── plugins/              # Fixture plugins (e.g. credential hook recorder)
│   ├── routes/               # Routes that call c8y-nitro utilities
│   └── scheduler.ts          # Shared c8yTasks() registry
├── runtime.test.ts           # Dev user injection, probes, scheduled tasks
├── access-control.test.ts    # useUser/roles, role and tenant middleware
├── credentials.test.ts       # Credentials and the credentials lifecycle hook
├── tenant-options.test.ts    # Tenant option handles, caching, invalidation route
├── logging.test.ts           # evlog wide events
├── openapi.test.ts           # OpenAPI transformation
├── testing-api.test.ts       # c8y-nitro/testing itself: scopes, stacking, reset, overrides, unsupported requests
├── testing-data.test.ts      # A service tested against seeded platform data (the pattern users follow)
├── contract.test.ts          # Runs tests/contract/scenarios.ts against the fake tenant
├── testing-api.concurrent.test.ts # c8y-nitro/testing concurrency guard
└── dev-user.no-dev-user.test.ts # Runs in the server-no-dev-user project
```

#### Writing a Server Test

```ts
import { describe, expect, it } from 'vitest'
import { c8y, definePersona, serverFetch } from 'c8y-nitro/testing'
import { fetchJson } from './utils'

const outsider = definePersona({ userName: 'testUser', roles: [], tenant: 't99999' }) // a caller

it('is denied for users of other tenants', async () => {
  expect((await serverFetch('/deployed-tenant-only', { as: outsider })).status).toBe(403)
})

const pump = c8y.device({ name: 'Pump 1', externalIds: { c8y_Serial: 'SN-1' } }) // platform data

it('raises an overheating alarm', async () => {
  const { json } = await fetchJson(`/devices/${pump.id}/overheating`, { method: 'POST' })
  expect(json.count).toBe(1) // the response
  expect(c8y.db.alarms.find({ source: pump })).toMatchObject([{ severity: 'CRITICAL' }]) // the resulting state
})
```

Key points:

- **Test services, not the Cumulocity API.** Arrange platform data (`c8y.device()`, `c8y.seed()`, `c8y.tenantOptions`), call routes with `serverFetch(path, { as })` from `c8y-nitro/testing` (`as`: a `definePersona()` user, inline user, or `null`) — `c8y` is only the fake platform — and assert on responses and `c8y.db`. Use `c8y.override()` only for failures and unemulated APIs, and `toHaveReceived`/`callsTo` only where the request itself is the behavior (e.g. caching). Tests of the fake's own API semantics belong in `tests/contract/scenarios.ts`.
- **Tests use the public API only** (`c8y-nitro/testing`, resolved from `dist`). If a test needs something the API cannot express, improve the API instead of adding a private workaround.
- **One app per file.** Module options need a separate Vitest project, like `server-no-dev-user` (each project lists `nitro(...)` and `c8yTest()`). Everything read at request time (user, subscriptions, tenant options, handlers, dev env) can change per scope inside one file.
- **Module state is shared.** Tests can import fixture modules directly, e.g. the credential hook recorder in `fixture/plugins/tenant-credentials-updated.ts`. Do not add fixture routes just to mutate platform state: use `c8y.*`.
- **Logs**: `captureLogs()` spies on `console.*`. The server runs in the test worker, so evlog wide events and `console.log` from routes and tasks land there. Wide events are emitted after the response: wait ~100 ms before asserting.
- **Known noise**: one tslib `__extends` (or `require is not defined`) error per run comes from Nitro's Vite dev worker loading the real `@c8y/client` under the Vite builder. It does not affect test results. See "Vite builder compatibility" below.

#### Adding New Test Fixtures

1. Create a route handler in `tests/server/fixture/routes/`
2. Import and use utilities from `c8y-nitro/utils` (their platform requests go to the fake tenant)
3. Add tests to the matching `tests/server/*.test.ts` file, or a new file if the topic is new
4. If a test needs different module options, add a Vitest project in `vitest.config.ts` (see `server-no-dev-user`)

## Key Concepts

### Nitro Module Pattern

The main export is a Nitro module factory function:

```ts
export function c8y(): NitroModule {
  return {
    name: 'c8y-nitro',
    setup: async (nitro) => {
      // Access options via nitro.options.c8y
      // Register hooks for build lifecycle
    },
  }
}
```

### Runtime Utilities

Utilities in `src/utils/` are designed to work with Nitro's request context:

- Accept `H3Event` or `ServerRequest` as parameter if necessary
- Cache results in request context where appropriate

### Cumulocity Integration

- Uses `@c8y/client` for API interactions
- Bootstrap credentials stored in `.env` files
- Supports multi-tenant subscriptions

### Configurable Utilities Pattern

Utilities that need configuration from module options use **Nitro's runtime config**:

1. Configuration is defined in `C8yNitroModuleOptions` (e.g., `cache.credentialsTTL`)
2. During setup, `runtimeConfig.ts` copies values to `nitro.options.runtimeConfig`
3. Utilities import and read from runtime config using `useRuntimeConfig()`
4. Runtime config values can be overridden by environment variables (e.g., `NITRO_C8Y_CREDENTIALS_CACHE_TTL`)

**Pattern for adding new configurable values:**

- Add option to `C8yNitroModuleOptions` in `types/index.ts` (organized in logical groups)
- Map option to flat runtime config variable in `module/runtimeConfig.ts`
- Access in utilities via `useRuntimeConfig().yourVariable`
- Use flat variable names for runtime config (easier to override with env vars)

## Maintaining Documentation

When making changes to the project (new APIs, architectural changes, updated conventions):

- **`AGENTS.md`** — Update with technical details, architecture, and best practices for AI agents
- **`docs/` VitePress site** — Primary user-facing documentation for end users. Update the relevant guide/reference page whenever behavior, configuration, commands, utilities, runtime hooks, environment variables, workflows, or deployment behavior change.
- **`README.md`** — Keep short and entry-point focused. Update only when the quickstart, package positioning, install instructions, or docs links change. Do not move full feature documentation back into the README.

User-facing documentation belongs in `docs/` first:

- New configuration options (anything in `C8yNitroModuleOptions`) → `docs/reference/module-options.md` and any relevant guide page
- New utilities or functions exported from `c8y-nitro/utils` → `docs/reference/utilities.md` and, for non-trivial behavior, a guide page
- New CLI commands or features → `docs/reference/cli.md`
- Runtime hooks → `docs/reference/runtime-hooks.md`
- Environment variables → `docs/reference/environment-variables.md`
- Generated runtime exports or generated types → `docs/reference/runtime-module.md`
- Changes to existing API behavior → update the relevant `docs/guide/**` and `docs/reference/**` pages
- Any feature that users can configure, use, or interact with

After changing docs, run `pnpm docs:build` when feasible to catch broken links, bad frontmatter, or VitePress config problems.

### When to Update Documentation (Critical - Always Consider)

**ALWAYS check if documentation needs updating after:**

1. **Adding a new utility function** → Update `docs/reference/utilities.md` with function name, description, request-context expectations, and example. Add or update a guide page for non-trivial workflows.

- Example: Adding a new scheduler helper requires updating `docs/reference/utilities.md` and `docs/guide/scheduled-tasks.md`

2. **Adding a new configuration option** → Update `docs/reference/module-options.md` and the relevant guide page.

- Example: Adding `cache.tenantOptions` requires updating `docs/reference/module-options.md` and `docs/guide/cache.md`

3. **Adding a new type that users configure** → Update JSDoc plus the relevant docs reference/guide page.

- Example: Adding `C8yTenantOptionsCacheConfig` requires documenting it in cache configuration docs

4. **Creating a new file in `src/types/`** → Update AGENTS.md architecture diagram
   - Example: Creating `tenantOptions.ts` requires adding it to the types list in the architecture section

5. **Creating a new file in `src/utils/`** → Update AGENTS.md architecture diagram
   - Example: Creating `tenantOptions.ts` requires adding it to the utils list in the architecture section

6. **Discovering a pattern that should be documented** → Update AGENTS.md "Patterns & Conventions" or "Common Mistakes to Avoid"
   - Example: Learning that types should be imported from `'c8y-nitro/types'` instead of relative paths

7. **User corrects how something should be done** → Update AGENTS.md "Project Context & Learnings"
   - Example: Learning that Nitro v3 requires explicit imports from `'nitro/h3'`

8. **Adding a new environment variable** → Update `docs/reference/environment-variables.md` with the variable name, source, and behavior. Also update any guide page that teaches the workflow.

- Example: Adding `NITRO_C8Y_DEFAULT_TENANT_OPTIONS_TTL` requires documenting it in env-var reference and cache docs

9. **Changing how a utility works** → Update JSDoc, `docs/reference/utilities.md`, and the relevant guide page
   - Example: Adding cache invalidation methods requires updating the utility's documentation

10. **Adding support for new functionality** → Add or update a dedicated docs guide when the behavior needs explanation, plus the relevant reference page

- Example: Adding tenant options support requires `docs/guide/tenant-options.md` plus reference updates

**Documentation Update Checklist:**

- [ ] Did I add/change a utility? → Update `docs/reference/utilities.md` and relevant guide docs
- [ ] Did I add/change a config option? → Update `docs/reference/module-options.md` and relevant guide docs
- [ ] Did I add/change a type? → Update JSDoc and relevant docs pages
- [ ] Did I add/change a file? → Update AGENTS.md architecture diagram
- [ ] Did I learn a pattern? → Update AGENTS.md patterns/conventions
- [ ] Did I add an env variable? → Update `docs/reference/environment-variables.md`
- [ ] Did I change runtime exports/generated types? → Update `docs/reference/runtime-module.md`
- [ ] Did I change quickstart/install/package positioning? → Update `README.md`
- [ ] Did I update docs? → Run `pnpm docs:build` when feasible
- [ ] At the end of my response: Did I explicitly notify the user of documentation changes?

**Remember:** Documentation is NOT optional. Treat it as part of the implementation, not an afterthought.

## Agent Guidelines

When working on this project:

1. **Never commit or push without explicit user instruction** — Do not run `git commit`, `git push`, or any equivalent workflow action unless the user has explicitly asked for it in that message. Do not ask whether to commit. Do not commit "just to wrap up". Wait for the user to say so.
2. **Run tests** after making changes: `pnpm test:run` (runs once, no watch mode)
3. **Run linting** to ensure code quality: `pnpm lint`
4. **Run type checking** before committing: `pnpm typecheck`
5. **Maintain exports** — Public APIs in `src/index.ts`, types in `src/types/index.ts`, utils in `src/utils/index.ts`
6. **Add tests** for new functionality in the `tests/` directory
7. **Test in playground** — Use `playground/` to verify changes work in a real microservice context
8. **Record learnings** — When the user corrects a mistake or provides context about how something should be done, add it to the "Project Context & Learnings" section below if it's a recurring pattern (not a one-time fix)
9. **Notify documentation changes** — When updating `README.md` or `AGENTS.md`, explicitly call out the changes to the user at the end of your response so they can review and don't overlook them
10. **Use available workflow tools first** — When the user asks for branch/commit/PR workflow, use the available MCP/devtools for branch creation, commits, pushes, and PRs. Only fall back to `gh` CLI when those tools are not available. Never assume Claude Code or any other external workflow helper.
11. **Use conventional naming for git workflow** — For branch/commit/PR workflow, branch names should use the same conventional type prefixes as commits and PR titles where appropriate. Prefer prefixes such as `feat/`, `test/`, `chore/`, `fix/`, `docs/`, `refactor/`, `build/`, `types/`, `examples/`, `style/`, `perf/`, and `ci/`. Commit subjects and PR titles must use conventional-commit style and should choose the most appropriate type from this set: `feat`, `perf`, `fix`, `refactor`, `docs`, `build`, `types`, `chore`, `examples`, `test`, `style`, `ci`. The project maps them as follows: `feat` → 🚀 Enhancements (minor), `perf` → 🔥 Performance (patch), `fix` → 🩹 Fixes (patch), `refactor` → 💅 Refactors (patch), `docs` → 📖 Documentation (patch), `build` → 📦 Build (patch), `types` → 🌊 Types (patch), `chore` → 🏡 Chore, `examples` → 🏀 Examples, `test` → ✅ Tests, `style` → 🎨 Styles, `ci` → 🤖 CI.
12. **Default PR base/branch behavior** — When the user asks for a PR while the current branch already contains related work, assume the PR should be opened from the current branch to `main` unless the user explicitly asks to isolate only a subset of changes or use a different base branch. Do not create a fresh branch off an in-progress feature branch just to hold the latest agent-only changes unless the user asks for that.
13. **Always include a PR body** — PRs created for the user must include a body. If the work clearly addresses an existing issue and the issue identifier is known, include it in the PR body using the appropriate GitHub-style reference.

## Project Context & Learnings

This section captures project-specific knowledge, tool quirks, and lessons learned during development. When the user provides corrections or context about how things should be done in this project, add them here if they are recurring patterns (not a one-time fix).

> **Note:** Before adding something here, consider: Is this a one-time fix, or will it come up again? Only document patterns that are likely to recur or are notable enough to prevent future mistakes.

### Tools & Dependencies

- **Nitro `3.0.261029-rc`** — Nitro v3 release candidate, pinned exactly as a peer dependency; bump `package.json` (peer), the `pnpm-workspace.yaml` catalog, and its `minimumReleaseAgeExclude` entry together, and add a `docs/migration.md` section
- **Nitro config helper** — Use `import { defineConfig } from 'nitro'`; `defineNitroConfig` from `nitro/config` is deprecated since the RC
- **`nitro.logger` type** — Since the RC, `nitro.logger` is Nitro's own minimal logger type, not consola's `ConsolaInstance`, and Nitro does not export it by name. Type module helpers that receive it as `Nitro['logger']` (from `nitro/types`), not with consola types. Helpers shared with the CLI (which passes `consola`) use a small structural interface instead, like `BootstrapSyncLogger` in `src/module/autoBootstrap.ts`
- **@c8y/client >= 1021** — Peer dependency; provides Cumulocity API client
- **Docker required** — Must be installed for zip creation during build
- **Native (NAPI) dependencies** — For any dependency shipping a compiled `.node` binary (e.g. `@duckdb/node-api`, `better-sqlite3`, `sharp`): **never** add it to `noExternals` / try to bundle it — a native binary cannot be inlined into JS. Keep Nitro's default external+trace behavior and make the tracer copy the package: `rolldownConfig.external: [/^@scope\//]` + `traceDeps: ['@scope/pkg*', '!@scope/unwanted-platform-pkg']` (`pkg*` = full package copy incl. binaries; `!pkg` = exclude). Prune extra platform packages with `!pkg` entries or `traceOpts.nft.ignore`. Add the deploy target's arch to `pnpm-workspace.yaml` `supportedArchitectures` (Docker image is traced from local `.output`). Full worked example: `docs/guide/native-dependencies.md`.

### Code Style

- **Nitro v3 explicit imports** — Use explicit imports from Nitro packages, e.g., `import { defineEventHandler } from 'nitro/h3'`. Auto-imports are not available.
- **CLI error handling** — In CLI commands using citty, throw errors to exit with a message. Citty automatically catches and displays them. Use `cancel: 'reject'` on consola prompts to throw on user cancellation.
- **Logging** — evlog is automatically registered by `c8y()` (service name = manifest name). Import `useLogger`, `createLogger`, and `createError` from `c8y-nitro/utils`. `useLogger()` accepts **either** an `H3Event` **or** the `ServerRequest` from Nitro's `useRequest()` (from `nitro/context`, needs `experimental.asyncContext`) — both carry the same request context. `createLogger(ctx?)` is for standalone/background contexts and requires a manual `log.emit()` call; no additional module setup is needed in `nitro.config.ts`.
  - **Why `useLogger` is wrapped, not re-exported** — evlog's `useLogger(event)` reads `event.req.context.log`, so it only accepts an `HTTPEvent`; `useRequest()` returns the `ServerRequest` directly (no `.req`) and would throw. `src/utils/logging.ts` wraps it to normalize both shapes (`'req' in x ? x : { req: x }`), restoring the accept-both behavior an older evlog had. Regression-guarded by `tests/server/fixture/routes/logging/via-request.ts` + the "accept useRequest()" server test. If bumping evlog, re-check that `useLogger` still reads the logger from the request context this way.
- **Structured errors** — always use `createError` from `c8y-nitro/utils` (re-exported from `evlog`) instead of Nitro/h3's built-in `createError`. **Field exposure contract:** `message`, `status`, `code`, `why`, `fix`, and `link` are all serialized into the JSON response (under a `data` key) and are therefore visible to the caller; only `internal` (and `cause`) stays server-side and appears solely in the wide log event. **Never leak internal system errors** — put raw upstream/core payloads, DB errors, tokens, or tenant internals in `createError({ internal: … })`, not in `message`/`why`. `@c8y/client` rejects with plain `{ res, data }` objects (not `Error`s) on HTTP failure — normalize those into a `createError` at the boundary and keep the raw `{ res, data }` in `internal`. See `docs/guide/logging.md` and the JSDoc on `createError` in `src/utils/logging.ts`.
- **Composed / imperative auth** — when authorization is conditional or per-resource (e.g. "has read role OR owns this resource"), do not re-implement role fetching or the 403 shape. Compose `useUserRoles(event)` + `useUserClient(event)` (probe core as the caller) + `createError`. Use the `hasUserRequiredRole` / `isUserFrom*Tenant` middleware only for plain role/tenant gates. See `docs/guide/auth-middleware.md` § Composed / Imperative Authorization.
- **Logging test pattern** — In server tests, use `captureLogs()` from `tests/server/utils.ts` (spies on `console.*`; the server runs in the test worker) and call `logs.clear()` in `afterEach`. Wait 100ms after the request for async log emission before asserting.
- **Server fixture test dependency** — `tests/server/fixture/` exercises the built package. After changing module/runtime behavior used by fixture tests, run `pnpm build` before running those tests or the fixture app may still use stale output.
- **Nitro workspace version alignment** — Keep `pnpm-workspace.yaml`'s Nitro catalog version aligned with the package-level Nitro version before diagnosing Nitro type or cache helper behavior. A catalog mismatch can leave the workspace on an older Nitro build and make cache helper typings or runtime assumptions look wrong.
- **Scheduled task test pattern** — Scheduling is self-contained in the `c8yTasks()` registry (no `experimental.tasks`, no Nitro tasks). Register tasks once in a shared fixture module (`tests/server/fixture/scheduler.ts`) via `c8yTasks().createTask(...)` and import that singleton from routes. Schedule a job through a route with `tasks.scheduleJob({ name, task, schedule: { in } })`, assert captured logs do not contain the job marker immediately after the request, then sleep until `nextRun` plus a buffer and assert the marker appears. For deterministic single/parallel-concurrency coverage, prefer a unit test (`tests/unit/tasks.test.ts`) that schedules a far-future cron and drives execution via `triggerJob()`. Use `captureLogs()` for log assertions.
- **Fixture cache tests** — For cache-expiration coverage, prefer a dedicated manifest-defined tenant option key with its own short TTL in `tests/server/fixture/nitro.config.ts` (e.g. `cacheExpiryOption`) instead of reusing a key other assertions depend on. Change the platform value with `c8y.tenantOptions.set()` inside the test and assert the cached value until the TTL passes.
- **Lifecycle hook fixture tests** — Record hook events in a fixture plugin and import its getters directly in the test (shared module graph). Change subscriptions with `c8y.subscriptions.add()` / `.remove()` inside the test and refresh through a route. Verify both sides: unchanged refreshes must not emit the hook, while adding a tenant, removing a tenant, or replacing one tenant id with another emits exactly one event.

- Utility functions accept `H3Event | ServerRequest` for flexibility
- Use `defineCachedFunction` from Nitro for cached API calls (e.g., credentials)
  - Always include `invalidate` and `refresh` helper functions
  - Prefer Nitro/ocache's built-in cached function `.invalidate()` over manually constructing cache storage keys and removing them; manual keys are easy to get wrong when `group`, `base`, or `getKey` differ from defaults
  - Carefully consider what requests make sense to be cached (e.g., credentials, not real-time data, consider security implications)
  - For per-key caching (like tenant options), use a factory pattern with a Map/Record to store fetchers
  - `maxAge` does NOT accept a function — if you need per-key TTL, create separate cached functions per key
- Generated types are consolidated into a single `c8y-nitro.d.ts` file for performance
  - Written to `node_modules/.nitro/types/` by `setupRuntime()`
  - Augments `c8y-nitro/types` and `c8y-nitro/runtime` modules
- Public Nitro hook augmentations that consumers should get from `import 'c8y-nitro'` must live in the root entrypoint type graph
  - Put `declare module 'nitro/types'` hook augmentations in `src/index.ts` so they are emitted in `dist/index.d.mts`
  - Export shared hook payload types from `c8y-nitro/types` (for example `TenantCredentials`) and reference those in the augmentation instead of repeating inline records
  - Do not hide consumer-facing Nitro hook augmentations only behind `c8y-nitro/types`-only files unless the root entrypoint imports them for declaration generation
  - For lifecycle hooks on cached data, emit only when the effective payload actually changes; compare the relevant key set for the hook semantics, not just item counts, and treat ordering as irrelevant
- Virtual module `c8y-nitro/runtime` exports runtime values (roles, tenant option keys)
  - Use `as const` for tuples to preserve literal types
  - Keep `src/runtime.d.ts` in sync as a fallback declaration
- Auto-injected routes use `/_c8y_nitro/` prefix to avoid conflicts with user routes
- Runtime files (`src/module/runtime/**`) are built by a **separate tsdown config** from `c8y-nitro/utils`. A relative import from a runtime file into `src/utils/` inlines a **second copy** of that module, including its module-level state
  - If a runtime file needs **shared state** (e.g. the tenant option fetcher registry behind `useTenantOption`), import the public `c8y-nitro/utils` entry. It is `neverBundle` in the runtime tsdown config, so Nitro bundles one copy for user routes and runtime handlers. Example: `runtime/handlers/invalidateTenantOptions.ts` (a relative import made the invalidation route a silent no-op)
  - Stateless helpers (e.g. `createError` from `src/utils/logging.ts`) can still be imported by relative path
- **`c8y-nitro/testing` internals** (see `src/testing/`):
  - The plugin marks `@c8y/client` as **external in the `nitro` Vite environment**, so Node loads the real client natively (Vite cannot transform its CJS deps). The setup file patches `FetchClient.prototype.fetch`; every service and static helper of the client goes through it, so one patch answers all platform requests. Keep `getUrl()`/`getFetchOptions()` in the patch so query params and auth headers stay real.
  - Arrange calls are scope-aware via a **phase flag**: during collection they register a `beforeEach` in the current suite (Vitest replays them outer→inner after the setup file's reset); during a test they apply directly. Do not try to map `getCurrentSuite()` collectors to run-time suites (they are different objects).
  - The setup file must **not import `c8y-nitro/utils` at top level**: loading it before Nitro creates the app (in Nitro's own `beforeAll`) enters Nitro's runtime through an import cycle (`defineCachedFunction is not a function`). Import it lazily inside hooks.
  - `testing/vite.ts` runs in Vitest's main process: keep it free of Nitro runtime imports (`nitro/runtime-config` etc.); share constants via `defaults.ts`.
  - The module skips auto-bootstrap when `process.env.VITEST` is set, so tests never contact a real tenant.
  - **Extending the fake tenant:** derive what the spec defines (regenerate the capability table), hand-write behavior in `src/testing/api/`, and fail loudly (`UnsupportedRequestError`) for anything not emulated — never return a silently wrong result. Every new behavior needs a scenario in `tests/contract/scenarios.ts` and a row/assumption in the "What the Fake Emulates" section of `docs/guide/testing.md`. Spec-known query parameters a handler does not emulate must fail loudly (`checkQuery`); unknown parameters are ignored like the real API.
  - **Realtime (Notification 2.0):** `src/testing/realtime.ts` holds subscriptions, tokens, and `FakeWebSocket` consumers; `api/notifications.ts` the REST API. c8y-nitro's realtime client gets the fake socket through the test seam `src/utils/internal/testing.ts` (a `globalThis` symbol the setup file sets; unset in production — keep it that way, never import testing code from runtime code). c8y-realtime's REST calls use global `fetch`, which the setup file routes to the fake for the platform's origin. Every data write calls `notify()`; replayed arrangements set `store.silent` so they do not notify. Realtime state lives for the whole test file; only data resets.
  - The setup file **starts the Nitro app in `beforeAll`** (`useNitroApp()` + `await app.ready`, then `waitForRealtimeStartup()`): Nitro creates the app lazily on first request, so startup plugins (realtime subscriptions) would otherwise not exist in tests that never call a route.
  - `@c8y/client` uploads with the Node `form-data` package; the `FetchClient` patch serializes it (`getBuffer()`/`getBoundary()`). Handlers that need raw bytes or repeated query params use `raw(call)` from `api/http.ts`.
  - Managed objects created by `c8y.device()`/`managedObject()` are bound to refs at replay time (`store.refs`), so `ref.id` only works while a test runs; ids are sequential and reset per test.
- Runtime registration (`registerRuntime()`) runs during module **setup**, not in `build:before`. Nitro's Vitest environment and runtime mode (`builder: false`) never run a build, so handlers registered in a build hook would be missing there. Only checks that need scanned routes (`checkProbes`) stay in `build:before`
- **Vite builder compatibility** — `@c8y/client` does not load under Nitro's Vite builder yet: tslib's CJS entry (`__extends` destructure error) and CJS `cross-fetch` (`require is not defined`). The `tslib` alias lives in `rolldownConfig.resolve.alias` on purpose: a `nitro.options.alias` entry resolves from the project root, where pnpm does not expose `tslib`, and breaks production builds
- Runtime handlers/middleware/plugins must be in `src/module/runtime/` directory structure:
  - `runtime/handlers/` — Event handlers (e.g., probe endpoints)
  - `runtime/middlewares/` — Global middlewares (e.g., dev user injection)
  - `runtime/plugins/` — Nitro plugins (e.g., env variable validation)
  - These locations are required for the module to correctly register them
- `@c8y/client` throws plain objects like `{ res, data }` for HTTP failures instead of `Error` instances
  - Normalize those at a global runtime boundary if they should become structured server errors
  - Keep upstream payloads in `createError({ internal: ... })` so they are logged without being exposed to clients
- Dev-only runtime middleware/plugins must use a `.dev.ts` suffix
  - `registerRuntime()` only includes `.dev.ts` runtime files when `nitro.options.preset === 'nitro-dev'`
  - Prefer excluding a dev-only runtime file entirely over adding runtime guards inside it
  - For configurable dev-only behavior like user injection, keep the user-facing option in `c8y.dev`, then skip registering the `.dev.ts` file when disabled

### Common Mistakes to Avoid

- Don't forget to add new utilities to the appropriate `index.ts` export file
- **Always update documentation** when changing utilities or configuration:
  - JSDoc comments in source code (with `@config` tag for configurable values showing how to set them)
  - `README.md` for user-facing changes (configuration options, utilities, env variables, API behavior)
  - `AGENTS.md` for technical/architectural changes relevant to AI agents
  - Explicitly notify the user of documentation updates at the end of your response
- **Use package imports for augmentable types** — When a type is augmented by generated types (e.g., `C8YTenantOptionKey`, `C8YTenantOptionKeysCacheConfig`), import from `'c8y-nitro/types'` instead of relative paths. This ensures users benefit from type hints after types are generated. It may cause initial type errors before first build, but resolves after `nitro prepare`.
  - Explicitly notify the user of documentation updates at the end of your response
