# c8y-nitro

Lightning fast Cumulocity IoT microservice development powered by [Nitro](https://v3.nitro.build).

## Features

- ⚡️ **Lightning Fast** - Built on Nitro's high performance engine
- 🔧 **Fully Configurable** - Everything configured via module options
- 🐳 **Auto Docker Build** - Automatically generates Docker images and microservice zip files
- 📋 **Auto cumulocity.json** - Generates Cumulocity manifest automatically
- 🎯 **API Client Generation** - Creates Cumulocity-compatible Angular API clients
- 🚀 **Hot Module Reload** - Instant feedback during development
- 📦 **Universal Deployment** - Deploy anywhere Nitro runs (Workers, Node.js, Docker)
- 🔥 **File-based Routing** - Auto-discovered routes from your file structure
- 🛠️ **TypeScript First** - Full type safety with excellent DX

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
  modules: [c8y(
    /**
     * Configuration options
     */
  )],
})
```

## License

MIT