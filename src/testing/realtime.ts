/**
 * Notification 2.0 in the fake tenant: subscriptions, tokens, and consumer
 * WebSockets (in memory). Data changes are published to matching
 * subscriptions as frames in the platform's format:
 *
 * ```
 * <ackId>
 * /<tenant>/<api>/<sourceId>
 * CREATE | UPDATE | DELETE
 *
 * <JSON payload>
 * ```
 *
 * Unlike the data, this state lives as long as the test file's Nitro app: a
 * Nitro plugin that subscribes at startup stays subscribed for every test.
 * Undelivered notifications are dropped when the data is reset.
 */
import { Buffer } from 'node:buffer'
import type { StoredDocument } from './store'

/**
 * Set by the platform: requests being answered (handlers may be writing).
 */
let platformInflight: () => number = () => 0

export function trackInflight(count: () => number): void {
  platformInflight = count
}

export type RealtimeApi = 'managedobjects' | 'measurements' | 'events' | 'alarms' | 'operations'

/**
 * Notification 2.0 subscription as stored by the fake.
 */
export interface FakeSubscription {
  id: string
  tenant: string
  context: 'mo' | 'tenant'
  subscription: string
  source?: { id: string }
  subscriptionFilter?: { apis?: string[], typeFilter?: string }
  fragmentsToCopy?: string[]
  nonPersistent?: boolean
}

interface Token {
  tenant: string
  subscription: string
  subscriber: string
}

interface Frame {
  ackId: string
  text: string
}

type Listener = (...args: any[]) => void

const CONNECTING = 0
const OPEN = 1
const CLOSING = 2
const CLOSED = 3

/**
 * Standard properties, which `fragmentsToCopy` always keeps (verified for
 * events; assumed for the other APIs).
 */
const STANDARD_FIELDS = new Set(['id', 'self', 'type', 'text', 'time', 'source', 'creationTime', 'lastUpdated', 'severity', 'status', 'count', 'firstOccurrenceTime', 'deviceId', 'deviceName', 'description', 'failureReason', 'name', 'owner'])

/**
 * With `fragmentsToCopy`, the platform delivers only the named fragments next
 * to the standard properties.
 * @param document - The rendered object
 * @param fragments - The subscription's `fragmentsToCopy`
 */
function copyFragments(document: StoredDocument, fragments: string[] | undefined): StoredDocument {
  if (!fragments || fragments.length === 0) {
    return document
  }
  return Object.fromEntries(Object.entries(document).filter(([key]) => STANDARD_FIELDS.has(key) || fragments.includes(key))) as StoredDocument
}

function typesOf(typeFilter: string | undefined): string[] | undefined {
  if (!typeFilter) {
    return undefined
  }
  const quoted = [...typeFilter.matchAll(/'([^']*)'/g)].map((match) => match[1]!)
  return quoted.length > 0 ? quoted : typeFilter.split(/\s+or\s+/).map((type) => type.trim())
}

