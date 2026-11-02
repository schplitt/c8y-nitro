import type { C8yAlarmSeverity, C8yAlarmStatus, C8yOperationStatus } from './capabilities.generated'
import type { DocumentCollection, StoredDocument, TenantData } from './store'
import { createDocument, RESOURCES, renderDocument, updateDocument } from './api/data'
import { addExternalId } from './api/identity'
import { createManagedObject, renderManagedObject } from './api/inventory'
import { createBinary } from './api/binaries'
import { addChild, store } from './store'
import { platform } from './platform'

/**
 * A managed object created by `c8y.device()` or `c8y.managedObject()`. Its
 * `id` exists while a test runs (the object is rebuilt before every test).
 */
export interface C8yRef {
  readonly id: string
}

class Ref implements C8yRef {
  private readonly label: string

  constructor(label: string) {
    this.label = label
  }

  get id(): string {
    const id = store.refs.get(this)
    if (id === undefined) {
      throw new Error(`${this.label} does not exist yet: managed objects created with c8y.device()/c8y.managedObject() exist while a test runs, in the scope they were created in.`)
    }
    return id
  }

  toJSON() {
    return { id: this.id }
  }
}

/**
 * A managed object id, a ref from `c8y.device()`, or `{ id }`.
 */
export type C8yIdInput = string | C8yRef | { id: string }

export function resolveId(input: C8yIdInput): string {
  return typeof input === 'string' ? input : input.id
}

/**
 * Input of `c8y.managedObject()` and `c8y.device()`.
 */
export interface C8yManagedObjectInput {
  name?: string
  type?: string
  /**
   * Defaults to the current user.
   */
  owner?: string
  /**
   * Child devices (references in `childDevices`).
   */
  children?: C8yRef[]
  /**
   * Child assets (references in `childAssets`).
   */
  assets?: C8yRef[]
  /**
   * Child additions (references in `childAdditions`).
   */
  additions?: C8yRef[]
  /**
   * External ids by type, e.g. `{ c8y_Serial: 'SN-1' }`.
   */
  externalIds?: Record<string, string>
  /**
   * Tenant to create it in. Defaults to the deployed tenant.
   */
  tenant?: string
  /**
   * Any fragments, e.g. `c8y_Hardware: { serialNumber: 'SN-1' }`.
   */
  [fragment: string]: unknown
}

interface SourcedInput {
  source: C8yIdInput
  type: string
  /**
   * Defaults to now.
   */
  time?: string
  [fragment: string]: unknown
}

export interface C8yMeasurementInput extends SourcedInput {}

export interface C8yEventInput extends SourcedInput {
  /**
   * Defaults to `type`.
   */
  text?: string
}

export interface C8yAlarmInput extends SourcedInput {
  /**
   * Defaults to `type`.
   */
  text?: string
  /**
   * Defaults to `MAJOR`.
   */
  severity?: C8yAlarmSeverity
  /**
   * Defaults to `ACTIVE`.
   */
  status?: C8yAlarmStatus
}

export interface C8yOperationInput {
  deviceId: C8yIdInput
  /**
   * Defaults to `PENDING`.
   */
  status?: C8yOperationStatus
  failureReason?: string
  [fragment: string]: unknown
}

/**
 * Input of `c8y.seed()`.
 */
export interface C8ySeed {
  measurements?: C8yMeasurementInput[]
  events?: C8yEventInput[]
  alarms?: C8yAlarmInput[]
  operations?: C8yOperationInput[]
  /**
   * Tenant to seed. Defaults to the deployed tenant.
   */
  tenant?: string
}

const RESERVED = ['children', 'assets', 'additions', 'externalIds', 'tenant']

export function newRef(label: string): Ref {
  return new Ref(label)
}

/**
 * Creates a managed object from factory input and binds it to its ref.
 * @param ref - The ref returned to the test
 * @param input - Factory input
 */
export function createFromInput(ref: Ref, input: C8yManagedObjectInput): void {
  const data = store.tenant(input.tenant ?? platform.tenant)
  const fragments = Object.fromEntries(Object.entries(input).filter(([key]) => !RESERVED.includes(key)))
  const document = createManagedObject(data, fragments, input.owner ?? platform.user?.userName ?? 'test-user')
  store.refs.set(ref, document.id)
  for (const [kind, children] of [['childDevices', input.children], ['childAssets', input.assets], ['childAdditions', input.additions]] as const) {
    for (const child of children ?? []) {
      addChild(data, document.id, kind, child.id)
    }
  }
  for (const [type, externalId] of Object.entries(input.externalIds ?? {})) {
    const result = addExternalId(data, document.id, type, externalId)
    if (result instanceof Response) {
      throw new TypeError(`c8y: external id ${type}/${externalId} already exists`)
    }
  }
}

