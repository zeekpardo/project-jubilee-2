// ============================================================
// Public policy — the privacy dials an org owns
// ============================================================
// Two of the wall's rules were single constants in this codebase, which meant
// every organization inherited the first one's judgement. They are different
// judgements for different orgs:
//
//   - The small-count floor is right when a record is a trafficked family and
//     unnecessary when a record is a well being drilled. An org publishing
//     infrastructure counts loses information to a rule written for people.
//   - The protected-key denylist carried one org's integration
//     (`managed_missions_link`) as a rule for everybody, while an org with
//     different risks — a legal-aid charity, say — had no way to add its own.
//
// So both become per-org, with the shipped values as the defaults. Nothing
// about an org that has set neither changes.
//
// Pure, like every other lib/domain module: it turns an orgSettings row into a
// policy object and nothing more. The reading is deliberately one-directional —
// an org may TIGHTEN the shared denylist, never shorten it, because the keys on
// it can out someone still escaping forced labour and that is not a per-tenant
// decision.
// ============================================================

/** The shipped floor. An org may raise or lower it; see `publicCountThreshold`. */
export const DEFAULT_PUBLIC_COUNT_THRESHOLD = 5;

export interface PublicPolicy {
	/**
	 * A public count below this is withheld. 0 disables suppression, which is a
	 * real choice for an org whose records are not people.
	 */
	countThreshold: number;
	/** Keys this org protects ON TOP of the shared denylist. Never instead of. */
	extraProtectedKeys: string[];
}

export const DEFAULT_PUBLIC_POLICY: PublicPolicy = {
	countThreshold: DEFAULT_PUBLIC_COUNT_THRESHOLD,
	extraProtectedKeys: []
};

/** The subset of an orgSettings row this cares about. */
export interface PublicPolicySettings {
	publicCountThreshold?: number;
	protectedFieldKeys?: string[];
}

/**
 * An org's policy, with the shipped defaults for anything it has not set.
 *
 * A missing settings row yields the defaults rather than an empty policy: the
 * wall must be at its strictest when it knows least, not at its loosest.
 */
export function resolvePublicPolicy(
	settings: PublicPolicySettings | null | undefined
): PublicPolicy {
	const threshold = settings?.publicCountThreshold;
	return {
		countThreshold:
			typeof threshold === 'number' && Number.isFinite(threshold) && threshold >= 0
				? Math.floor(threshold)
				: DEFAULT_PUBLIC_COUNT_THRESHOLD,
		extraProtectedKeys: (settings?.protectedFieldKeys ?? [])
			.map((key) => key.trim())
			.filter((key) => key !== '')
	};
}