export const realtime = {
  nextId: 1,
  nextAck: 1,
  subscriptions: [] as FakeSubscription[],
  tokens: new Map<string, Token>(),
  sockets: new Set<FakeWebSocket>(),
  /**
   * frames waiting for a consumer of a subscription name (persistent subscriptions)
   */
  backlog: new Map<string, Frame[]>(),
  /**
   * delivered but not yet acknowledged frames, per socket
   */
  unacked: new Map<FakeWebSocket, Set<string>>(),
  /**
   * frames scheduled for delivery
   */
  scheduled: 0,

  createSubscription(subscription: Omit<FakeSubscription, 'id'>): FakeSubscription {
    const created = { ...subscription, id: String(this.nextId++) }
    this.subscriptions.push(created)
    return created
  },

  createToken(token: Token): string {
    const value = `fake-token-${this.nextId++}-${token.subscription}`
    this.tokens.set(value, token)
    return value
  },

  connect(socket: FakeWebSocket): void {
    const token = this.tokens.get(new URL(socket.url).searchParams.get('token') ?? '')
    if (!token || socket.readyState === CLOSED) {
      socket.readyState = CLOSED
      socket.emit('error', new Error('Invalid notification token'))
      socket.emit('close', 1008, 'invalid token')
      return
    }
    socket.token = token
    socket.readyState = OPEN
    this.sockets.add(socket)
    this.unacked.set(socket, new Set())
    socket.emit('open')
    const waiting = this.backlog.get(this.key(token.tenant, token.subscription)) ?? []
    this.backlog.delete(this.key(token.tenant, token.subscription))
    for (const frame of waiting) {
      this.deliver(socket, frame)
    }
  },

  disconnect(socket: FakeWebSocket): void {
    this.sockets.delete(socket)
    this.unacked.delete(socket)
  },

  acknowledge(socket: FakeWebSocket, ackId: string): void {
    this.unacked.get(socket)?.delete(ackId)
  },

  key(tenant: string, subscription: string): string {
    return `${tenant}\u0000${subscription}`
  },

  deliver(socket: FakeWebSocket, frame: Frame): void {
    this.scheduled++
    setTimeout(() => {
      this.scheduled--
      if (socket.readyState !== OPEN) {
        return
      }
      this.unacked.get(socket)?.add(frame.ackId)
      socket.emit('message', Buffer.from(frame.text))
    }, 0)
  },

  /**
   * Publishes a data change to every matching subscription.
   * @param tenant - Tenant of the data
   * @param api - Notification API, e.g. `measurements`
   * @param action - CREATE, UPDATE, or DELETE
   * @param document - The rendered object (for DELETE: `{ id }` plus its source)
   * @param sourceId - Device id the notification is about
   */
  publish(tenant: string, api: RealtimeApi, action: 'CREATE' | 'UPDATE' | 'DELETE', document: StoredDocument, sourceId: string | undefined): void {
    const names = new Map<string, FakeSubscription>()
    for (const subscription of this.subscriptions) {
      if (subscription.tenant !== tenant) {
        continue
      }
      const apis = subscription.subscriptionFilter?.apis ?? ['*']
      if (!apis.includes('*') && !apis.includes(api)) {
        continue
      }
      if (subscription.context === 'mo' && subscription.source?.id !== sourceId) {
        continue
      }
      const types = typesOf(subscription.subscriptionFilter?.typeFilter)
      if (types && !types.includes(String(document.type))) {
        continue
      }
      names.set(subscription.subscription, subscription)
    }
    for (const [name, subscription] of names) {
      const ackId = String(this.nextAck++)
      // verified: a DELETE notification's payload is not JSON but an opaque
      // Java object string; the deleted object's id is only in the description
      const payload = action === 'DELETE'
        ? `com.cumulocity.notification.service.RealtimeDeletedObject$1@${(this.nextAck * 2654435761 >>> 0).toString(16)}`
        : JSON.stringify(copyFragments(document, subscription.fragmentsToCopy))
      const frame: Frame = {
        ackId,
        text: `${ackId}\n/${tenant}/${api}/${sourceId ?? document.id}\n${action}\n\n${payload}`,
      }
      const consumers = [...this.sockets].filter((socket) => socket.token?.tenant === tenant && socket.token.subscription === name)
      if (consumers.length > 0) {
        for (const socket of consumers) {
          this.deliver(socket, frame)
        }
      } else {
        if (!subscription.nonPersistent) {
          const key = this.key(tenant, name)
          this.backlog.set(key, [...(this.backlog.get(key) ?? []), frame])
        }
      }
    }
  },

  /**
   * Notifications on their way to a consumer or not yet acknowledged.
   */
  pending(): number {
    let count = this.scheduled + platformInflight()
    for (const acks of this.unacked.values()) {
      count += acks.size
    }
    // backlog of subscriptions a consumer has a token for (it is connecting)
    for (const [key, frames] of this.backlog) {
      const [tenant, subscription] = key.split('\u0000')
      if ([...this.tokens.values()].some((token) => token.tenant === tenant && token.subscription === subscription)) {
        count += frames.length
      }
    }
    return count
  },

  /**
   * Drops undelivered notifications (data reset between tests).
   */
  dropPending(): void {
    this.backlog.clear()
    for (const acks of this.unacked.values()) {
      acks.clear()
    }
  },
}

/**
 * In-memory stand-in for the `ws` WebSocket c8y-realtime opens for a consumer.
 */
export class FakeWebSocket {
  static readonly CONNECTING = CONNECTING
  static readonly OPEN = OPEN
  static readonly CLOSING = CLOSING
  static readonly CLOSED = CLOSED

  readyState = CONNECTING
  readonly url: string
  token: Token | undefined
  private listeners = new Map<string, Set<Listener>>()

  constructor(url: string | URL) {
    this.url = String(url)
    setTimeout(() => realtime.connect(this), 0)
  }

  on(event: string, listener: Listener): this {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return this
  }

  addEventListener(event: string, listener: Listener): void {
    this.on(event, listener)
  }

  removeAllListeners(): this {
    this.listeners.clear()
    return this
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      listener(...args)
    }
  }

  /**
   * The consumer acknowledges a frame by sending its ack id.
   * @param data
   */
  send(data: unknown): void {
    realtime.acknowledge(this, String(data).trim())
  }

  ping(): void {
    setTimeout(() => this.emit('pong'), 0)
  }

  close(): void {
    if (this.readyState === CLOSED) {
      return
    }
    this.readyState = CLOSED
    realtime.disconnect(this)
    setTimeout(() => this.emit('close', 1000, ''), 0)
  }

  terminate(): void {
    this.close()
  }
}

/**
 * Waits until the service has finished starting up its realtime clients: no
 * platform request in flight, and every minted token has a connected socket.
 * @param timeout - Milliseconds to wait at most
 */
export async function waitForRealtimeStartup(timeout = 3000): Promise<void> {
  const start = Date.now()
  let quietTicks = 0
  while (quietTicks < 3 && Date.now() - start < timeout) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 5)
    })
    const connected = new Set([...realtime.sockets].map((socket) => socket.token))
    const quiet = platformInflight() === 0 && realtime.scheduled === 0 && [...realtime.tokens.values()].every((token) => connected.has(token))
    quietTicks = quiet ? quietTicks + 1 : 0
  }
}
