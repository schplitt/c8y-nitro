# c8y-nitro

Nitro-powered tooling for building Cumulocity IoT microservices without manually stitching together bootstrap, manifest generation, packaging, and tenant-aware runtime helpers.

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

## Quickstart

Start with the [Quickstart docs](https://schplitt.github.io/c8y-nitro/quickstart).

## Documentation

Full documentation is available at [schplitt.github.io/c8y-nitro](https://schplitt.github.io/c8y-nitro/).

Useful entry points:

- [What is c8y-nitro?](https://schplitt.github.io/c8y-nitro/guide/what-is-c8y-nitro)
- [Configuration](https://schplitt.github.io/c8y-nitro/guide/configuration)
- [Module Options](https://schplitt.github.io/c8y-nitro/reference/module-options)
- [Utilities](https://schplitt.github.io/c8y-nitro/reference/utilities)

## Development

For contributors working on this repository:

```sh
pnpm install
pnpm dev
pnpm build
pnpm test:run
pnpm lint
pnpm typecheck
pnpm docs:build
```

Use `pnpm dev` for the package watcher, `pnpm docs:dev` for the VitePress site, and check the full contributor-facing behavior in the docs plus <AGENTS.md>.

## License

Use `pnpm dev` for the package watcher, `pnpm docs:dev` for the VitePress site, and check the full contributor-facing behavior in the docs plus <AGENTS.md>.
