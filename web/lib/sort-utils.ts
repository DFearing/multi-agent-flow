/** Merge two sorted-by-timestamp arrays into a fresh sorted array. O(N + M).
 *  Used to incrementally extend cached sorted feeds without re-sorting the
 *  whole collection on every append. */
export function mergeByTimestamp<T extends { timestamp: number }>(a: readonly T[], b: readonly T[]): T[] {
  if (a.length === 0) return b.slice()
  if (b.length === 0) return a.slice()
  const out = new Array<T>(a.length + b.length)
  let i = 0, j = 0, k = 0
  while (i < a.length && j < b.length) {
    if (a[i].timestamp <= b[j].timestamp) out[k++] = a[i++]
    else out[k++] = b[j++]
  }
  while (i < a.length) out[k++] = a[i++]
  while (j < b.length) out[k++] = b[j++]
  return out
}
