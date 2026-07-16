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
└── utils/
    ├── index.ts                # Utility exports
    ├── client.ts               # Cumulocity client utilities (useUserClient, etc.)
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
├── unit/                       # Unit tests for individual functions
│   ├── apiClient.test.ts       # API client generation tests
│   ├── c8yzip.test.ts          # Zip creation tests
│   ├── docker.test.ts          # Docker generation tests
│   ├── manifest.test.ts        # Manifest generation tests
│   └── runtime.test.ts         # Runtime setup tests
└── server/                     # Server integration tests
    ├── server.test.ts          # Main server test file
    ├── fixture/                # Mini Nitro app for testing
    │   ├── nitro.config.ts     # Nitro config with c8y module
    │   └── routes/             # Test route handlers
    └── mocks/
        └── generator.ts        # Mock @c8y/client code generator
playground/                     # Development playground microservice
```

### Package Exports

The package has three entry points:

- `c8y-nitro` — Main module function `c8y()` for Nitro config
- `c8y-nitro/types` — TypeScript types for configuration
- `c8y-nitro/utils` — Runtime utilities for microservice handlers

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
```

### Testing the Playground

```sh
cd playground
pnpm dev        # Start dev server
pnpm build      # Build microservice (creates .zip)
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
- When changing code exercised by `tests/server/fixture/`, rebuild the package before running those fixture tests (`pnpm build`). The fixture server depends on the built package output, not only the live source tree.

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

Server tests are in `tests/server/` and test the full Nitro server with the c8y-nitro module. These tests use **Nitro's virtual modules** to mock `@c8y/client` at build time.

#### Why Virtual Modules?

The Nitro bundler creates an isolated execution environment. Shared mutable state between test code and server code doesn't work because the server runs bundled code. Virtual modules solve this by injecting mock code as a string during the build phase.

#### Test Structure

```
tests/server/
├── server.test.ts           # Main test file
├── fixture/                  # Test fixture (mini Nitro app)
│   ├── nitro.config.ts       # Nitro config with c8y module
│   └── routes/               # Test route handlers
│       ├── user.get.ts
│       ├── credentials.get.ts
│       └── protectedRoute.ts
└── mocks/
    └── generator.ts         # Generates mock @c8y/client code
```

#### Mock Generator

The `generateMockClientCode()` function creates JavaScript code that replaces `@c8y/client`:

```ts
import { generateMockClientCode } from './mocks/generator'
import type { MockC8yClientData } from './mocks/generator'

// MockC8yClientData interface:
// {
//   currentUser?: ICurrentUser | null      // User returned by client.user.currentWithEffectiveRoles()
//   subscriptions?: Array<ICredentials>    // Subscribed tenants from bootstrap API
//   tenantOptions?: Record<string, string> // Tenant options by key (without credentials. prefix)
// }

const mockData: MockC8yClientData = {
  currentUser: {
    userName: 'testUser',
    effectiveRoles: [{ name: 'ROLE_ADMIN' }],
  },
  subscriptions: [
    { tenant: 't12345', user: 'serviceuser', password: 'pass' },
  ],
  tenantOptions: {
    myOption: 'value',
    secret: 'decrypted-value', // Note: stored without "credentials." prefix
  },
}

const code = generateMockClientCode(mockData)
```

#### Creating a Server Test

```ts
import { createNitro, createDevServer, build, prepare } from 'nitro/builder'

// 1. Create server with mock data via virtual modules
const nitro = await createNitro({
  dev: true,
  rootDir: resolve(__dirname, './fixture'),
  builder: 'rolldown',
  virtual: {
    '@c8y/client': generateMockClientCode(mockData),
  },
})

const devServer = createDevServer(nitro)
const server = devServer.listen({})
await prepare(nitro)
await build(nitro)

// 2. Make requests and assert
const res = await server.fetch(new Request(new URL('/user', server.url)))
const json = await res.json()
expect(json.userName).toBe('testUser')

