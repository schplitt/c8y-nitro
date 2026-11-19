import { fileURLToPath } from 'node:url'
import { vol, fs as memFs } from 'memfs'
import { join } from 'pathe'
import ts from 'typescript'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { C8YManifest } from '../../src/types'
import { setupRuntime } from '../../src/module/runtime'

// Mock fs modules with memfs (only the generator's writes; TypeScript reads the real disk)
vi.mock('fs', () => ({ ...memFs, default: memFs }))
vi.mock('fs/promises', () => memFs.promises)

// Type-checks a consumer file against the built package (`dist`, resolved through
// the package's self-reference) with the generated declarations included, the
// way a project includes `node_modules/.c8y-nitro/*.d.ts` in its tsconfig.
// The consumer lives in a virtual directory inside the repo so `c8y-nitro/*`
// resolves to this package. Requires a fresh `pnpm build`: a stale `dist`
// makes this test check the old types.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const projectDir = join(repoRoot, '.virtual-consumer')

function typeCheck(consumer: string, manifest?: C8YManifest): string[] {
  const virtualFiles = new Map<string, string>()
  if (manifest) {
    vol.reset()
    setupRuntime({
      options: { rootDir: projectDir, virtual: {} },
      logger: { debug: vi.fn() },
    } as unknown as Parameters<typeof setupRuntime>[0], manifest)
    for (const [path, content] of Object.entries(vol.toJSON())) {
      virtualFiles.set(path, content as string)
    }
  }
  const consumerPath = join(projectDir, 'consumer.ts')
  virtualFiles.set(consumerPath, consumer)

  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    lib: ['lib.esnext.d.ts'],
    moduleDetection: ts.ModuleDetectionKind.Force,
    types: [],
  }
  const host = ts.createCompilerHost(options)
  const { fileExists, readFile, getSourceFile } = host
  host.fileExists = (f) => virtualFiles.has(f) || fileExists(f)
  host.readFile = (f) => virtualFiles.get(f) ?? readFile(f)
  host.getSourceFile = (f, lang, ...rest) => {
    const content = virtualFiles.get(f)
    return content !== undefined
      ? ts.createSourceFile(f, content, lang)
      : getSourceFile(f, lang, ...rest)
  }

  const program = ts.createProgram([...virtualFiles.keys()], options, host)
  // Only diagnostics of the consumer and the generated files: dependencies'
  // own declaration files are not under test.
  const diagnostics = [
    ...program.getGlobalDiagnostics(),
    ...[...virtualFiles.keys()].flatMap((f) => {
      const sf = program.getSourceFile(f)
      return sf ? [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)] : []
    }),
  ]
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
}

const expectHelper = `
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function assert<_T extends true>() {}
`

describe('generated type declarations', () => {
  beforeEach(() => {
    vol.reset()
  })

  it('keep the real exports of c8y-nitro/types and narrow the generated types', () => {
    const errors = typeCheck(`
import type { C8YManifestOptions, C8YManifest, C8YRoles, C8YTenantOptionKey, C8YTenantOptionKeysCacheConfig, C8YSettingsCategory } from 'c8y-nitro/types'
import { c8yManifest, c8yRoles, c8yTenantOptionKeys } from 'c8y-nitro/runtime'
${expectHelper}
export const options: C8YManifestOptions = { roles: ['ROLE_X'] }
assert<Equal<keyof C8YRoles, 'ROLE_X' | 'ROLE_Y'>>()
assert<Equal<C8YTenantOptionKey, 'a.key' | 'b.key'>>()
assert<Equal<C8YTenantOptionKeysCacheConfig, { 'a.key'?: number, 'b.key'?: number }>>()
assert<Equal<C8YSettingsCategory, 'my-service'>>()
assert<Equal<typeof c8yManifest, C8YManifest>>()
assert<Equal<typeof c8yRoles, C8YRoles>>()
assert<Equal<typeof c8yTenantOptionKeys, readonly ['a.key', 'b.key']>>()
`, {
      roles: ['ROLE_X', 'ROLE_Y'],
      settings: [{ key: 'a.key', defaultValue: '1' }, { key: 'b.key', defaultValue: '2' }],
      settingsCategory: 'my-service',
    } as C8YManifest)

    expect(errors).toEqual([])
  })

  it('generates never tenant option keys and a string settings category from an empty manifest', () => {
    const errors = typeCheck(`
import type { C8YManifestOptions, C8YRoles, C8YTenantOptionKey, C8YSettingsCategory } from 'c8y-nitro/types'
${expectHelper}
export const options: C8YManifestOptions = {}
assert<Equal<keyof C8YRoles, never>>()
assert<Equal<C8YTenantOptionKey, never>>()
assert<Equal<C8YSettingsCategory, string>>()
`, {} as C8YManifest)

    expect(errors).toEqual([])
  })

  it('keeps string defaults without any generated file', () => {
    const errors = typeCheck(`
import type { C8YTenantOptionKey, C8YSettingsCategory } from 'c8y-nitro/types'
${expectHelper}
assert<Equal<C8YTenantOptionKey, string>>()
assert<Equal<C8YSettingsCategory, string>>()
`)

    expect(errors).toEqual([])
  })
})