/**
 * Input of `c8y.binary()`.
 */
export interface C8yBinaryInput {
  /**
   * File name.
   */
  name: string
  /**
   * File content.
   */
  content: string | Uint8Array
  /**
   * Content type. Defaults to `text/plain` for strings, `application/octet-stream` otherwise.
   */
  contentType?: string
  /**
   * Tenant to create it in. Defaults to the deployed tenant.
   */
  tenant?: string
  /**
   * Any other managed object fragments.
   */
  [fragment: string]: unknown
}

/**
 * Creates an inventory binary from seed input and binds it to its ref.
 * @param ref - The ref returned to the test
 * @param input - Binary input
 */
export function createBinaryFromInput(ref: Ref, input: C8yBinaryInput): void {
  const { name, content, contentType, tenant, ...fragments } = input
  const data = store.tenant(tenant ?? platform.tenant)
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
  const document = createBinary(data, {
    bytes,
    contentType: contentType ?? (typeof content === 'string' ? 'text/plain' : 'application/octet-stream'),
    name,
  }, { name, ...fragments }, platform.user?.userName ?? 'test-user')
  store.refs.set(ref, document.id)
}

/**
 * Stored file content, as read by `c8y.db.binaries.content()`.
 */
export interface C8yBinaryContent {
  name: string
  contentType: string
  bytes: Uint8Array
  /**
   * The content decoded as UTF-8.
   */
  text: () => string
}

function toContent(content: { name: string, contentType: string, bytes: Uint8Array } | undefined): C8yBinaryContent | undefined {
  return content && { ...content, text: () => new TextDecoder().decode(content.bytes) }
}

function seedInto(data: TenantData, collection: Exclude<DocumentCollection, 'managedObjects'>, input: Record<string, unknown>): void {
  const resource = Object.values(RESOURCES).find((item) => item.collection === collection)!
  const now = store.now()
  const body: Record<string, unknown> = { time: now, ...input }
  if ('source' in input) {
    body.source = { id: resolveId(input.source as C8yIdInput) }
  }
  if (collection === 'events' || collection === 'alarms') {
    body.text ??= body.type
  }
  if (collection === 'alarms') {
    body.severity ??= 'MAJOR'
  }
  if (collection === 'operations') {
    delete body.time
    body.deviceId = resolveId(input.deviceId as C8yIdInput)
  }
  const result = createDocument(data, resource, body)
  if (result instanceof Response) {
    throw new TypeError(`c8y.seed(): invalid ${collection.slice(0, -1)}: ${(result as Response & { message?: string }).message ?? result.status}`)
  }
  if (collection === 'operations' && (input.status !== undefined || input.failureReason !== undefined)) {
    updateDocument(data, resource, result, { status: input.status ?? 'PENDING', failureReason: input.failureReason })
  }
}

/**
 * Seeds measurements, events, alarms, and operations (validated like API writes).
 * @param seed - Data to seed
 */
export function applySeed(seed: C8ySeed): void {
  const data = store.tenant(seed.tenant ?? platform.tenant)
  for (const measurement of seed.measurements ?? []) {
    seedInto(data, 'measurements', measurement)
  }
  for (const event of seed.events ?? []) {
    seedInto(data, 'events', event)
  }
  for (const alarm of seed.alarms ?? []) {
    seedInto(data, 'alarms', alarm)
  }
  for (const operation of seed.operations ?? []) {
    seedInto(data, 'operations', operation as Record<string, unknown>)
  }
}

/**
 * Filter for `c8y.db.*.find()`: partial match, or a predicate.
 */
export type C8yDbFilter = Record<string, unknown> | ((document: Record<string, any>) => boolean)

function matches(value: unknown, expected: unknown): boolean {
  if (expected instanceof Ref) {
    return (value as { id?: string } | undefined)?.id === expected.id || value === expected.id
  }
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    return Object.entries(expected).every(([key, item]) => matches((value as Record<string, unknown> | undefined)?.[key], item))
  }
  return value === expected
}

