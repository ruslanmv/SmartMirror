import { toErrorResponse } from "@/lib/server/backend";
import { getConfig } from "@/lib/server/config";
import { PairingError, clearPending, pollDevicePairing, readPending } from "@/lib/server/pairing";
import { writeSession } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store" } };

/**
 * Poll a pending TV-style pairing. On approval the device token is sealed into
 * the session cookie; the response only says "approved".
 */
export async function POST() {
  try {
    const pending = await readPending();
    if (!pending) return Response.json({ status: "expired" }, NO_STORE);

    if (pending.deviceCode === "demo") {
      if (getConfig().mode !== "demo") {
        await clearPending();
        return Response.json({ status: "expired" }, NO_STORE);
      }
      if ((pending.approveAt ?? 0) > Date.now()) return Response.json({ status: "pending" }, NO_STORE);
      await writeSession({ kind: "demo", deviceName: pending.deviceName });
      await clearPending();
      return Response.json({ status: "approved", kind: "demo" }, NO_STORE);
    }

    const outcome = await pollDevicePairing(pending.deviceCode, pending.platform);
    if (outcome.status === "pending") return Response.json({ status: "pending" }, NO_STORE);
    await clearPending();
    if (outcome.status === "expired") return Response.json({ status: "expired" }, NO_STORE);

    await writeSession({
      kind: "device",
      deviceToken: outcome.token,
      deviceId: outcome.deviceId ?? undefined,
      deviceName: pending.deviceName,
    });
    return Response.json({ status: "approved", kind: "device" }, NO_STORE);
  } catch (err) {
    // Transient upstream trouble: the screen keeps polling.
    if (err instanceof PairingError && err.code === "upstream") {
      return Response.json({ status: "pending", warning: err.message }, NO_STORE);
    }
    if (err instanceof PairingError) return Response.json({ error: err.message, code: err.code }, { status: err.status });
    return toErrorResponse(err);
  }
}

/** Cancel a pending pairing (the screen left the page or asked for a new code). */
export async function DELETE() {
  await clearPending();
  return Response.json({ ok: true });
}
