import { defineEventHandler, setHeader } from 'h3'
import { initDb, getRefreshRunState, getLatestSnapshot } from '../db/client'
import { buildDiagnostics } from '../lib/build-diagnostics'

export default defineEventHandler(async (event) => {
  await initDb()
  setHeader(event, 'Cache-Control', 'no-cache')
  return buildDiagnostics(getRefreshRunState(), getLatestSnapshot())
})
