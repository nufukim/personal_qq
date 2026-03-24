import type { PluginRuntime } from 'openclaw/plugin-sdk'

let _runtime: PluginRuntime | null = null

export function setQQPersonalRuntime(runtime: PluginRuntime): void {
  _runtime = runtime
}

export function getQQPersonalRuntime(): PluginRuntime {
  if (!_runtime) {
    throw new Error('QQ Personal runtime not initialized — call setQQPersonalRuntime() first')
  }
  return _runtime
}