// 3. Cleanup
await devServer.close()
await nitro.close()
```

#### Adding New Test Fixtures

1. Create a route handler in `tests/server/fixture/routes/`
2. Import and use utilities from `c8y-nitro/utils` (these will use the mocked client)
3. Add a test that creates a server with appropriate `mockData`
4. Group related tests to share server instances (reduces ~600ms overhead per server)

#### Performance Tips

- **Share server instances**: Each `beforeAll`/`afterAll` pair adds ~600ms. Group related tests.
- **Use `builder: 'rolldown'`**: Faster builds than default bundler.
- **Parallel-safe**: Each describe block gets its own server, so tests within a block run against the same instance.

#### Limitations

Virtual module mocking injects module code at build time. By default, the generated mock data is static per server instance, but the mock module can also expose explicit helper functions for controlled runtime mutation when a test needs to simulate backend state changes.

- **Static by default**: Most mock data is fixed per built server instance unless the virtual module intentionally exposes mutable helpers
- **Controlled runtime mutation is possible**: For cache invalidation or TTL-expiration tests, add explicit helper exports to the virtual module and trigger them through fixture routes so the bundled server mutates its own in-memory mock state
- **No call-count/state introspection by default**: Cannot assert writes or API call counts unless the virtual module is extended to record that state
- **One virtual module per server build**: Changing the mock implementation itself still requires building a new server instance

For testing cache behavior, TTL expiration, or stateful interactions, consider:

- Extending the virtual module with focused runtime mutation helpers and hitting them through fixture routes
- Unit testing the caching logic separately with mocked dependencies
- Using the playground with a real Cumulocity tenant for manual verification

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
- Deployment, CI, release, or GitHub Pages behavior → `docs/guide/deployment.md`
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

11. **Changing release, CI, docs build, or Pages behavior** → Update `docs/guide/deployment.md` and, if needed, `README.md` links or quickstart notes

**Documentation Update Checklist:**

- [ ] Did I add/change a utility? → Update `docs/reference/utilities.md` and relevant guide docs
- [ ] Did I add/change a config option? → Update `docs/reference/module-options.md` and relevant guide docs
- [ ] Did I add/change a type? → Update JSDoc and relevant docs pages
- [ ] Did I add/change a file? → Update AGENTS.md architecture diagram
- [ ] Did I learn a pattern? → Update AGENTS.md patterns/conventions
- [ ] Did I add an env variable? → Update `docs/reference/environment-variables.md`
- [ ] Did I change runtime exports/generated types? → Update `docs/reference/runtime-module.md`
- [ ] Did I change release/deploy behavior? → Update `docs/guide/deployment.md`
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

- **Nitro v3.0.1-alpha** — Using alpha version; watch for breaking changes
- **@c8y/client >= 1021** — Peer dependency; provides Cumulocity API client
- **Docker required** — Must be installed for zip creation during build

### Code Style

- **Nitro v3 explicit imports** — Use explicit imports from Nitro packages, e.g., `import { defineEventHandler } from 'nitro/h3'`. Auto-imports are not available.
- **CLI error handling** — In CLI commands using citty, throw errors to exit with a message. Citty automatically catches and displays them. Use `cancel: 'reject'` on consola prompts to throw on user cancellation.
- **Logging** — evlog is automatically registered by `c8y()` (service name = manifest name). Import `useLogger`, `createLogger`, and `createError` from `c8y-nitro/utils`. `useLogger(event)` requires the H3Event; `createLogger(ctx?)` is for standalone/background contexts and requires a manual `log.emit()` call; no additional module setup is needed in `nitro.config.ts`.
- **Structured errors** — always use `createError` from `c8y-nitro/utils` (re-exported from `evlog`) instead of Nitro/h3's built-in `createError`. This ensures the `why`, `fix`, and `link` fields are captured in the wide log event and returned in the JSON response under a `data` key.
- **Logging test pattern** — Use `consola.mockTypes()` + `consola.wrapAll()` in `it.sequential` tests, then `consola.restoreAll()` in a `finally` block. Capturing logs with `vi.fn((context) => logs.push(String(context)))` is fine when passed through `consola.mockTypes()`. Wait 100ms after the request for async log emission before asserting on `logOutput`.
- **Server fixture test dependency** — `tests/server/fixture/` exercises the built package. After changing module/runtime behavior used by fixture tests, run `pnpm build` before running those tests or the fixture server may still use stale output.
- **Nitro workspace version alignment** — Keep `pnpm-workspace.yaml`'s Nitro catalog version aligned with the package-level Nitro version before diagnosing Nitro type or cache helper behavior. A catalog mismatch can leave the workspace on an older Nitro build and make cache helper typings or runtime assumptions look wrong.
- **Nitro cache typing gap** — In Nitro `3.0.260429-beta`, `defineCachedFunction()` runtime/docs expose `.invalidate()` and `.resolveKeys()`, but Nitro's exported TypeScript declaration still returns a plain cached function signature without those helper members. When using Nitro's built-in cache invalidation helpers from TypeScript, keep a narrow local cast around the cached function until Nitro updates its type declarations.
- **Scheduled task test pattern** — Enable `experimental.tasks: true` in the fixture config and place a real Nitro task in `tests/server/fixture/tasks/` so Nitro auto-registers it; do not add a manual `tasks` handler path unless the test specifically needs one. Nitro derives task names from file paths, so use nested paths like `tasks/scheduler/log.ts` for `scheduler:log`. Schedule it through a route using `scheduleTask()`, assert all captured logs do not contain the task marker immediately after the request, then sleep until `runAt` plus a generous buffer and assert the marker appears. Do not use `vi.waitFor()` for this built fixture timing check. Reuse an existing fixture server `describe` block when possible instead of adding another server setup just for scheduler coverage. Use `consola.mockTypes()` + `consola.wrapAll()` for log assertions, and make fixture tasks log through the standalone `createLogger()` utility so task logs use the same consola-backed logging path as the app.
- **Shared fixture cache tests** — When adding cache-expiration coverage to an existing shared server describe block, prefer introducing a dedicated manifest-defined tenant option key used only by that test instead of reusing a key that other assertions depend on. This avoids cross-test state coupling while still saving the extra server startup/teardown cost.
- **Lifecycle hook fixture tests** — Reuse an existing shared fixture server `describe` block when the required mock data already matches instead of creating another `beforeAll`/`afterAll` server pair. For credential lifecycle coverage, prefer one fixture plugin that records hook events plus two routes: one route that reads/mutates/refreshes the credential cache through query params and one route that returns/clears recorded hook events. When asserting credential lifecycle behavior, verify both sides: unchanged refreshes should not emit the hook, while adding a tenant, removing a tenant, or replacing one tenant id with another should emit exactly one event.

- Utility functions accept `H3Event | ServerRequest` for flexibility
- Use `defineCachedFunction` from Nitro for cached API calls (e.g., credentials)
  - Always include `invalidate` and `refresh` helper functions
  - Prefer Nitro/ocache's built-in cached function `.invalidate()` over manually constructing storage keys with `useStorage('cache').removeItem(...)`; manual keys are easy to get wrong when `group`, `base`, or `getKey` differ from defaults
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
- Runtime handler bundling can accidentally pull in the full `utils` dependency graph
  - If a handler only needs `createError`, import it from `src/utils/logging.ts`, not the `src/utils/index.ts` barrel
  - If a handler only needs the tenant option fetcher registry, import `src/utils/internal/tenantOptionFetchers.ts`, not `src/utils/tenantOptions.ts`
  - Otherwise Nitro may bundle `@c8y/client` into the handler chunk, which can trigger a dev worker crash like `Cannot destructure property '__extends' of 'import_tslib.default' as it is undefined`
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
