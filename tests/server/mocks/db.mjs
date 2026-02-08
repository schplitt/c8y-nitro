/**
 * Shared mock data storage - externalized to share state between test and bundled server
 * This file is marked as 'external' in rolldown config, so it's not bundled.
 * Both the test and the server import the SAME instance of this data.
 */
export const mockData = {
  subscriptions: new Map(),
  currentUser: null,
  tenantOptions: new Map(),
}
