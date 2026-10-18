/** Per-instance, best-effort sliding window. */
const hits = new Map<string, number[]>();

export function rateLimited(ip: string, limit = 30, windowMs = 60_000, now = Date.now()): boolean {
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) {
    hits.set(ip, arr);
    return true;
  }
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) for (const k of hits.keys()) { hits.delete(k); if (hits.size < 2500) break; }
  return false;
}

export function resetRateLimit(): void {
  hits.clear();
}
