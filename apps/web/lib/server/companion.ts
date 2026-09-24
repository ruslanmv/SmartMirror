import "server-only";

import { openSealed, seal } from "./seal";
import { sessionSecret, type SessionData } from "./session";

/**
 * Phone hand-off ticket. The screen's QR code carries it; the phone (not
 * paired, no cookie) sends it back with the photo. It is AES-GCM sealed, so
 * the phone cannot read the credential inside, and it only authorises
 * uploading a photo into one capture session for ten minutes.
 */
interface Ticket {
  v: 1;
  sid: string;
  session: Pick<SessionData, "kind" | "deviceToken" | "deviceId" | "nodeId"> | null;
  exp: number;
}

export async function issueTicket(sid: string, session: SessionData | null, ttlSeconds = 600): Promise<string> {
  const ticket: Ticket = {
    v: 1,
    sid,
    session: session
      ? { kind: session.kind, deviceToken: session.deviceToken, deviceId: session.deviceId, nodeId: session.nodeId }
      : null,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  return seal(ticket, sessionSecret());
}

export async function openTicket(raw: unknown): Promise<{ sid: string; session: SessionData | null } | null> {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  const t = await openSealed<Ticket>(raw, sessionSecret());
  if (!t || t.v !== 1 || typeof t.sid !== "string" || t.exp * 1000 < Date.now()) return null;
  const now = Math.floor(Date.now() / 1000);
  const session: SessionData | null = t.session ? { v: 1, ...t.session, ticket: true, iat: now, exp: t.exp } : null;
  return { sid: t.sid, session };
}
