# Development User Injection

During local dev, `c8y-nitro` can inject the configured development user into requests so role checks and tenant checks behave like a real authenticated call.

## Setup

The module uses the development credentials from your `.env` file:

```sh
C8Y_DEVELOPMENT_TENANT=t12345
C8Y_DEVELOPMENT_USER=your-username
C8Y_DEVELOPMENT_PASSWORD=your-password
```

This enables testing of access control middlewares like `hasUserRequiredRole()` and `isUserFromAllowedTenant()` without needing to manually set authorization headers.

The development user is only injected when the request has no `authorization` header. A request that sends its own header keeps it, so you can call your service as another user, a device, or a user of a subscribed subtenant:

```sh
curl -u 't222/device_abc:secret' http://localhost:3000/api/measurements
```

## When To Turn It Off

Disable this when another local layer already provides the real auth context, for example a local proxy or gateway setup that forwards the incoming user session.

## Disabling

If you run a local proxy that already forwards a user session or authorization header, disable this middleware:

```ts
export default defineConfig({
  c8y: {
    dev: {
      injectUser: false,
    },
  },
  modules: [c8y()],
})
```

When disabled, `c8y-nitro` does not register the development user injection middleware, so incoming auth headers stay untouched.

## Managing Development User Roles

Use the [CLI roles command](/reference/cli#roles) to assign or remove your microservice's custom roles to your development user:

```sh
pnpm dlx c8y-nitro roles
```

This interactive command lets you select which roles from your manifest to assign to your development user for testing.
