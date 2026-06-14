import { defineEventHandler, setHeader, createError } from 'h3'
import { initDb, getAggregatesByType } from '../../db/client'
import type { AggregateType } from '../../../types/aggregates'

export default defineEventHandler(async (event) => {
  await initDb()
  setHeader(event, 'Cache-Control', 'no-cache')
  const { type } = event.context.params ?? {}
  if (!type || !['throughput', 'cycleTime', 'ci', 'sessionUsage'].includes(type)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid aggregate type' })
  }
  const aggregates = getAggregatesByType(type as AggregateType, 30)
  return aggregates
})
