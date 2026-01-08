# Copilot Instructions

## About This Project

c8y-nitro is a Nitro module for lightning-fast Cumulocity IoT microservice development. It automates Docker builds, generates cumulocity.json manifests, creates microservice zip files, and can generate Angular API clients.

## Project Setup

- **Install**: `pnpm install`
- **Build**: `pnpm build` (uses tsdown)
- **Test**: `pnpm test` (Vitest)
- **Lint**: `pnpm lint` or `pnpm lint:fix`
- **Type Check**: `pnpm typecheck`

## Architecture

- **src/**: Main module code (exports Nitro module)

## Key Dependencies

- **nitro**: 3.0.1-alpha.1 (core framework)
- **tsdown**: Build tool
- **vitest**: Testing framework
