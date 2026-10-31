/**
 * Mocked personalisation.
 *
 * A fake sign-in returning a Gold-tier member: 10% off, access to member-only SKUs, and a saved
 * pincode. This exists to demonstrate tier pricing and gated inventory in a demo WITHOUT
 * standing up real OAuth.
 *
 * It is deliberately not an auth system and must never be mistaken for one:
 *   - the token is a plain opaque string, not signed and not a credential
 *   - it grants nothing beyond a price multiplier and a visibility flag
 *   - there is no user data behind it beyond what is in this file
 *
 * A real deployment replaces this module with the merchant's own identity provider. The rest of
 * the server only ever sees the `Member` shape, so nothing else changes.
 */

export interface Member {
  id: string;
  displayName: string;
  tier: "gold" | "silver";
  /** Percentage off the catalog price. Applied server-side in pricing.ts. */
  discountPct: number;
  /** Saved delivery pincode, used as the default for availability strings. */
  pincode: string;
  canSeeMemberOnly: boolean;
}

const DEMO_MEMBERS: Record<string, Member> = {
  "gold-demo": {
    id: "gold-demo",
    displayName: "Demo Gold Member",
    tier: "gold",
    discountPct: 10,
    pincode: "400013",
    canSeeMemberOnly: true,
  },
  "silver-demo": {
    id: "silver-demo",
    displayName: "Demo Silver Member",
    tier: "silver",
    discountPct: 5,
    pincode: "560038",
    canSeeMemberOnly: false,
  },
};

export const DEFAULT_DEMO_MEMBER_ID = "gold-demo";

export function resolveMember(memberId: string | null | undefined): Member | null {
  if (!memberId) return null;
  return DEMO_MEMBERS[memberId] ?? null;
}

/**
 * The mock sign-in. Accepts any of the demo ids, or the literal string "demo" which maps to the
 * Gold member so a presenter never has to remember an id on stage.
 */
export function mockSignIn(memberId?: string | null): Member | null {
  if (!memberId) return null;
  if (memberId === "demo") return DEMO_MEMBERS[DEFAULT_DEMO_MEMBER_ID];
  return resolveMember(memberId);
}

export function describeMember(member: Member | null): string {
  if (!member) return "Not signed in. Member prices and member-only styles are hidden.";
  return (
    `Signed in as ${member.displayName} (${member.tier} tier): ` +
    `${member.discountPct}% off, member-only styles visible, delivering to ${member.pincode}.`
  );
}
