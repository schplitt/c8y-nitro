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

## Getting Started

### Installation

```sh
pnpm add c8y-nitro nitro@latest
```

## Usage

Configure your Cumulocity microservice in `nitro.config.ts`:

```ts
import c8y from 'c8y-nitro'

export default defineNitroConfig({
  c8y: {
    // c8y-nitro configuration options go here
  },
  modules: [c8y()],
})
```

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
C8Y_BOOTSTRAP_TENANT=t12345
C8Y_BOOTSTRAP_USER=servicebootstrap_myservice
C8Y_BOOTSTRAP_PASSWORD=<generated-password>
```

> **Manual Bootstrap**: For more control or troubleshooting, you can use the [CLI bootstrap command](#cli-commands) to manually register your microservice.

## CLI Commands

| Command     | Description                                             |
| ----------- | ------------------------------------------------------- |
| `bootstrap` | Manually register microservice and retrieve credentials |
| `roles`     | Manage user roles for development                       |

For more information, run:

```sh
npx c8y-nitro -h
```

## Utilities

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