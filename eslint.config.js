import schplitt from '@schplitt/eslint-config'

export default schplitt({
  ignores: ['__snapshots__/**/*', 'src/types/roles.generated.ts'],
}).overrideRules({
  'antfu/no-top-level-await': 'off',
})
