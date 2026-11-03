import type { StoredDocument, TenantData } from './store'
import type { RealtimeApi } from './realtime'
import { realtime } from './realtime'
import { store } from './store'

/**
 * Publishes a data change as a Notification 2.0 notification, unless the
 * change is part of rebuilding a test's arranged data (`store.silent`).
 * @param data - Tenant data the change happened in
 * @param api - Notification API
 * @param action - CREATE, UPDATE, or DELETE
 * @param document - Rendered object
 * @param sourceId - Device the notification is about
 */
export function notify(data: TenantData, api: RealtimeApi, action: 'CREATE' | 'UPDATE' | 'DELETE', document: StoredDocument, sourceId: string | undefined): void {
  if (!store.silent) {
    realtime.publish(data.tenant, api, action, document, sourceId)
  }
}
