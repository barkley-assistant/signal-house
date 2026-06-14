import { initDb, getLatestState } from '../db/client'

export default defineEventHandler(async () => {
  await initDb()
  const state = getLatestState()
  return state
})
