import { runRefresh } from '../lib/refresh/run-refresh'

export default defineEventHandler(async () => {
  const result = await runRefresh()
  if (result.skipped) {
    throw createError({
      statusCode: 409,
      statusMessage: result.errorSummary ?? 'Refresh already in progress',
    })
  }

  return {
    started: true,
    ...result,
  }
})
