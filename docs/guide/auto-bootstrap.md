# Auto-Bootstrap

Auto-bootstrap is the development convenience layer that makes the first `pnpm dev` feel like a working microservice setup instead of a manual registration exercise.

## What It Does

When enabled, the module will:

1. Check if the microservice exists on the tenant
2. Create it if needed (or use existing one without overwriting)
3. Subscribe your tenant to the microservice
4. Retrieve and save bootstrap credentials to your env file

## Setup

Create a `.env` or `.env.local` file with your development tenant credentials:

```sh
C8Y_BASEURL=https://your-tenant.cumulocity.com
C8Y_DEVELOPMENT_TENANT=t12345
C8Y_DEVELOPMENT_USER=your-username
C8Y_DEVELOPMENT_PASSWORD=your-password
```

Then run `pnpm dev`.

After auto-bootstrap, your env file will contain:

```sh
C8Y_BOOTSTRAP_TENANT=<bootstrap-tenant-id>
C8Y_BOOTSTRAP_USER=<bootstrap-username>
C8Y_BOOTSTRAP_PASSWORD=<generated-password>
```

## Why You Might Disable It

Disable auto-bootstrap when:

- CI should never mutate a tenant,
- bootstrap is managed by a separate operational process,
- or you are troubleshooting registration behavior and want fully manual control.

## Disabling Auto-Bootstrap

Set `skipBootstrap: true` in your c8y config to disable auto-bootstrap entirely. This is useful in CI/CD pipelines or when you want to manage bootstrap manually.

```ts
export default defineNitroConfig({
  c8y: {
    skipBootstrap: true,
  },
  modules: [c8y()],
})
```

## Manual Bootstrap

For more control or troubleshooting, use the [CLI bootstrap command](/reference/cli#bootstrap) to manually register your microservice.
