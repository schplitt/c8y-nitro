# API Client Generation

If your microservice has a separate Angular frontend, `c8y-nitro` can generate a typed client from the server routes so your UI is not maintained as a second manual API contract.

## Configuration

```ts
export default defineNitroConfig({
  c8y: {
    apiClient: {
      dir: '../ui/src/app/services',
      contextPath: 'my-service',
    },
  },
  modules: [c8y()],
})
```

`dir` is required and is resolved relative to the Nitro config file.

## Generated Client Shape

The generated service creates one method per route with inferred params and response types.

```ts
@Injectable({ providedIn: 'root' })
export class GeneratedMyServiceAPIClient {
  async GETHealth(): Promise<{ status: string }> {}
  async GETUsersById(params: { id: string | number }): Promise<User> {}
  async POSTUsers(body: CreateUserDto): Promise<User> {}
}
```

The context path defaults to the manifest context path. Override it only when the deployed service path intentionally differs.

## Angular Usage

```ts
import { GeneratedMyServiceAPIClient } from './services/my-serviceAPIClient'

@Component({
  selector: 'app-root',
  template: '',
})
export class MyComponent {
  private api = inject(GeneratedMyServiceAPIClient)

  async ngOnInit() {
    const health = await this.api.GETHealth()
    const user = await this.api.GETUsersById({ id: 123 })

    return { health, user }
  }
}
```

> **Note**: The client regenerates automatically when routes change during development.