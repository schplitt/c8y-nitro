import process from 'node:process'
import { Buffer } from 'node:buffer'
import { useRuntimeConfig } from 'nitro/runtime-config'
import type { C8yTestState, C8yTestUser, C8yRequest, C8yRequestHandler, C8yTestSubscription, C8yUnhandledRequest, UnhandledRequestStrategy } from './types'
import type { CompiledRoute } from './router'
import { DEFAULTS } from './defaults'
import { compileRoute, matchRoute, splitPath } from './router'
import { store } from './store'
import { platformApi, UnsupportedRequestError } from './api'
import { apiError, rawRequests } from './api/http'

interface RegisteredHandler {
  route: CompiledRoute
  pattern: string
  handler: C8yRequestHandler
  once: boolean
}

/**
 * The in-memory Cumulocity tenant behind `c8y` in `c8y-nitro/testing`.
 * One instance per test file (Vitest isolates modules per file).
 */
export const platform = {
  baseline: {} as C8yTestState,
  tenant: DEFAULTS.tenant as string,
  user: null as C8yTestUser | null,
  subscriptions: [] as C8yTestSubscription[],
  /**
   * `${tenant}\u0000${category}\u0000${key}` → value
   */
  options: new Map<string, string>(),
  handlers: [] as RegisteredHandler[],
  calls: [] as C8yRequest[],
  unhandled: [] as C8yUnhandledRequest[],
  onUnhandledRequest: 'error' as UnhandledRequestStrategy,
  /**
   * Requests being answered right now.
   */
  inflight: 0,

  /**
   * Sets the deployed tenant, subscriptions, and default user from the
   * baseline before the Nitro app starts, so plugins that run at startup (e.g.
   * realtime subscriptions) find credentials. Tenant options are applied by
   * `reset()` once the app's runtime config exists.
   * @param baseline - Plugin options
   */
  prepare(baseline: C8yTestState) {
    this.baseline = baseline
    this.tenant = baseline.tenant ?? DEFAULTS.tenant
    this.subscriptions = (baseline.subscriptions ?? [defaultSubscription(this.tenant)]).map((subscription) => ({ ...subscription }))
    this.setUser(baseline.user === undefined ? DEFAULTS.user : baseline.user)
  },

  /**
   * Restores the baseline from the plugin config.
   */
  reset() {
    this.tenant = this.baseline.tenant ?? DEFAULTS.tenant
    this.user = null
    this.subscriptions = []
    this.options.clear()
    this.handlers = []
    this.calls = []
    this.unhandled = []
    store.reset()
    this.onUnhandledRequest = this.baseline.onUnhandledRequest ?? 'error'
    this.apply({
      user: this.baseline.user === undefined ? DEFAULTS.user : this.baseline.user,
      subscriptions: this.baseline.subscriptions ?? [defaultSubscription(this.tenant)],
      tenantOptions: this.baseline.tenantOptions,
    })
  },

  /**
   * Applies a partial state on top of the current one.
   * @param state - Partial tenant state
   */
  apply(state: Partial<C8yTestState>) {
    if (state.tenant !== undefined) {
      this.tenant = state.tenant
    }
    if (state.user !== undefined) {
      this.setUser(state.user)
    }
    if (state.subscriptions !== undefined) {
      this.subscriptions = state.subscriptions.map((subscription) => ({ ...subscription }))
    }
    for (const [key, value] of Object.entries(state.tenantOptions ?? {})) {
      this.setOption(key, value)
    }
    if (state.onUnhandledRequest !== undefined) {
      this.onUnhandledRequest = state.onUnhandledRequest
    }
    syncEnv()
  },

  setUser(user: C8yTestUser | null) {
    this.user = user ? { ...user, roles: [...(user.roles ?? [])] } : null
    syncEnv()
  },

  setOption(key: string, value: string, opts: { category?: string, tenant?: string } = {}) {
    this.options.set(optionId(opts.tenant ?? this.tenant, opts.category ?? ownCategory(), key), value)
  },

  getOption(key: string, opts: { category?: string, tenant?: string } = {}): string | undefined {
    return this.options.get(optionId(opts.tenant ?? this.tenant, opts.category ?? ownCategory(), key))
  },

  deleteOption(key: string, opts: { category?: string, tenant?: string } = {}): boolean {
    return this.options.delete(optionId(opts.tenant ?? this.tenant, opts.category ?? ownCategory(), key))
  },

  override(pattern: string, handler: C8yRequestHandler, once = false): () => void {
    const entry: RegisteredHandler = { route: compileRoute(pattern), pattern, handler, once }
    this.handlers.push(entry)
    return () => {
      this.handlers = this.handlers.filter((item) => item !== entry)
    }
  },

  /**
   * Answers a request the real `@c8y/client` would send to the platform.
   * @param request - Request built by the patched FetchClient
   */
  async fetch(request: Request): Promise<Response> {
    this.inflight++
    try {
      return await this.answer(request)
    } finally {
      this.inflight--
    }
  },

  async answer(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const method = request.method.toUpperCase()
    const segments = splitPath(url.pathname).map(decodeURIComponent)
    const path = `/${segments.join('/')}`
    const caller = parseBasicAuth(request.headers.get('authorization'))
    const bytes = request.body ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array()
    const contentType = request.headers.get('content-type') ?? ''
    const isBinary = contentType.startsWith('multipart/') || contentType.includes('octet-stream')
    const text = bytes.length > 0 && !isBinary ? new TextDecoder().decode(bytes) : ''
    let body: unknown = text || undefined
    try {
      body = text ? JSON.parse(text) : undefined
    } catch {
      // keep text body
    }
    const call: C8yRequest = {
      method,
      path,
      query: Object.fromEntries(url.searchParams),
      body,
      headers: Object.fromEntries(request.headers),
      tenant: url.searchParams.get('targetTenant') ?? caller?.tenant ?? this.tenant,
      user: caller?.user,
      params: {},
    }
    this.calls.push(call)
    rawRequests.set(call, { bytes, contentType, params: url.searchParams })

    // user handlers first, most recently registered wins
    for (let i = this.handlers.length - 1; i >= 0; i--) {
      const entry = this.handlers[i]!
      const params = matchRoute(entry.route, method, segments)
      if (!params) {
        continue
      }
      if (entry.once) {
        this.handlers.splice(i, 1)
      }
      const result = await entry.handler({ ...call, params, request })
      return toResponse(result)
    }

    const builtIn = builtInRoute(call, segments)
    if (builtIn) {
      return builtIn
    }

    let reason = 'endpoint not emulated'
    try {
      const response = await platformApi(call, segments, store.tenant(call.tenant))
      if (response) {
        return response
      }
    } catch (error) {
      if (!(error instanceof UnsupportedRequestError)) {
        throw error
      }
      reason = error.message
    }

    const unhandled: C8yUnhandledRequest = { ...call, reason }
    this.unhandled.push(unhandled)
    if (this.onUnhandledRequest === 'warn') {
      console.warn(unhandledMessage([unhandled]))
    }
    return apiError(501, 'c8y-nitro/testing/unsupported', `${method} ${path}: ${reason} by the c8y-nitro/testing fake tenant. Answer it with c8y.override('${method} ${path}', ...).`)
  },
}

