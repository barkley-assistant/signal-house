import { defineNitroPlugin } from 'nitropack/runtime'
import { getPollerConfig, startMetricsPoller } from '../lib/poller'

export default defineNitroPlugin(() => {
  const config = getPollerConfig()
  if (!config.enabled) {
    console.info('[poller] disabled')
    return
  }

  startMetricsPoller(config)
  console.info('[poller] started')
})
