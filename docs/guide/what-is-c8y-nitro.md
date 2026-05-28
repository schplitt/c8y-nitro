# What Is c8y-nitro?

`c8y-nitro` is a Nitro module for building Cumulocity IoT microservices without re-solving the platform integration layer every time.

If you already like Nitro's file-based routing, server utilities, and runtime model, this package adds the Cumulocity-specific pieces that usually sit around your app instead of inside it.

## What Problem It Solves

Building a Cumulocity microservice is rarely just writing route handlers. You also need to deal with:

- bootstrap credentials and tenant registration,
- a valid `cumulocity.json` manifest,
- probe routes and deployment packaging,
- multi-tenant credential access,
- tenant option loading,
- development-time user simulation,
- and often a client layer for a separate Angular UI.

`c8y-nitro` pulls those concerns into a single Nitro-native workflow.

## What You Still Build Yourself

This package does not try to replace your service logic.

You still build:

- your routes,
- your business logic,
- your domain types,
- your task handlers,
- and your UI, if you have one.

The module handles the platform plumbing around them.

## When It Fits Well

`c8y-nitro` is a good fit when:

- you want Nitro as the server foundation,
- you deploy as a Cumulocity microservice,
- you want packaging and bootstrap automated,
- and you want runtime helpers that already understand tenant-aware execution.

It is less interesting if you only need a plain Node service or if your deployment pipeline is completely outside the Cumulocity microservice model.

## Core Capabilities

### Development workflow

In local development, the module can register the microservice, subscribe the tenant, and persist bootstrap credentials so you can focus on the actual service.

### Packaging workflow

On build, it can generate the manifest, build the Docker image, and emit the deployable zip artifact expected by Cumulocity.

### Runtime utilities

At runtime, it gives you helpers for user context, credentials, tenant options, authorization checks, structured logging, and one-shot task scheduling.

### Typed surface

Roles, tenant option keys, and configuration all stay close to TypeScript instead of becoming loosely documented conventions.

## Recommended Reading Order

1. [Quickstart](/quickstart)
2. [Configuration](/guide/configuration)
3. [Manifest & Probes](/guide/manifest)
4. [Utilities](/reference/utilities)