function filterDocuments<T extends Record<string, unknown>>(documents: T[], filter?: C8yDbFilter): T[] {
  if (!filter) {
    return documents
  }
  if (typeof filter === 'function') {
    return documents.filter(filter)
  }
  return documents.filter((document) => Object.entries(filter).every(([key, expected]) => {
    if ((key === 'source' || key === 'deviceId') && (typeof expected === 'string' || expected instanceof Ref)) {
      const id = typeof expected === 'string' ? expected : expected.id
      const actual = key === 'source' ? (document.source as { id?: string } | undefined)?.id : document.deviceId
      return actual === id
    }
    return matches(document[key], expected)
  }))
}

/**
 * Read access to one collection of the fake tenant.
 */
export interface C8yDbCollection<T> {
  /**
   * Object by id (or ref).
   */
  get: (id: C8yIdInput) => T | undefined
  /**
   * Objects matching a partial object (refs and ids match `source`/`deviceId`) or a predicate, in creation order.
   */
  find: (filter?: C8yDbFilter) => T[]
}

function collectionView(tenant: () => string, collection: DocumentCollection): C8yDbCollection<Record<string, any>> {
  const rendered = () => {
    const data = store.tenant(tenant())
    return [...data[collection].values()].map((document: StoredDocument) => collection === 'managedObjects'
      ? renderManagedObject(data, document)
      : renderDocument(data, Object.values(RESOURCES).find((item) => item.collection === collection)!, document))
  }
  return {
    get: (id) => rendered().find((document) => document.id === resolveId(id)),
    find: (filter) => filterDocuments(rendered(), filter),
  }
}

/**
 * Read (and limited write) access to the fake tenant's data.
 */
export interface C8yDb {
  managedObjects: C8yDbCollection<Record<string, any>>
  measurements: C8yDbCollection<Record<string, any>>
  events: C8yDbCollection<Record<string, any>> & {
    /**
     * Attachment (binary) of an event.
     */
    attachment: (id: C8yIdInput) => C8yBinaryContent | undefined
  }
  binaries: C8yDbCollection<Record<string, any>> & {
    /**
     * Content of an inventory binary.
     */
    content: (id: C8yIdInput) => C8yBinaryContent | undefined
  }
  alarms: C8yDbCollection<Record<string, any>>
  operations: C8yDbCollection<Record<string, any>> & {
    /**
     * Updates an operation like a device agent would, e.g.
     * `{ status: 'SUCCESSFUL' }` or `{ status: 'FAILED', failureReason }`.
     */
    update: (id: C8yIdInput, update: { status: C8yOperationStatus, failureReason?: string, [fragment: string]: unknown }) => void
  }
  externalIds: {
    /**
     * External ids, optionally of one managed object.
     */
    find: (managedObject?: C8yIdInput) => Array<{ type: string, externalId: string, managedObjectId: string }>
  }
  /**
   * The same views for another tenant's data.
   */
  tenant: (tenant: string) => Omit<C8yDb, 'tenant'>
}

export function createDb(tenant: () => string): Omit<C8yDb, 'tenant'> {
  return {
    managedObjects: collectionView(tenant, 'managedObjects'),
    measurements: collectionView(tenant, 'measurements'),
    events: {
      ...collectionView(tenant, 'events'),
      attachment: (id) => toContent(store.tenant(tenant()).eventBinaries.get(resolveId(id))),
    },
    binaries: {
      get: (id) => {
        const document = collectionView(tenant, 'managedObjects').get(id)
        return document?.c8y_IsBinary !== undefined ? document : undefined
      },
      find: (filter) => collectionView(tenant, 'managedObjects').find(filter).filter((document) => document.c8y_IsBinary !== undefined),
      content: (id) => toContent(store.tenant(tenant()).binaries.get(resolveId(id))),
    },
    alarms: collectionView(tenant, 'alarms'),
    operations: {
      ...collectionView(tenant, 'operations'),
      update(id, update) {
        const operation = store.tenant(tenant()).operations.get(resolveId(id))
        if (!operation) {
          throw new TypeError(`c8y.db.operations.update(): no operation ${resolveId(id)}`)
        }
        updateDocument(store.tenant(tenant()), RESOURCES.devicecontrol, operation, update)
      },
    },
    externalIds: {
      find: (managedObject) => store.tenant(tenant()).externalIds.filter((entry) => managedObject === undefined || entry.managedObjectId === resolveId(managedObject)).map((entry) => ({ ...entry })),
    },
  }
}
