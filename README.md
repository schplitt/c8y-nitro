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
- 🔑 **Bootstrap CLI** - One command to register your microservice and get credentials

## Getting Started

### Installation

```sh
pnpm add c8y-nitro nitro@latest
```

### Development

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

## Bootstrapping Your Microservice

The `bootstrap` command registers your microservice with a Cumulocity development tenant and retrieves bootstrap credentials for local development.

### Prerequisites

Create a `.env` or `.env.local` file with your development tenant credentials:

```sh
C8Y_BASE_URL=https://your-tenant.cumulocity.com
C8Y_DEVELOPMENT_TENANT=t12345
C8Y_DEVELOPMENT_USER=your-username
C8Y_DEVELOPMENT_PASSWORD=your-password
```

### Running Bootstrap

```sh
npx c8y-nitro bootstrap
```

This command will:

1. Load your `nitro.config.ts` and build the microservice manifest
2. Check if the microservice already exists on the tenant
3. Create or update the microservice registration
4. Retrieve bootstrap credentials and write them to your `.env` or `.env.local` file

After running, your env file will contain:

```sh
C8Y_BOOTSTRAP_TENANT=t12345
C8Y_BOOTSTRAP_USER=servicebootstrap_myservice
C8Y_BOOTSTRAP_PASSWORD=<generated-password>
```

These credentials are used by the microservice at runtime to authenticate with Cumulocity.

##

## License

MIT