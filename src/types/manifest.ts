export type C8YManifestOptions = Partial<Omit<C8YManifest, 'name' | 'version' | 'apiVersion' | 'key'>>

export interface C8YManifest {
  /**
   * API version (e.g., "v2", "2"). Version 2 required for enhanced container security.
   * Automatically set by the module to "v2".
   */
  apiVersion: string

  /**
   * Unique microservice key
   */
  key: string

  /**
   * Microservice name (lowercase a-z, digits, hyphens, max 23 chars).
   * Automatically populated from package.json name.
   */
  name: string

  /**
   * SemVer version (no "+" allowed). Use "-SNAPSHOT" suffix for dev builds.
   * Automatically populated from package.json version.
   */
  version: string

  /**
   * URL path prefix for your microservice endpoints.
   * Letters, digits, hyphens, dots, underscores, tildes allowed.
   * Defaults to package.json name. "my-service" results in endpoints like "/service/my-service/..."
   * @example "my-service"
   */
  contextPath?: string

  /**
   * Company/organization information.
   */
  provider: Provider

  /**
   * Billing strategy:
   * - RESOURCES: Tenants pay per usage
   * - SUBSCRIPTION: Owner pays, tenants pay flat subscription
   * @default "RESOURCES"
   */
  billingMode?: 'RESOURCES' | 'SUBSCRIPTION'

  /**
   * Container sharing strategy:
   * - MULTI_TENANT: One container serves all tenants (cost efficient)
   * - PER_TENANT: Separate container per tenant (data isolation)
   * @default "MULTI_TENANT"
   */
  isolation?: 'MULTI_TENANT' | 'PER_TENANT'

  /**
   * Auto-scaling based on CPU:
   * - NONE: Fixed instance count
   * - AUTO: Scales up/down automatically
   * @default "NONE"
   */
  scale?: 'AUTO' | 'NONE'

  /**
   * Number of container instances (1-5).
   * For AUTO scale: minimum count. Use 2+ for production.
   * @default 1
   */
  replicas?: number

  /**
   * Maximum resources (hard limits).
   * Container killed if exceeded.
   */
  resources?: Resources

  /**
   * Minimum resources (guaranteed reservation).
   * Platform ensures availability.
   */
  requestedResources?: RequestedResources

  /**
   * Runtime configuration exposed to tenants.
   * Allows customization without redeployment.
   */
  settings?: Option[]

  /**
   * Category for grouping settings (letters, digits, dots).
   * @default contextPath
   */
  settingsCategory?: string

  /**
   * Permissions granted to microservice service user.
   * Needed to access Cumulocity APIs (inventory, alarms, etc.).
   * @example ["ROLE_ALARM_READ", "ROLE_INVENTORY_ADMIN"]
   */
  requiredRoles?: string[]

  /**
   * New permissions provided by this microservice.
   * Users can be assigned these to access your endpoints.
   * @example ["ROLE_MY_SERVICE_READ", "ROLE_MY_SERVICE_ADMIN"]
   */
  roles?: string[]

  /**
   * Health check for crashed/frozen containers.
   * Fails trigger restart. Recommended for production.
   */
  livenessProbe?: Probe

  /**
   * Health check for readiness to serve traffic.
   * Fails prevent routing. Recommended for production.
   */
  readinessProbe?: Probe

  /**
   * Platform extensions (e.g., UI plugins).
   */
  extensions?: Extension[]
}

/**
 * Company/organization information.
 */
export interface Provider {
  /**
   * Company name ("c8y" for Cumulocity).
   * Defaults to package.json author ?? author.name
   */
  name: string

  /**
   * Company website.
   * Defaults to package.json author.url ?? homepage.
   */
  domain?: string

  /**
   * Support link or email.
   * Defaults to package.json bugs.url ?? bugs.email ?? author.email.
   */
  support?: string
}

/**
 * Maximum resource limits (hard caps).
 */
export interface Resources {
  /**
   * CPU cores ("1", "0.5") or millicores ("500m").
   * 1 core = 1000m. Min: "0.1" or "100m".
   * @default  "0.5"
   * @example "1" | "500m"
   */
  cpu?: string

  /**
   * Max memory before kill. Units: E, P, T, G, M, K, Ei, Pi, Ti, Gi, Mi, Ki.
   * Min: "10M".
   * @default "512M"
   * @example "1G" | "512M"
   */
  memory?: string
}

/**
 * Minimum resources (guaranteed reservation).
 */
export interface RequestedResources {
  /**
   * Min CPU guaranteed (millicores typical).
   * @default "250m".
   * @example "100m" | "250m"
   */
  cpu?: string

  /**
   * Min memory guaranteed. Units: E, P, T, G, M, K, Ei, Pi, Ti, Gi, Mi, Ki.
   * @default "256M".
   * @example "128Mi" | "256M"
   */
  memory?: string
}

/**
 * Runtime configuration option for tenants.
 */
export interface Option {
  /**
   * Unique setting identifier.
   * @example "tracker-id"
   */
  key: string

  /**
   * Initial value if not overridden.
   * @example "1234"
   */
  defaultValue?: string

  /**
   * Allow tenants to modify at runtime.
   * @default false
   */
  editable?: boolean

  /**
   * Reset editable value on microservice update.
   * @default true
   */
  overwriteOnUpdate?: boolean

  /**
   * Inherit value from owner tenant.
   * @default true
   */
  inheritFromOwner?: boolean
}

/**
 * Health check probe configuration.
 */
export interface Probe {
  /**
   * Execute command in container. Success = exit code 0.
   */
  exec?: ExecAction

  /**
   * TCP connection attempt. Success = connection established.
   */
  tcpSocket?: TCPSocketAction

  /**
   * HTTP request. Success = 200-399 status code.
   */
  httpGet?: HTTPGetAction

  /**
   * Seconds before first probe (startup grace period).
   * @default 0
   * @example 60
   */
  initialDelaySeconds?: number

  /**
   * Seconds between probes.
   * @default 10
   */
  periodSeconds?: number

  /**
   * Consecutive successes to consider healthy.
   * @default 1
   */
  successThreshold?: number

  /**
   * Seconds before probe times out.
   * @default 1
   */
  timeoutSeconds?: number

  /**
   * Consecutive failures before action (restart/stop routing).
   * @default 3
   */
  failureThreshold?: number
}

/**
 * Execute command probe.
 */
export interface ExecAction {
  /**
   * Command and arguments to execute.
   * @example ["cat", "/tmp/healthy"]
   */
  command: string[]
}

/**
 * TCP socket probe.
 */
export interface TCPSocketAction {
  /**
   * Hostname or IP to connect to.
   */
  host: string

  /**
   * Port number to connect to.
   * @default 80
   */
  port: number
}

/**
 * HTTP GET probe.
 */
export interface HTTPGetAction {
  /**
   * Hostname to connect to.
   */
  host?: string

  /**
   * URL path to request.
   * @example "/health"
   */
  path: string

  /**
   * Port to connect to.
   * @default 80
   */
  port?: number

  /**
   * Protocol to use.
   * @default "HTTP"
   */
  scheme?: 'HTTP' | 'HTTPS'

  /**
   * Custom HTTP headers.
   */
  headers?: HttpHeader[]
}

/**
 * HTTP header for probes.
 */
export interface HttpHeader {
  /**
   * Header name.
   * @example "Authorization"
   */
  name: string

  /**
   * Header value.
   * @example "Bearer token"
   */
  value: string
}

/**
 * Platform extension configuration.
 */
export interface Extension {
  /**
   * Extension type identifier.
   */
  type: string

  /**
   * Extension-specific config.
   */
  [key: string]: unknown
}
