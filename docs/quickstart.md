# Quickstart

This is the shortest path from zero to a local Cumulocity microservice.

## Before You Start

- Use Node.js 24 or newer.
- Use a Node Nitro preset such as `node-server` or `node-cluster`.
- Have access to a Cumulocity tenant for development.

## Create a Service

Scaffold a new project with [create-c8y-nitro](https://github.com/schplitt/create-c8y-nitro):

```sh
pnpm create c8y-nitro my-microservice
cd my-microservice
```

This clones the [c8y-nitro-starter](https://github.com/schplitt/c8y-nitro-starter) template, sets the package and microservice name from the directory, initializes git, and installs dependencies. Use `--name` to override the name, `--no-install` or `--no-git` to skip those steps, and `--force` to scaffold into a non-empty directory.

Or install into an existing Nitro service:

```sh
pnpm add c8y-nitro nitro@latest
```

## Enable the Module

The starter template already has this configured. For an existing Nitro service, add the module in `nitro.config.ts`:

```ts
import c8y from 'c8y-nitro'

export default defineNitroConfig({
  preset: 'node-server',
  builder: 'rolldown',
  modules: [c8y()],
})
```

## Add Development Tenant Credentials

Copy the starter's `.env.example` to `.env` (or create `.env`/`.env.local` yourself):

```sh
C8Y_BASEURL=https://your-tenant.cumulocity.com
C8Y_DEVELOPMENT_TENANT=t12345
C8Y_DEVELOPMENT_USER=your-username
C8Y_DEVELOPMENT_PASSWORD=your-password
```

## Start Developing

```sh
pnpm dev
```

On the first run, `c8y-nitro` checks the development tenant, creates or reuses the microservice, subscribes the tenant, and writes bootstrap credentials back into the env file.

## Next Steps

- Read [Configuration](/guide/configuration) to shape module behavior.
- Read [Auto-Bootstrap](/guide/auto-bootstrap) to understand development tenant setup.
- Read [Utilities](/reference/utilities) when writing tenant-aware runtime code.