export function unhandledMessage(calls: C8yUnhandledRequest[]): string {
  return [
    `c8y-nitro/testing: ${calls.length} Cumulocity request(s) the fake tenant does not support:`,
    ...calls.map((call) => `  ${call.method} ${call.path} (${call.reason})`),
    'Answer them with c8y.override(\'METHOD /path\', handler) (see "What the fake emulates" in the testing guide), or set onUnhandledRequest to \'warn\' or \'ignore\'.',
  ].join('\n')
}

function defaultSubscription(tenant: string): C8yTestSubscription {
  return { tenant, user: `service_${tenant}`, password: 'service-password' }
}

function optionId(tenant: string, category: string, key: string): string {
  return `${tenant}\u0000${category}\u0000${key}`
}

function ownCategory(): string {
  return useRuntimeConfig().c8ySettingsCategory as string
}

/**
 * Keeps the dev and bootstrap env in sync with the tenant and current user.
 */
function syncEnv() {
  process.env.C8Y_BOOTSTRAP_TENANT = platform.tenant
  process.env.C8Y_DEVELOPMENT_TENANT = platform.user?.tenant ?? platform.tenant
  process.env.C8Y_DEVELOPMENT_USER = platform.user?.userName ?? DEFAULTS.user.userName
}

function parseBasicAuth(header: string | null): { tenant?: string, user: string } | undefined {
  if (!header?.startsWith('Basic ')) {
    return undefined
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString()
  const login = decoded.slice(0, decoded.indexOf(':'))
  const slash = login.indexOf('/')
  return slash === -1 ? { user: login } : { tenant: login.slice(0, slash), user: login.slice(slash + 1) }
}

function toResponse(result: unknown): Response {
  if (result instanceof Response) {
    return result
  }
  if (result === undefined) {
    return new Response(null, { status: 204 })
  }
  return Response.json(result)
}

function optionNotFound(category: string, key: string): Response {
  return apiError(404, 'options/Not Found', `Unable to find option by given key: ${category}/${key}`)
}

/**
 * `credentials.` options are encrypted: reads show `<<Encrypted>>`, except for
 * the microservice's own settings category, which the platform decrypts for
 * the service (verified against the platform for other categories).
 * @param category - Option category
 * @param key - Option key
 * @param value - Stored value
 */
function readableOption(category: string, key: string, value: string): string {
  return key.startsWith('credentials.') && category !== ownCategory() ? '<<Encrypted>>' : value
}

function encrypted(key: string, value: string): string {
  return key.startsWith('credentials.') ? Buffer.from(`fake-cipher:${value}`).toString('hex') : value
}

/**
 * Platform endpoints that c8y-nitro itself relies on.
 * @param call - The recorded request
 * @param segments - Decoded path segments
 */
function builtInRoute(call: C8yRequest, segments: string[]): Response | undefined {
  const { method } = call
  const [a, b, category, key, editable] = segments

  if (method === 'GET' && a === 'user' && b === 'currentUser' && segments.length === 2) {
    const user = platform.user
    if (!user) {
      return Response.json({ error: 'security/Unauthorized', message: 'Invalid credentials!' }, { status: 401 })
    }
    const { roles = [], tenant: _tenant, ...rest } = user
    return Response.json({
      id: user.userName,
      ...rest,
      effectiveRoles: roles.map((name) => ({ id: name, name })),
    })
  }

  if (method === 'GET' && a === 'tenant' && b === 'currentTenant' && segments.length === 2) {
    return Response.json({ name: call.tenant, domainName: new URL(process.env.C8Y_BASEURL || DEFAULTS.baseUrl).host })
  }

  if (method === 'GET' && a === 'application' && b === 'currentApplication' && category === 'subscriptions' && segments.length === 3) {
    return Response.json({
      users: platform.subscriptions.map(({ tenant, user, password }) => ({ tenant, name: user, password })),
    })
  }

  if (a === 'tenant' && b === 'options' && category !== undefined) {
    const scope = { tenant: call.tenant, category }
    if (key !== undefined && editable === 'editable' && segments.length === 5) {
      return method === 'PUT' ? Response.json({ editable: Boolean((call.body as any)?.editable) }) : undefined
    }
    if (key !== undefined && segments.length === 4) {
      const self = `${new URL(process.env.C8Y_BASEURL || DEFAULTS.baseUrl).origin}/tenant/options/${encodeURIComponent(category)}/${encodeURIComponent(key)}`
      if (method === 'GET') {
        const value = platform.getOption(key, scope)
        return value === undefined ? optionNotFound(category, key) : Response.json({ self, category, key, value: readableOption(category, key, value) })
      }
      if (method === 'PUT') {
        const value = String((call.body as any)?.value ?? '')
        platform.setOption(key, value, scope)
        return Response.json({ self, category, key, value: encrypted(key, value) })
      }
      if (method === 'DELETE') {
        return platform.deleteOption(key, scope) ? new Response(null, { status: 204 }) : optionNotFound(category, key)
      }
      return undefined
    }
    if (segments.length === 3) {
      if (method === 'PUT') {
        // verified: the response lists only the keys that were sent
        const result: Record<string, string> = {}
        for (const [k, v] of Object.entries((call.body as Record<string, string>) ?? {})) {
          platform.setOption(k, String(v), scope)
          result[k] = encrypted(k, String(v))
        }
        return Response.json(result)
      }
      if (method === 'GET') {
        const prefix = optionId(call.tenant, category, '')
        const result: Record<string, string> = {}
        for (const [id, value] of platform.options) {
          if (id.startsWith(prefix)) {
            const key = id.slice(prefix.length)
            result[key] = readableOption(category, key, value)
          }
        }
        return Response.json(result)
      }
    }
  }

  return undefined
}
