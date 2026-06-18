import { defineEventHandler } from 'h3'
import { verifyAccess } from '../lib/access-protection'

export default defineEventHandler((event) => {
  verifyAccess(event)
})
