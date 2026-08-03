<script lang="ts">
	// One sentence on a public page telling the person reading it what THEY have
	// already given to the record in front of them, and nothing else. Never a
	// supporter count, never anyone else's giving: `model/site.ts` cannot return
	// those and this component must not imply them either.
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	/**
	 * A record page names both the record and the label to call it by; the
	 * campaign listing names neither. The union makes that pairing a type error
	 * rather than a sentence reading "You've given $250 to this ".
	 */
	type Props = {
		orgSlug: string;
		campaignSlug: string;
		/** Optional, for layout composition (e.g. `mt-4` inside the funding aside). */
		class?: string;
	} & (
		| { projectNumber: string; objectLabel: string }
		| { projectNumber?: undefined; objectLabel?: undefined }
	);

	let { orgSlug, campaignSlug, projectNumber, objectLabel, class: className }: Props = $props();

	// `api` comes through the auth context rather than a direct import, the same
	// as everywhere else in this app, so a component never reaches past the
	// provider for its backend handle.
	const { api } = getAuthContext();
	const auth = useAuth();

	// `projectNumber` is omitted rather than passed as undefined: the argument's
	// absence is what tells the backend to sum the whole campaign instead of one
	// record, and an explicit undefined is a different thing to serialize.
	const args = $derived(
		projectNumber === undefined
			? { orgSlug, campaignSlug }
			: { orgSlug, campaignSlug, projectNumber }
	);

	// Skipping while signed out is not an optimization. Most visitors to a
	// donation page have no session at all, and asking the backend what they gave
	// would be a subscription per anonymous reader for an answer already known to
	// be nothing.
	const givingResponse = useQuery(api.site.queries.getMyGivingForRecord, () =>
		auth.isAuthenticated ? args : 'skip'
	);

	// The `(site)` layout load sets `cache-control: public, s-maxage=300`, so its
	// HTML is shared by every visitor a CDN serves it to — one donor's total in
	// that response is handed to the next stranger who asks for the page.
	// `hydrated` is only ever set from an effect, which never runs on the server
	// and runs after hydration on the client, so the cached markup and the first
	// client render are the same anonymous markup and the note can only appear
	// afterwards, in one browser.
	//
	// The lint rule below wants a writable `$derived` and must not get one: a
	// derived expression is evaluated during SSR, and there is no expression
	// that reads false on the server and true in the browser. The effect IS the
	// signal, and the disable is here so an `eslint --fix` cannot quietly trade
	// this guarantee for a tidier line.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let hydrated = $state(false);
	$effect(() => {
		hydrated = true;
	});

	// Loading, skipped, failed and "gave nothing" all collapse to null, because
	// all four have the same thing to say to the reader: nothing at all. A
	// personalization query that threw its way onto the screen would take a
	// working donation page down with it, so a broken note can only ever cost the
	// note.
	const giving = $derived(hydrated && !givingResponse.error ? (givingResponse.data ?? null) : null);

	const sentence = $derived.by(() => {
		if (!giving) return null;
		const amount = formatCents(giving.totalCents);
		// The label is the campaign's own word for a record ("family"), and it
		// lands mid-sentence, so it is lowercased the same way the page titles
		// around it lowercase it.
		return objectLabel === undefined
			? m.publicSite_yourGivingToCampaign({ amount })
			: m.publicSite_yourGivingToRecord({ amount, label: objectLabel.toLowerCase() });
	});

	// The same reading of an ISO day the portal's giving page gives `occurredOn`,
	// which is the identical shape from the identical column. Null when every
	// matching gift was recorded without a date — the line is dropped rather than
	// filled with an "unknown", since the total above already carries the point.
	const lastGiftOn = $derived(
		giving?.lastGiftOn ? new Date(giving.lastGiftOn).toLocaleDateString() : null
	);
</script>

<!-- Nothing renders for a stranger, for a signed-in visitor who has given here
     nothing, or while the answer is still in flight: no box, no skeleton, no
     reserved space. The page a stranger sees is the page that was cached. -->
{#if sentence}
	<div class={className}>
		<p class="ps-serif text-foreground text-base leading-relaxed">{sentence}</p>
		{#if lastGiftOn}
			<p class="text-muted-foreground mt-1 text-xs">
				{m.publicSite_yourGivingLastGift({ date: lastGiftOn })}
			</p>
		{/if}
	</div>
{/if}
