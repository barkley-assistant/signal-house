/**
 * Null-aware arithmetic for nullable metrics.
 *
 * The "unknown vs measured" contract (issue #343) requires that nullable
 * numeric metrics preserve their null semantics through aggregation:
 *   - `sumOrNull([])`           → null (nothing to sum)
 *   - `sumOrNull([null, null])` → null (everything is unknown)
 *   - `sumOrNull([null, 1, 2])` → 3   (nulls skipped, non-nulls summed)
 *
 * Using `?? 0` on a null metric is a class of bug this helper exists to
 * prevent: it silently converts "no measurement" into "zero", which
 * downstream rendering treats as a real data point.
 */

/**
 * Sum an array of nullable numbers, returning `null` when every element
 * is `null` or the array is empty. Non-null values are summed; nulls are
 * skipped. Returns `number` (not `null`) as soon as at least one
 * non-null value is observed.
 */
export function sumOrNull(values: ReadonlyArray<number | null>): number | null {
  let hasValue = false
  let sum = 0
  for (const v of values) {
    if (v != null) {
      hasValue = true
      sum += v
    }
  }
  return hasValue ? sum : null
}
