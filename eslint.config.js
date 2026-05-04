import schplitt from '@schplitt/eslint-config'

export default schplitt({
  ignores: ['__snapshots__/**/*'],
}).overrideRules({
  'antfu/no-top-level-await': 'off',
})
