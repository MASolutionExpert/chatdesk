/**
 * ICE failure summary for call debugging: which candidate types were
 * gathered (host/srflx/relay) and what state each pair reached when the
 * connection failed. Addresses stay mDNS-obfuscated by the browser, so no
 * private IPs are printed or kept.
 *
 * The returned summary is also surfaced on the call screen, so the failure
 * message can say WHY the media path could not connect (no relay candidates
 * although TURN is configured, no server-reflexive candidates because UDP
 * is blocked, ...) instead of a generic "Call failed".
 */

/**
 * Collect the gathered local candidate types and the candidate-pair states
 * from a live (or just-failed) peer connection. Never throws.
 */
export async function buildIceSummary(pc) {
  const summary = {
    connection: pc?.connectionState || null,
    ice: pc?.iceConnectionState || null,
    signaling: pc?.signalingState || null,
    localTypes: [],
    remoteTypes: [],
    pairStates: [],
    nominatedPair: null,
  };
  if (!pc || typeof pc.getStats !== "function") return summary;
  try {
    const stats = await pc.getStats();
    const kinds = new Map();
    const pairs = [];
    stats.forEach((report) => {
      if (
        report.type === "local-candidate" ||
        report.type === "remote-candidate"
      ) {
        const label = report.candidateType || "?";
        kinds.set(report.id, `${label}/${report.protocol || "?"}`);
        const bucket =
          report.type === "local-candidate" ? summary.localTypes : summary.remoteTypes;
        if (!bucket.includes(label)) bucket.push(label);
      } else if (report.type === "candidate-pair") {
        pairs.push(report);
      }
    });
    for (const pair of pairs) {
      if (pair.state) summary.pairStates.push(pair.state);
      if (pair.nominated || pair.state === "succeeded") {
        summary.nominatedPair = `${kinds.get(pair.localCandidateId) || "?"} -> ${
          kinds.get(pair.remoteCandidateId) || "?"
        }`;
      }
    }
  } catch (_) {}
  return summary;
}

/**
 * One-line verdict about the gathered candidates, used by the call screen:
 * - "relay"        -> TURN candidates were gathered (a relay exists)
 * - "srflx"        -> STUN worked but no relay (no TURN configured/reachable)
 * - "host"         -> even STUN failed: UDP is blocked or the network is broken
 * - "none"         -> no candidates gathered at all (capture/ICE never started)
 */
export function candidateReachVerdict(summary) {
  const local = summary?.localTypes || [];
  if (local.includes("relay")) return "relay";
  if (local.includes("srflx") || local.includes("prflx")) return "srflx";
  if (local.includes("host")) return "host";
  return "none";
}

/**
 * Console-only diagnostics log. Returns undefined (its result is only for
 * the console); use buildIceSummary() when the data itself is needed.
 */
export async function logIceDiagnostics(pc, reason) {
  try {
    const candidateKinds = new Map();
    const pairs = [];
    if (pc && typeof pc.getStats === "function") {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (
          report.type === "local-candidate" ||
          report.type === "remote-candidate"
        ) {
          candidateKinds.set(
            report.id,
            `${report.candidateType || "?"}/${report.protocol || "?"}`,
          );
        } else if (report.type === "candidate-pair") {
          pairs.push(report);
        }
      });
    }
    const pairLabel = (pair) =>
      `${candidateKinds.get(pair.localCandidateId) || "?"} -> ${
        candidateKinds.get(pair.remoteCandidateId) || "?"
      }:${pair.state}${pair.nominated ? " nominated" : ""}`;
    const summary = await buildIceSummary(pc);
    console.warn(
      `[call] ICE ${reason}:`,
      JSON.stringify({
        ...summary,
        pairs: pairs.map(pairLabel),
      }),
    );
  } catch (_) {}
}
