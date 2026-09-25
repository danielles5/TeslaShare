import { distribute, type rebuildDerivedState } from "./engine";

// Display-only summaries of allocations already assigned to the open period.
export function periodStats(derived: ReturnType<typeof rebuildDerivedState>) {
  const sharedIds = new Set(
    derived.open.events
      .filter((e) => e.possession === "shared")
      .map((e) => e.id),
  );
  return {
    lastRange: derived.lastRange,
    drives: derived.open.events.filter((e) => e.kind !== "charge" && e.ended_at)
      .length,
    idleLoss: derived.open.allocations.reduce(
      (sum, a) => sum + (a.source === "idle" ? Math.max(0, a.km) : 0),
      0,
    ),
    // Each Shared source has two half-allocations. Sum them once, never double them.
    sharedContribution: derived.open.allocations.reduce(
      (sum, a) => sum + (sharedIds.has(a.source_id) ? Math.max(0, a.km) : 0),
      0,
    ),
  };
}

export function monthlyResponsibility(
  usage: Record<string, number>,
  spend: number,
) {
  // Match the existing Danielle/Maya comparison, independent of payer or settlement.
  const participants = { danielle: usage.danielle || 0, maya: usage.maya || 0 };
  if (participants.danielle + participants.maya <= 0) {
    return spend === 0 ? { danielle: 0, maya: 0 } : null;
  }
  const amounts = distribute(spend, participants);
  return { danielle: amounts.danielle || 0, maya: amounts.maya || 0 };
}
