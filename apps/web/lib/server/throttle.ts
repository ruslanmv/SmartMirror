import "server-only";

/**
 * Best-effort, per-instance attempt counter. Serverless instances do not share
 * memory, so put a platform firewall rule in front for real limits.
 */
export function createThrottle(max: number, windowMs: number) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return function throttled(key: string): boolean {
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt < now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > max;
  };
}

export function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
