# c8y-nitro

Lightning fast Cumulocity IoT microservice development powered by [Nitro](https://v3.nitro.build).

## Features

- ⚡️ **Lightning Fast** - Built on Nitro's high performance engine
- 🔧 **Fully Configurable** - Everything configured via module options
- 📁 **Auto Zip Creation** - Automatically generates the deployable microservice zip
- 🎯 **API Client Generation** - Creates Cumulocity-compatible Angular API clients
- 📦 **Built-in Probes** - Automatic setup for liveliness and readiness probes
- 🚀 **Hot Module Reload** - Instant feedback during development
- 🔥 **File-based Routing** - Auto-discovered routes from your file structure
- 🛠️ **TypeScript First** - Full type safety with excellent DX
- 🔄 **Auto-Bootstrap** - Automatically registers and configures your microservice in development

## Installation

```sh
pnpm add c8y-nitro nitro@latest
```

> **Note**: `@c8y/client` (`^1023.4.11` / 2026-lts) is bundled with c8y-nitro and cannot be used directly under its own export because it contains invalid ESM exports. If you need to use it, import from `c8y-nitro/client` instead.

## Usage

Configure your Cumulocity microservice in `nitro.config.ts`:

```ts
import c8y from 'c8y-nitro'

export default defineNitroConfig({
  preset: 'node-server', // or "node-cluster", Required!
  experimental: {
    asyncContext: true // Required!
  },
  builder: 'rolldown', // Recommended!
  c8y: {
    // c8y-nitro configuration options go here
  },
  modules: [c8y()],
})
```

### Prerequisites

`c8y-nitro` requires:

- `preset` - must be a node preset (`node-server` or `node-cluster`)
- `experimental.asyncContext: true` - required for request context handling

**Optional but recommended:**

- `builder: 'rolldown'` - for faster build times

## Getting Started

Create a `.env` or `.env.local` file with your development tenant credentials:

```sh
C8Y_BASEURL=https://your-tenant.cumulocity.com
C8Y_DEVELOPMENT_TENANT=t12345
C8Y_DEVELOPMENT_USER=your-username
C8Y_DEVELOPMENT_PASSWORD=your-password
```

Then simply run `pnpm dev` - that's it! The module will automatically:

1. Check if the microservice exists on the tenant
2. Create it if needed (or use existing one without overwriting)
3. Subscribe your tenant to the microservice
4. Retrieve and save bootstrap credentials to your env file

After auto-bootstrap, your env file will contain:

```sh
C8Y_BOOTSTRAP_TENANT=<bootstrap-tenant-id>
C8Y_BOOTSTRAP_USER=<bootstrap-username>
C8Y_BOOTSTRAP_PASSWORD=<generated-password>
```

> **Manual Bootstrap**: For more control or troubleshooting, you can use the [CLI bootstrap command](#cli-commands) to manually register your microservice.

## Automatic Zip Creation

`c8y-nitro` automatically generates a ready-to-deploy microservice zip package after each build. The process includes:

1. **Dockerfile Generation** - Creates an optimized Dockerfile using Node.js 22-slim
2. **Docker Image Build** - Builds and saves the Docker image to `image.tar`
3. **Manifest Generation** - Creates `cumulocity.json` from your package.json and configuration
4. **Zip Package** - Combines `image.tar` and `cumulocity.json` into a deployable zip file

> **Note**: Docker must be installed and available in your PATH.

The generated zip file (default: `<package-name>-<version>.zip` in root directory) is ready to upload directly to Cumulocity.

## Manifest Configuration

The `cumulocity.json` manifest is automatically generated from your `package.json` and can be customized via the `manifest` option.

**Auto-generated from package.json:**

- `name` (scope stripped), `version` - from package fields
- `provider.name` - from `author` field
- `provider.domain` - from `author.url` or `homepage`
- `provider.support` - from `bugs` or `author.email`
- `contextPath` - defaults to package name

For all available manifest options, see the [Cumulocity Microservice Manifest documentation](https://cumulocity.com/docs/microservice-sdk/general-aspects/#microservice-manifest).

> **Note**: Custom roles defined in the manifest are automatically available as TypeScript types for use in middleware and runtime code during development.

> **Note**: Health probe endpoints (`/_c8y_nitro/liveness` and `/_c8y_nitro/readiness`) are automatically injected if not manually defined.

## Development User Injection

During development, `c8y-nitro` automatically injects your development user credentials into all requests. This allows you to test authentication and authorization middlewares locally.

The module uses the development credentials from your `.env` file:

```sh
C8Y_DEVELOPMENT_TENANT=t12345
C8Y_DEVELOPMENT_USER=your-username
C8Y_DEVELOPMENT_PASSWORD=your-password
```

This enables testing of access control middlewares like `hasUserRequiredRole()` and `isUserFromAllowedTenant()` without needing to manually set authorization headers.

### Managing Development User Roles

Use the [CLI roles command](#cli-commands) to assign or remove your microservice's custom roles to your development user:

```sh
npx c8y-nitro roles
```

This interactive command lets you select which roles from your manifest to assign to your development user for testing.

## API Client Generation

For monorepo architectures, `c8y-nitro` can generate TypeScript Angular services that provide fully typed access to your microservice routes.

### Configuration

```ts
export default defineNitroConfig({
  c8y: {
    apiClient: {
      dir: '../ui/src/app/services', // Output directory for generated client
      contextPath: 'my-service' // Optional: override context path
    }
  },
  modules: [c8y()],
})
```

### Generated Client

The generated service creates one method per route with automatic type inference:

```ts
// Generated: my-serviceAPIClient.ts
@Injectable({ providedIn: 'root' })
export class GeneratedMyServiceAPIClient {
  async GETHealth(): Promise<{ status: string }> { }
  async GETUsersById(params: { id: string | number }): Promise<User> { }
  async POSTUsers(body: CreateUserDto): Promise<User> { }
}
```

### Usage in Angular

```ts
import { GeneratedMyServiceAPIClient } from './services/my-serviceAPIClient'

@Component({
  /**
   * ...
   */
})
export class MyComponent {
  private api = inject(GeneratedMyServiceAPIClient)

  async ngOnInit() {
    const health = await this.api.GETHealth()
    const user = await this.api.GETUsersById({ id: 123 })
  }
}
```

> **Note**: The client regenerates automatically when routes change during development.

## Utilities

`c8y-nitro` provides several utility functions to simplify common tasks in Cumulocity microservices.

To use these utilities, simply import them from `c8y-nitro/utils`:

```ts
import { useUser, useUserClient } from 'c8y-nitro/utils'
```

### Credentials

| Function                           | Description                                               | Request Context |
| ---------------------------------- | --------------------------------------------------------- | :-------------: |
| `useSubscribedTenantCredentials()` | Get credentials for all subscribed tenants (cached 10min) |       ❌        |
| `useDeployedTenantCredentials()`   | Get credentials for the deployed tenant (cached 10 min)   |       ❌        |
| `useUserTenantCredentials()`       | Get credentials for the current user's tenant             |       ✅        |

> **Note**: `useDeployedTenantCredentials()` shares its cache with `useSubscribedTenantCredentials()`. Both functions support `.invalidate()` and `.refresh()` methods. Invalidating or refreshing one will affect the other.

### Resources

| Function         | Description                        | Request Context |
| ---------------- | ---------------------------------- | :-------------: |
| `useUser()`      | Fetch current user from Cumulocity |       ✅        |
| `useUserRoles()` | Get roles of the current user      |       ✅        |

### Client

| Function                       | Description                                         | Request Context |
| ------------------------------ | --------------------------------------------------- | :-------------: |
| `useUserClient()`              | Create client authenticated with user's credentials |       ✅        |
| `useUserTenantClient()`        | Create client for user's tenant (microservice user) |       ✅        |
| `useSubscribedTenantClients()` | Create clients for all subscribed tenants           |       ❌        |
| `useDeployedTenantClient()`    | Create client for the deployed tenant               |       ❌        |

### Middleware

| Function                                   | Description                               | Request Context |
| ------------------------------------------ | ----------------------------------------- | :-------------: |
| `hasUserRequiredRole(role\|roles)`         | Check if user has required role(s)        |       ✅        |
| `isUserFromAllowedTenant(tenant\|tenants)` | Check if user is from allowed tenant(s)   |       ✅        |
| `isUserFromDeployedTenant()`               | Check if user is from the deployed tenant |       ✅        |

## CLI Commands

| Command     | Description                                             |
| ----------- | ------------------------------------------------------- |
| `bootstrap` | Manually register microservice and retrieve credentials |
| `roles`     | Manage development user roles                           |

For more information, run:

```sh
npx c8y-nitro -h
```

## Development

```sh
# Install dependencies
pnpm install

# Run dev watcher
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test
```

## License

MIT