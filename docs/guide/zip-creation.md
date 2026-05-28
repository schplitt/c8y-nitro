# Automatic Zip Creation

`c8y-nitro` turns a normal build into a Cumulocity-ready artifact pipeline.

Instead of treating packaging as a separate script you have to remember, the module runs it as part of the Nitro lifecycle when the app closes outside dev mode.

## Process

1. **Dockerfile Generation** — Creates an optimized Dockerfile using Node.js 24-slim
2. **Docker Image Build** — Builds and saves the Docker image to `image.tar`
3. **Manifest Generation** — Creates `cumulocity.json` from your `package.json` and configuration
4. **Zip Package** — Combines `image.tar` and `cumulocity.json` into a deployable zip file

> **Note**: Docker must be installed and available in your PATH.

The generated zip file (default: `<package-name>-<version>.zip` in the root directory) is ready to upload directly to Cumulocity.

## Customizing Output

Use the `zip` options when you want to change the artifact name, output directory, or packaging-time manifest overrides.
