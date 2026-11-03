/**
 * In-memory data of the fake tenant: managed objects (with child relations),
 * external ids, measurements, events, alarms, and operations, kept per tenant.
 * Rebuilt before every test.
 *
 * Documented assumptions (see docs/guide/testing.md#what-the-fake-emulates):
 * ids are sequential numeric strings shared by all collections; timestamps come
 * from `Date` (so `vi.useFakeTimers()` controls them).
 */

/**
 * A stored document. Fragments are kept as given.
 */
export interface StoredDocument {
  id: string
  [fragment: string]: unknown
}

export type ChildKind = 'childDevices' | 'childAssets' | 'childAdditions'

export const CHILD_KINDS: ChildKind[] = ['childDevices', 'childAssets', 'childAdditions']

export const PARENT_KIND: Record<ChildKind, string> = {
  childDevices: 'deviceParents',
  childAssets: 'assetParents',
  childAdditions: 'additionParents',
}

export interface ExternalId {
  type: string
  externalId: string
  managedObjectId: string
}

export interface TenantData {
  tenant: string
  managedObjects: Map<string, StoredDocument>
  /**
   * parent id → kind → child ids, in insertion order
   */
  children: Map<string, Record<ChildKind, string[]>>
  externalIds: ExternalId[]
  measurements: Map<string, StoredDocument>
  events: Map<string, StoredDocument>
  alarms: Map<string, StoredDocument>
  operations: Map<string, StoredDocument>
  /**
   * inventory binary id → content
   */
  binaries: Map<string, BinaryContent>
  /**
   * event id → attachment
   */
  eventBinaries: Map<string, BinaryContent>
}

/**
 * Stored file content of a binary or an event attachment.
 */
export interface BinaryContent {
  bytes: Uint8Array
  contentType: string
  name: string
}

export type DocumentCollection = 'managedObjects' | 'measurements' | 'events' | 'alarms' | 'operations'

function emptyTenant(tenant: string): TenantData {
  return {
    tenant,
    managedObjects: new Map(),
    children: new Map(),
    externalIds: [],
    measurements: new Map(),
    events: new Map(),
    alarms: new Map(),
    operations: new Map(),
    binaries: new Map(),
    eventBinaries: new Map(),
  }
}

export const store = {
  nextId: 1,
  tenants: new Map<string, TenantData>(),
  /**
   * Refs from `c8y.device()`/`c8y.managedObject()` → ids in the current test.
   */
  refs: new Map<object, string>(),
  /**
   * True while a test's arranged data is rebuilt: no notifications then.
   */
  silent: false,

  reset() {
    this.nextId = 1
    this.tenants.clear()
    this.refs.clear()
  },

  tenant(tenant: string): TenantData {
    let data = this.tenants.get(tenant)
    if (!data) {
      data = emptyTenant(tenant)
      this.tenants.set(tenant, data)
    }
    return data
  },

  newId(): string {
    return String(this.nextId++)
  },

  now(): string {
    return new Date().toISOString()
  },
}

/**
 * Child ids of a managed object.
 * @param data - Tenant data
 * @param parentId - Managed object id
 * @param kind - Relation kind
 */
export function childIds(data: TenantData, parentId: string, kind: ChildKind): string[] {
  return data.children.get(parentId)?.[kind] ?? []
}

/**
 * The given objects and their children of the given kinds, recursively.
 * @param data - Tenant data
 * @param roots - Managed object ids
 * @param kinds - Relation kinds to follow (default: all)
 */
export function descendants(data: TenantData, roots: Iterable<string>, kinds: readonly ChildKind[] = CHILD_KINDS): Set<string> {
  const result = new Set<string>()
  const queue = [...roots]
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]!
    if (result.has(id)) {
      continue
    }
    result.add(id)
    for (const kind of kinds) {
      for (const child of childIds(data, id, kind)) {
        if (!result.has(child)) {
          queue.push(child)
        }
      }
    }
  }
  return result
}

/**
 * Parent ids of a managed object for a relation kind.
 * @param data - Tenant data
 * @param childId - Managed object id
 * @param kind - Relation kind (the parent's children list)
 */
export function parentIds(data: TenantData, childId: string, kind: ChildKind): string[] {
  const parents: string[] = []
  for (const [parentId, relations] of data.children) {
    if (relations[kind].includes(childId)) {
      parents.push(parentId)
    }
  }
  return parents
}

/**
 * Adds a child reference (idempotent).
 * @param data - Tenant data
 * @param parentId - Parent managed object id
 * @param kind - Relation kind
 * @param childId - Child managed object id
 */
export function addChild(data: TenantData, parentId: string, kind: ChildKind, childId: string): void {
  let relations = data.children.get(parentId)
  if (!relations) {
    relations = { childDevices: [], childAssets: [], childAdditions: [] }
    data.children.set(parentId, relations)
  }
  if (!relations[kind].includes(childId)) {
    relations[kind].push(childId)
  }
}

/**
 * Removes a child reference.
 * @param data - Tenant data
 * @param parentId - Parent managed object id
 * @param kind - Relation kind
 * @param childId - Child managed object id
 * @returns Whether the reference existed
 */
export function removeChild(data: TenantData, parentId: string, kind: ChildKind, childId: string): boolean {
  const relations = data.children.get(parentId)
  const index = relations?.[kind].indexOf(childId) ?? -1
  if (index === -1) {
    return false
  }
  relations![kind].splice(index, 1)
  return true
}

/**
 * Deletes a managed object, its references (both directions), and its
 * external ids. Measurements, events, alarms, and operations of the object are
 * kept (documented assumption).
 * @param data - Tenant data
 * @param id - Managed object id
 */
export function deleteManagedObject(data: TenantData, id: string): boolean {
  if (!data.managedObjects.delete(id)) {
    return false
  }
  data.children.delete(id)
  for (const relations of data.children.values()) {
    for (const kind of CHILD_KINDS) {
      relations[kind] = relations[kind].filter((childId) => childId !== id)
    }
  }
  data.externalIds = data.externalIds.filter((entry) => entry.managedObjectId !== id)
  data.binaries.delete(id)
  return true
}
