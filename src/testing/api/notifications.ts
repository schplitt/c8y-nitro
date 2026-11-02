import type { C8yRequest } from '../types'
import type { TenantData } from '../store'
import type { FakeSubscription } from '../realtime'
import { realtime } from '../realtime'
import { apiError, baseUrl, checkQuery, checkRequired, paged, UnsupportedRequestError } from './http'
import { moSelf } from './inventory'

const APIS = ['*', 'managedobjects', 'measurements', 'events', 'alarms', 'operations']
const UNSUPPORTED_APIS = ['alarmsWithChildren', 'eventsWithChildren']

function render(subscription: FakeSubscription) {
  const { tenant, ...rest } = subscription
  return {
    nonPersistent: false,
    ...rest,
    self: `${baseUrl()}/notification2/subscriptions/${subscription.id}`,
    // verified: a tenant subscription's source is the tenant
    source: subscription.source
      ? { id: subscription.source.id, self: moSelf(subscription.source.id) }
      : { id: tenant, self: `${baseUrl()}/tenant/tenants/${tenant}` },
  }
}

function notFound(id: string): Response {
  return apiError(404, 'reliable-notification/Not Found', `Subscription with id '${id}' not found`)
}

const NAME = /^[a-z0-9]+$/i

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
      // verified against the platform: names are alphanumeric, `*` stands alone
      if (apis.some((api) => !APIS.includes(api)) || (apis.includes('*') && apis.length > 1)) {
        return apiError(422, 'reliable-notification/Invalid Data', `Invalid subscription filter apis: ${apis.join(', ')}`)
      }
      if (!NAME.test(String(body.subscription))) {
        return apiError(422, 'reliable-notification/Invalid Data', 'The subscription name must be alphanumeric')
      }
      if (body.context !== 'mo' && body.context !== 'tenant') {
        return apiError(422, 'reliable-notification/Invalid Data', `Invalid context '${body.context}'`)
      }
      if (body.context === 'tenant' && body.source !== undefined) {
        return apiError(422, 'reliable-notification/Invalid Data', 'A tenant subscription has no source')
      }
      if (body.context === 'mo' && body.source?.id === undefined) {
        return apiError(422, 'reliable-notification/Invalid Data', 'A managed object subscription needs a source')
      }
      if (body.context === 'mo' && !data.managedObjects.has(String(body.source.id))) {
        return apiError(404, 'inventory/Not Found', `Finding device data from database failed : No managedObject for id '${body.source.id}'!`)
      }
      const sourceId = body.context === 'mo' ? String(body.source.id) : undefined
      if (realtime.subscriptions.some((item) => item.tenant === tenant && item.subscription === body.subscription && item.source?.id === sourceId)) {
        return apiError(409, 'reliable-notification/Duplicate', `Subscription '${body.subscription}' already exists`)
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
    if (!NAME.test(String(body.subscriber))) {
      // verified against the platform
      return apiError(422, 'reliable-notification/Invalid Data', 'The subscriber name must be alphanumeric')
    }
    return Response.json({ token: realtime.createToken({ tenant, subscription: body.subscription, subscriber: body.subscriber }) })
  }

  if (resource === 'unsubscribe' && method === 'POST' && segments.length === 2) {
    // verified: 422 without a token, 500 for an unknown token or one without
    // a connected consumer
    const token = call.query.token ?? ''
    if (!token) {
      return apiError(422, 'reliable-notification/Invalid Data', 'Missing token')
    }
    const consumers = [...realtime.sockets].filter((socket) => new URL(socket.url).searchParams.get('token') === token)
    if (!realtime.tokens.has(token) || consumers.length === 0) {
      return apiError(500, 'reliable-notification/Internal Server Error', 'Unsubscribing the consumer failed')
    }
    realtime.tokens.delete(token)
    for (const socket of consumers) {
      socket.close()
    }
    return Response.json({ result: 'DONE' })
  }

  return undefined
}
