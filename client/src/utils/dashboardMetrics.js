/**
 * Pure metrics helpers for the admin dashboard gauges.
 */

/**
 * App-memory gauge percentage. The meaningful ceiling for the Node process
 * is the V8 heap limit (heap_size_limit — ~4GB by default, or whatever
 * --max-old-space-size sets), NOT heapTotal: heapTotal is only the heap V8
 * has allocated so far, and the garbage collector deliberately keeps live
 * usage near it before growing it. Dividing by heapTotal therefore showed
 * 85-95% red on a perfectly healthy process.
 *
 * Falls back to heapTotal for payloads from an older server that does not
 * send heapLimit yet.
 */
export function appMemoryPct(memory) {
  if (!memory || typeof memory !== "object") return 0;
  const used = Number(memory.heapUsed) || 0;
  const limit = Number(memory.heapLimit) || 0;
  const allocated = Number(memory.heapTotal) || 0;
  const base = limit > 0 ? limit : allocated;
  if (base <= 0 || used <= 0) return 0;
  return Math.min(100, Math.round((used / base) * 100));
}

/**
 * The byte figure the app-memory gauge should show as its ceiling: the V8
 * heap limit when present, otherwise the allocated heap (old servers).
 */
export function appMemoryCeiling(memory) {
  if (!memory || typeof memory !== "object") return 0;
  const limit = Number(memory.heapLimit) || 0;
  if (limit > 0) return limit;
  return Number(memory.heapTotal) || 0;
}
