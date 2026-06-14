import { defineEventHandler, setHeader } from 'h3'
import { initDb, getLatestState } from '../db/client'

export default defineEventHandler(async (event) => {
  await initDb()
  setHeader(event, 'Cache-Control', 'no-cache')
  const state = getLatestState()
  return state
})
