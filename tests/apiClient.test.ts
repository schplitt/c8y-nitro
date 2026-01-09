import { describe, expect, it } from 'vitest'
import {
  generateFunctionName,
  extractParams,
  capitalize,
  toValidClassName,
  generateMethod,
  generateAPIClient,
  parseRoutes,
} from '../src/dev/apiClient'

describe('apiClient generation', () => {
  describe('generateFunctionName', () => {
    it('should generate function name for GET /health', () => {
      expect(generateFunctionName('/health', 'get')).toBe('GetHealth')
    })

    it('should generate function name for POST /health', () => {
      expect(generateFunctionName('/health', 'post')).toBe('PostHealth')
    })

    it('should generate function name for default method', () => {
      expect(generateFunctionName('/someRoute', 'default')).toBe('SomeRoute')
    })

    it('should generate function name with route parameter', () => {
      expect(generateFunctionName('/[id]', 'get')).toBe('GetById')
    })

    it('should generate function name for nested route with parameters', () => {
      expect(generateFunctionName('/api/[multiple]/[params]', 'get')).toBe('GetApiByMultipleByParams')
    })

    it('should generate function name for PUT method', () => {
      expect(generateFunctionName('/users/[id]', 'put')).toBe('PutUsersById')
    })

    it('should generate function name for DELETE method', () => {
      expect(generateFunctionName('/items/[itemId]', 'delete')).toBe('DeleteItemsByItemId')
    })

    it('should handle root path', () => {
      expect(generateFunctionName('/', 'get')).toBe('GetIndex')
    })

    it('should handle complex nested paths', () => {
      expect(generateFunctionName('/api/users/[userId]/posts/[postId]', 'get')).toBe('GetApiUsersByUserIdPostsByPostId')
    })
  })

  describe('extractParams', () => {
    it('should extract no parameters from simple path', () => {
      expect(extractParams('/health')).toEqual([])
    })

    it('should extract single parameter', () => {
      expect(extractParams('/[id]')).toEqual([
        'id',
      ])
    })

    it('should extract multiple parameters', () => {
      expect(extractParams('/api/[multiple]/[params]')).toEqual([
        'multiple',
        'params',
      ])
    })

    it('should extract parameters from complex path', () => {
      expect(extractParams('/api/users/[userId]/posts/[postId]/comments')).toEqual([
        'userId',
        'postId',
      ])
    })
  })

  describe('capitalize', () => {
    it('should capitalize first letter', () => {
      expect(capitalize('hello')).toBe('Hello')
    })

    it('should handle already capitalized', () => {
      expect(capitalize('World')).toBe('World')
    })

    it('should handle single character', () => {
      expect(capitalize('a')).toBe('A')
    })

    it('should handle empty string', () => {
      expect(capitalize('')).toBe('')
    })
  })

  describe('toValidClassName', () => {
    it('should convert kebab-case to PascalCase with Generated prefix', () => {
      expect(toValidClassName('my-service-api')).toBe('GeneratedMyServiceApi')
    })

    it('should convert snake_case to PascalCase with Generated prefix', () => {
      expect(toValidClassName('my_service_api')).toBe('GeneratedMyServiceApi')
    })

    it('should handle dots as separators with Generated prefix', () => {
      expect(toValidClassName('my.service.api')).toBe('GeneratedMyServiceApi')
    })

    it('should remove invalid characters', () => {
      expect(toValidClassName('special@chars!#%')).toBe('GeneratedSpecialchars')
    })

    it('should handle the JSDoc example case', () => {
      expect(toValidClassName('special@chars!APIClient')).toBe('GeneratedSpecialcharsAPIClient')
    })

    it('should handle names starting with numbers', () => {
      expect(toValidClassName('123-invalid')).toBe('Generated123Invalid')
    })

    it('should handle already PascalCase', () => {
      expect(toValidClassName('MyServiceAPI')).toBe('GeneratedMyServiceAPI')
    })

    it('should handle mixed separators', () => {
      expect(toValidClassName('my-service_api.client')).toBe('GeneratedMyServiceApiClient')
    })

    it('should preserve $ in names', () => {
      expect(toValidClassName('my$service')).toBe('GeneratedMy$service')
    })

    it('should handle empty or invalid input', () => {
      expect(toValidClassName('!!!')).toBe('Generated')
      expect(toValidClassName('')).toBe('Generated')
    })

    it('should remove file extensions', () => {
      expect(toValidClassName('myService.ts')).toBe('GeneratedMyService')
      expect(toValidClassName('api-client.service.ts')).toBe('GeneratedApiClientService')
    })
  })

  describe('generateMethod', () => {
    it('should generate method without parameters', () => {
      const route = {
        path: '/health',
        method: 'get',
        functionName: 'GetHealth',
        params: [],
        returnType: 'string',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async GetHealth(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })

    it('should generate method with POST method', () => {
      const route = {
        path: '/health',
        method: 'post',
        functionName: 'PostHealth',
        params: [],
        returnType: 'string',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async PostHealth(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })

    it('should generate method with single parameter and inline type', () => {
      const route = {
        path: '/[id]',
        method: 'get',
        functionName: 'GetById',
        params: ['id'],
        returnType: 'string',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async GetById(params: { id: string | number }): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/\${params.id}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })

    it('should generate method with multiple parameters and inline type', () => {
      const route = {
        path: '/api/[multiple]/[params]',
        method: 'get',
        functionName: 'GetApiByMultipleByParams',
        params: [
          'multiple',
          'params',
        ],
        returnType: 'string',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async GetApiByMultipleByParams(params: { multiple: string | number; params: string | number }): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/api/\${params.multiple}/\${params.params}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })

    it('should generate PUT method with parameters', () => {
      const route = {
        path: '/users/[id]',
        method: 'put',
        functionName: 'PutUsersById',
        params: ['id'],
        returnType: '{ success: boolean }',
      }
      const result = generateMethod(route)
      expect(result).toMatchInlineSnapshot(`
        "  async PutUsersById(params: { id: string | number }): Promise<{ success: boolean }> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/users/\${params.id}\`, { method: 'PUT', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }"
      `)
    })
  })

  describe('generateAPIClient', () => {
    it('should generate Angular service with multiple routes', () => {
      const routes = [
        {
          path: '/health',
          method: 'get',
          functionName: 'GetHealth',
          params: [],
          returnType: 'string',
        },
        {
          path: '/health',
          method: 'post',
          functionName: 'PostHealth',
          params: [],
          returnType: 'string',
        },
        {
          path: '/[id]',
          method: 'get',
          functionName: 'GetById',
          params: ['id'],
          returnType: 'string',
        },
      ]
      const result = generateAPIClient(routes, 'my-service', 'GeneratedMyService')

      expect(result).toMatchInlineSnapshot(`
        "/**
         * Auto-generated Cumulocity API Client
         * Generated by c8y-nitro
         *
         * This Angular service provides typed methods for all Nitro routes.
         * Each method corresponds to a route handler and returns properly typed responses.
         */
        import { Injectable, inject } from '@angular/core'
        import { FetchClient } from '@c8y/ngx-components'

        // Type helpers for proper serialization
        type JsonPrimitive = string | number | boolean | string | number | boolean | null;
        type NonJsonPrimitive = undefined | Function | symbol;
        type IsAny<T> = 0 extends 1 & T ? true : false;
        type FilterKeys<TObj extends object, TFilter> = { [TKey in keyof TObj]: TObj[TKey] extends TFilter ? TKey : never }[keyof TObj];
        type Serialize<T> = IsAny<T> extends true ? any : T extends JsonPrimitive | undefined ? T : T extends Map<any, any> | Set<any> ? Record<string, never> : T extends NonJsonPrimitive ? never : T extends {
          toJSON: () => infer U;
        } ? U : T extends [] ? [] : T extends [unknown, ...unknown[]] ? SerializeTuple<T> : T extends ReadonlyArray<infer U> ? (U extends NonJsonPrimitive ? null : Serialize<U>)[] : T extends object ? SerializeObject<T> : never;
        type SerializeTuple<T extends [unknown, ...unknown[]]> = { [k in keyof T]: T[k] extends NonJsonPrimitive ? null : Serialize<T[k]> };
        type SerializeObject<T extends object> = { [k in keyof Omit<T, FilterKeys<T, NonJsonPrimitive>>]: Serialize<T[k]> };
        type Simplify<TType> = TType extends any[] | Date ? TType : { [K in keyof TType]: Simplify<TType[K]> };
        type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;


        @Injectable({ providedIn: 'root' })
        export class GeneratedMyService {
          private readonly BASE_PATH = '/service/my-service';
          private readonly fetchClient: FetchClient = inject(FetchClient)

          constructor() {}

          async GetHealth(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }

          async PostHealth(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }

          async GetById(params: { id: string | number }): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/\${params.id}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }
        }
        "
      `)
    })

    it('should generate Angular service with correct microservice base', () => {
      const routes = [
        {
          path: '/someRoute',
          method: 'default',
          functionName: 'SomeRoute',
          params: [],
          returnType: 'string',
        },
      ]
      const result = generateAPIClient(routes, 'custom-ms', 'GeneratedCustomMs')
      expect(result).toMatchInlineSnapshot(`
        "/**
         * Auto-generated Cumulocity API Client
         * Generated by c8y-nitro
         *
         * This Angular service provides typed methods for all Nitro routes.
         * Each method corresponds to a route handler and returns properly typed responses.
         */
        import { Injectable, inject } from '@angular/core'
        import { FetchClient } from '@c8y/ngx-components'

        // Type helpers for proper serialization
        type JsonPrimitive = string | number | boolean | string | number | boolean | null;
        type NonJsonPrimitive = undefined | Function | symbol;
        type IsAny<T> = 0 extends 1 & T ? true : false;
        type FilterKeys<TObj extends object, TFilter> = { [TKey in keyof TObj]: TObj[TKey] extends TFilter ? TKey : never }[keyof TObj];
        type Serialize<T> = IsAny<T> extends true ? any : T extends JsonPrimitive | undefined ? T : T extends Map<any, any> | Set<any> ? Record<string, never> : T extends NonJsonPrimitive ? never : T extends {
          toJSON: () => infer U;
        } ? U : T extends [] ? [] : T extends [unknown, ...unknown[]] ? SerializeTuple<T> : T extends ReadonlyArray<infer U> ? (U extends NonJsonPrimitive ? null : Serialize<U>)[] : T extends object ? SerializeObject<T> : never;
        type SerializeTuple<T extends [unknown, ...unknown[]]> = { [k in keyof T]: T[k] extends NonJsonPrimitive ? null : Serialize<T[k]> };
        type SerializeObject<T extends object> = { [k in keyof Omit<T, FilterKeys<T, NonJsonPrimitive>>]: Serialize<T[k]> };
        type Simplify<TType> = TType extends any[] | Date ? TType : { [K in keyof TType]: Simplify<TType[K]> };
        type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;


        @Injectable({ providedIn: 'root' })
        export class GeneratedCustomMs {
          private readonly BASE_PATH = '/service/custom-ms';
          private readonly fetchClient: FetchClient = inject(FetchClient)

          constructor() {}

          async SomeRoute(): Promise<string> {
            const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/someRoute\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
            return response.json();
          }
        }
        "
      `)
    })
  })

  it('should generate a real world example correctly', () => {
    // The NitroTypes object has routes nested under .routes property
    const nitroTypes = {
      routes: {
        '/:id': {
          get: [
            'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/[id].get\').default>>>>',
          ],
        },
        '/api/:multiple/:params': {
          default: [
            'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/api/[multiple]/[params]\').default>>>>',
          ],
        },
        '/health': {
          get: [
            'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/health.get\').default>>>>',
          ],
          post: [
            'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/health.post\').default>>>>',
          ],
        },
        '/someRoute': {
          default: [
            'Simplify<Serialize<Awaited<ReturnType<typeof import(\'../../../routes/someRoute\').default>>>>',
          ],
        },
      },
    }

    // Types are generated in node_modules/.nitro/types/
    // Import paths like '../../../routes/...' are relative to that location
    const typesDir = '/home/someuser/projects/my-nitro-app/node_modules/.nitro/types'
    const outputDir = '/home/someuser/projects/otherProject/app/api-client'

    const parsedRoutes = parseRoutes(nitroTypes as any, outputDir, typesDir)
    const result = generateAPIClient(parsedRoutes, 'my-microservice', 'GeneratedMyMicroservice')

    expect(result).toMatchInlineSnapshot(`
      "/**
       * Auto-generated Cumulocity API Client
       * Generated by c8y-nitro
       *
       * This Angular service provides typed methods for all Nitro routes.
       * Each method corresponds to a route handler and returns properly typed responses.
       */
      import { Injectable, inject } from '@angular/core'
      import { FetchClient } from '@c8y/ngx-components'

      // Type helpers for proper serialization
      type JsonPrimitive = string | number | boolean | string | number | boolean | null;
      type NonJsonPrimitive = undefined | Function | symbol;
      type IsAny<T> = 0 extends 1 & T ? true : false;
      type FilterKeys<TObj extends object, TFilter> = { [TKey in keyof TObj]: TObj[TKey] extends TFilter ? TKey : never }[keyof TObj];
      type Serialize<T> = IsAny<T> extends true ? any : T extends JsonPrimitive | undefined ? T : T extends Map<any, any> | Set<any> ? Record<string, never> : T extends NonJsonPrimitive ? never : T extends {
        toJSON: () => infer U;
      } ? U : T extends [] ? [] : T extends [unknown, ...unknown[]] ? SerializeTuple<T> : T extends ReadonlyArray<infer U> ? (U extends NonJsonPrimitive ? null : Serialize<U>)[] : T extends object ? SerializeObject<T> : never;
      type SerializeTuple<T extends [unknown, ...unknown[]]> = { [k in keyof T]: T[k] extends NonJsonPrimitive ? null : Serialize<T[k]> };
      type SerializeObject<T extends object> = { [k in keyof Omit<T, FilterKeys<T, NonJsonPrimitive>>]: Serialize<T[k]> };
      type Simplify<TType> = TType extends any[] | Date ? TType : { [K in keyof TType]: Simplify<TType[K]> };
      type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T;


      @Injectable({ providedIn: 'root' })
      export class GeneratedMyMicroservice {
        private readonly BASE_PATH = '/service/my-microservice';
        private readonly fetchClient: FetchClient = inject(FetchClient)

        constructor() {}

        async GetById(params: { id: string | number }): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../my-nitro-app/routes/[id].get').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/\${params.id}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }

        async ApiByMultipleByParams(params: { multiple: string | number; params: string | number }): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../my-nitro-app/routes/api/[multiple]/[params]').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/api/\${params.multiple}/\${params.params}\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }

        async GetHealth(): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../my-nitro-app/routes/health.get').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }

        async PostHealth(): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../my-nitro-app/routes/health.post').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/health\`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }

        async SomeRoute(): Promise<Simplify<Serialize<Awaited<ReturnType<typeof import('../../../my-nitro-app/routes/someRoute').default>>>>> {
          const response = await this.fetchClient.fetch(\`\${this.BASE_PATH}/someRoute\`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
          return response.json();
        }
      }
      "
    `)
  })
})
