import { defineNitroPlugin } from 'nitropack/runtime'
import { close, initDb, runRetention } from '../db/client'

export default defineNitroPlugin(async (nitroApp) => {
  await initDb()
  console.info('[db] initialized')

  try {
    const result = runRetention()
    console.info('[db] retention cleanup complete:', JSON.stringify(result))
  } catch (error) {
    console.error('[db] retention cleanup failed:', error)
  }

  nitroApp.hooks.hook('close', () => {
    close()
    console.info('[db] closed')
  })
})
