import type { C8yRequest } from '../types'
import type { TenantData } from '../store'
import type { FakeSubscription } from '../realtime'
import { realtime } from '../realtime'
import { apiError, baseUrl, checkQuery, checkRequired, paged, UnsupportedRequestError } from './http'
import { moSelf } from './inventory'

const APIS = ['*', 'managedobjects', 'measurements', 'events', 'alarms', 'operations']
const UNSUPPORTED_APIS = ['alarmsWithChildren', 'eventsWithChildren']

function render(subscription: FakeSubscription) {
  const { tenant: _tenant, ...rest } = subscription
  return {
    ...rest,
    self: `${baseUrl()}/notification2/subscriptions/${subscription.id}`,
    ...(subscription.source ? { source: { id: subscription.source.id, self: moSelf(subscription.source.id) } } : {}),
  }
}

function notFound(id: string): Response {
  return apiError(404, 'notification2/Not Found', `Subscription with id '${id}' not found`)
}

/**
 * Notification 2.0 API: subscriptions, tokens, and unsubscribing consumers.
 * The consumer WebSocket itself is `FakeWebSocket` in `../realtime`.
 * @param call - The request
 * @param segments - Path segments
 * @param data - Data of the request's tenant
 */
export function notifications(call: C8yRequest, segments: string[], data: TenantData): Response | undefined {
  const [, resource, id] = segments
  const { method } = call
  const tenant = data.tenant
  const body = (call.body ?? {}) as Record<string, any>

  if (resource === 'subscriptions' && id === undefined) {
    if (method === 'POST') {
      checkQuery('POST /notification2/subscriptions', call, [])
      const missing = checkRequired('POST /notification2/subscriptions', body)
      if (missing) {
        return missing
      }
      const apis: string[] = body.subscriptionFilter?.apis ?? ['*']
      const unsupported = apis.filter((api) => UNSUPPORTED_APIS.includes(api))
      if (unsupported.length > 0) {
        throw new UnsupportedRequestError(`subscription api "${unsupported.join(', ')}" is not emulated`)
      }
      if (apis.some((api) => !APIS.includes(api))) {
        return apiError(422, 'notification2/Invalid Data', `Invalid subscription filter apis: ${apis.join(', ')}`)
      }
      if (body.context !== 'mo' && body.context !== 'tenant') {
        return apiError(422, 'notification2/Invalid Data', `Invalid context '${body.context}'`)
      }
      if (body.context === 'mo' && !data.managedObjects.has(String(body.source?.id))) {
        return apiError(422, 'notification2/Invalid Data', `Source with id '${body.source?.id}' does not exist`)
      }
      const sourceId = body.context === 'mo' ? String(body.source.id) : undefined
      if (realtime.subscriptions.some((item) => item.tenant === tenant && item.subscription === body.subscription && item.source?.id === sourceId)) {
        return apiError(409, 'notification2/Conflict', `Subscription '${body.subscription}' already exists`)
      }
      const created = realtime.createSubscription({
        tenant,
        context: body.context,
        subscription: body.subscription,
        ...(sourceId ? { source: { id: sourceId } } : {}),
        ...(body.subscriptionFilter ? { subscriptionFilter: body.subscriptionFilter } : {}),
        ...(body.fragmentsToCopy ? { fragmentsToCopy: body.fragmentsToCopy } : {}),
        ...(body.nonPersistent !== undefined ? { nonPersistent: body.nonPersistent } : {}),
      })
      return Response.json(render(created), { status: 201 })
    }
    if (method === 'GET') {
      checkQuery('GET /notification2/subscriptions', call, ['context', 'currentPage', 'pageSize', 'source', 'subscription', 'withTotalElements', 'withTotalPages'])
      const { query } = call
      const items = realtime.subscriptions.filter((item) => item.tenant === tenant
        && (query.subscription === undefined || item.subscription === query.subscription)
        && (query.context === undefined || item.context === query.context)
        && (query.source === undefined || item.source?.id === query.source))
      return paged(call, 'subscriptions', items.map(render), '/notification2/subscriptions')
    }
    if (method === 'DELETE') {
      checkQuery('DELETE /notification2/subscriptions', call, ['context', 'source'])
      realtime.subscriptions = realtime.subscriptions.filter((item) => !(item.tenant === tenant
        && (call.query.context === undefined || item.context === call.query.context)
        && (call.query.source === undefined || item.source?.id === call.query.source)))
      return new Response(null, { status: 204 })
    }
    return undefined
  }

  if (resource === 'subscriptions' && id !== undefined && segments.length === 3) {
    const subscription = realtime.subscriptions.find((item) => item.tenant === tenant && item.id === id)
    if (method === 'GET') {
      return subscription ? Response.json(render(subscription)) : notFound(id)
    }
    if (method === 'DELETE') {
      if (!subscription) {
        return notFound(id)
      }
      realtime.subscriptions = realtime.subscriptions.filter((item) => item !== subscription)
      return new Response(null, { status: 204 })
    }
    return undefined
  }

  if (resource === 'token' && method === 'POST' && segments.length === 2) {
    checkQuery('POST /notification2/token', call, [])
    if (!body.subscriber || !body.subscription) {
      return apiError(422, 'undefined/validationError', 'Following mandatory fields should be included: subscriber,subscription')
    }
    return Response.json({ token: realtime.createToken({ tenant, subscription: body.subscription, subscriber: body.subscriber }) })
  }

  if (resource === 'unsubscribe' && method === 'POST' && segments.length === 2) {
    const token = call.query.token ?? ''
    if (!realtime.tokens.has(token)) {
      return apiError(404, 'notification2/Not Found', 'Unknown token')
    }
    realtime.tokens.delete(token)
    for (const socket of realtime.sockets) {
      if (new URL(socket.url).searchParams.get('token') === token) {
        socket.close()
      }
    }
    return Response.json({ result: 'DONE' })
  }

  return undefined
}
