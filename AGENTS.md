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
│       │   └── dev-user.ts            # Dev user injection middleware
│       └── plugins/
│           └── c8y-variables.ts       # C8Y env variable plugin
├── types/
│   ├── index.ts                # Main type exports (C8yNitroModuleOptions)
│   ├── apiClient.ts            # API client generation types
│   ├── cache.ts                # Cache configuration types
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
    ├── tenantOptions.ts        # Tenant options fetching (useTenantOption)
    └── internal/
        └── common.ts           # Internal shared utilities
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
/* eslint-disable antfu/no-top-level-await */
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

Virtual module mocking injects static data at build time. This means:

- **No runtime data changes**: You cannot modify mock data mid-test (e.g., to test cache invalidation or TTL expiration)
- **No state verification**: Cannot assert that a function wrote to the "database" or called the API a specific number of times
- **One mock per server**: Changing mock data requires building a new server instance

For testing cache behavior, TTL expiration, or stateful interactions, consider:

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
- **`README.md`** — Update with user-facing documentation for end users:
  - New configuration options (anything in `C8yNitroModuleOptions`)
  - New utilities or functions exported from `c8y-nitro/utils`
  - New CLI commands or features
  - Changes to existing API behavior
  - Environment variables that users can set
  - Any feature that users can configure, use, or interact with

### When to Update Documentation (Critical - Always Consider)

**ALWAYS check if documentation needs updating after:**

1. **Adding a new utility function** → Update README.md utilities section with function name, description, and example
   - Example: Adding `useTenantOption()` requires adding it to the utilities table and showing usage examples

2. **Adding a new configuration option** → Update README.md configuration section and relevant examples
   - Example: Adding `cache.tenantOptions` requires updating the Cache Configuration section with examples

3. **Adding a new type that users configure** → Update README.md with JSDoc and configuration examples
   - Example: Adding `C8yTenantOptionsCacheConfig` requires documenting it in cache configuration

4. **Creating a new file in `src/types/`** → Update AGENTS.md architecture diagram
   - Example: Creating `tenantOptions.ts` requires adding it to the types list in the architecture section

5. **Creating a new file in `src/utils/`** → Update AGENTS.md architecture diagram
   - Example: Creating `tenantOptions.ts` requires adding it to the utils list in the architecture section

6. **Discovering a pattern that should be documented** → Update AGENTS.md "Patterns & Conventions" or "Common Mistakes to Avoid"
   - Example: Learning that types should be imported from `'c8y-nitro/types'` instead of relative paths

7. **User corrects how something should be done** → Update AGENTS.md "Project Context & Learnings"
   - Example: Learning that Nitro v3 requires explicit imports from `'nitro/h3'`

8. **Adding a new environment variable** → Update README.md with the variable name and description
   - Example: Adding `NITRO_C8Y_DEFAULT_TENANT_OPTIONS_TTL` requires documenting it in the cache section

9. **Changing how a utility works** → Update README.md utility documentation and JSDoc
   - Example: Adding cache invalidation methods requires updating the utility's documentation

10. **Adding support for new functionality** → Update README.md features and usage sections
    - Example: Adding tenant options support requires a new section explaining the feature

**Documentation Update Checklist:**

- [ ] Did I add/change a utility? → Update README.md utilities section
- [ ] Did I add/change a config option? → Update README.md configuration section
- [ ] Did I add/change a type? → Update README.md and JSDoc with examples
- [ ] Did I add/change a file? → Update AGENTS.md architecture diagram
- [ ] Did I learn a pattern? → Update AGENTS.md patterns/conventions
- [ ] Did I add an env variable? → Update README.md with env var documentation
- [ ] At the end of my response: Did I explicitly notify the user of documentation changes?

**Remember:** Documentation is NOT optional. Treat it as part of the implementation, not an afterthought.

## Agent Guidelines

When working on this project:

1. **Run tests** after making changes: `pnpm test:run` (runs once, no watch mode)
2. **Run linting** to ensure code quality: `pnpm lint`
3. **Run type checking** before committing: `pnpm typecheck`
4. **Maintain exports** — Public APIs in `src/index.ts`, types in `src/types/index.ts`, utils in `src/utils/index.ts`
5. **Add tests** for new functionality in the `tests/` directory
6. **Test in playground** — Use `playground/` to verify changes work in a real microservice context
7. **Record learnings** — When the user corrects a mistake or provides context about how something should be done, add it to the "Project Context & Learnings" section below if it's a recurring pattern (not a one-time fix)
8. **Notify documentation changes** — When updating `README.md` or `AGENTS.md`, explicitly call out the changes to the user at the end of your response so they can review and don't overlook them

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
- **Logging test pattern** — Use `consola.mockTypes()` + `consola.wrapAll()` in `it.sequential` tests, then `consola.restoreAll()` in a `finally` block. Wait 100ms after the request for async log emission before asserting on `logOutput`.

- Utility functions accept `H3Event | ServerRequest` for flexibility
- Use `defineCachedFunction` from Nitro for cached API calls (e.g., credentials)
  - Always include `invalidate` and `refresh` helper functions
  - Carefully consider what requests make sense to be cached (e.g., credentials, not real-time data, consider security implications)
  - For per-key caching (like tenant options), use a factory pattern with a Map/Record to store fetchers
  - `maxAge` does NOT accept a function — if you need per-key TTL, create separate cached functions per key
- Generated types are consolidated into a single `c8y-nitro.d.ts` file for performance
  - Written to `node_modules/.nitro/types/` by `setupRuntime()`
  - Augments `c8y-nitro/types` and `c8y-nitro/runtime` modules
- Virtual module `c8y-nitro/runtime` exports runtime values (roles, tenant option keys)
  - Use `as const` for tuples to preserve literal types
  - Keep `src/runtime.d.ts` in sync as a fallback declaration
- Auto-injected routes use `/_c8y_nitro/` prefix to avoid conflicts with user routes
- Runtime handlers/middleware/plugins must be in `src/module/runtime/` directory structure:
  - `runtime/handlers/` — Event handlers (e.g., probe endpoints)
  - `runtime/middlewares/` — Global middlewares (e.g., dev user injection)
  - `runtime/plugins/` — Nitro plugins (e.g., env variable validation)
  - These locations are required for the module to correctly register them

### Common Mistakes to Avoid

- Don't forget to add new utilities to the appropriate `index.ts` export file
- **Always update documentation** when changing utilities or configuration:
  - JSDoc comments in source code (with `@config` tag for configurable values showing how to set them)
  - `README.md` for user-facing changes (configuration options, utilities, env variables, API behavior)
  - `AGENTS.md` for technical/architectural changes relevant to AI agents
  - Explicitly notify the user of documentation updates at the end of your response
- **Use package imports for augmentable types** — When a type is augmented by generated types (e.g., `C8YTenantOptionKey`, `C8YTenantOptionKeysCacheConfig`), import from `'c8y-nitro/types'` instead of relative paths. This ensures users benefit from type hints after types are generated. It may cause initial type errors before first build, but resolves after `nitro prepare`.
  - Explicitly notify the user of documentation updates at the end of your response
