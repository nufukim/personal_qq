import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk'
import type { OpenClawPluginApi } from 'openclaw/plugin-sdk'
import { qqPersonalPlugin } from './src/channel.js'
import { setQQPersonalRuntime } from './src/runtime.js'

const plugin = {
  id: 'qq-personal',
  name: 'QQ Personal',
  description: 'Personal QQ account channel via NapCatQQ (OneBot v11)',
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setQQPersonalRuntime(api.runtime)
    api.registerChannel({ plugin: qqPersonalPlugin })
  },
}

export default plugin
export { qqPersonalPlugin } from './src/channel.js'
export { setQQPersonalRuntime, getQQPersonalRuntime } from './src/runtime.js'
