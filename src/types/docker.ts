export interface C8yDockerOptions {
  /**
   * Base image for the generated Dockerfile.
   *
   * Use this when the default slim image is missing something the service
   * needs at runtime (e.g. CA certificates, native runtime libraries).
   * @default 'node:24-slim'
   */
  baseImage?: string

  /**
   * Raw Dockerfile instructions inserted after `WORKDIR` and before the build
   * output is copied, one instruction per entry.
   *
   * Placing them before the `COPY` keeps their layers cached across rebuilds.
   * `ENV`, `EXPOSE 80` and the `CMD` entrypoint stay under module control and
   * cannot be overridden — they are the Cumulocity microservice contract.
   *
   * @example ['RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*']
   * @default []
   */
  extraInstructions?: string[]
}
