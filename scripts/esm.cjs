const fs = require('node:fs')
const api = require('../dist/index.js')
const names = Object.keys(api)
fs.writeFileSync(
  'dist/index.mjs',
  `import api from './index.js';\nexport const { ${names.join(', ')} } = api;\nexport default api.MotionGateway;\n`
)
fs.writeFileSync(
  'dist/index.d.mts',
  "export * from './index.js';\nexport { MotionGateway as default } from './index.js';\n"
)
