<script lang="ts">
	// Every link into the donor-facing blog, and the only place its URLs are
	// built. Four routes exist — a campaign index, a campaign permalink, a record
	// index, a record permalink — and they differ only in whether a record number
	// is in the path and whether an update slug is. Spreading that decision across
	// the feed, the index list and the two page headers would mean four chances to
	// send a supporter to a campaign post under a record's URL.
	//
	// THE `resolve()` CALLS ARE INLINE IN THE href FOR A REASON. `svelte`'s
	// `no-navigation-without-resolve` rule reads the href expression itself: it
	// follows a plain `const` to its initializer and it walks both arms of a
	// conditional, but it cannot see through `$derived(...)` or a member access,
	// so `href={someHref}` reports even when `someHref` came from `resolve()`.
	// Hoisting these for tidiness would trade a genuine check for a suppression
	// comment. Concentrating them here is what keeps that cost to one file.
	import { resolve } from '$app/paths';
	import { cn } from '$lib/primitives/utils';
	import type { Snippet } from 'svelte';

	type Props = {
		orgSlug: string;
		campaignSlug: string;
		/** Frozen at campaign creation, so a label rename never moves these URLs. */
		objectSlug: string;
		/** The record's number for a record-level link; null for campaign level. */
		number: string | null;
		/** The update's slug, or null to link the blog index rather than a post. */
		slug: string | null;
		class?: string;
		children: Snippet;
	};

	let {
		orgSlug,
		campaignSlug,
		objectSlug,
		number,
		slug,
		class: className,
		children
	}: Props = $props();
</script>

<a
	href={slug === null
		? number === null
			? resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/updates', {
					orgSlug,
					campaignSlug,
					objectSlug
				})
			: resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/[number]/updates', {
					orgSlug,
					campaignSlug,
					objectSlug,
					number
				})
		: number === null
			? resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/updates/[updateSlug]', {
					orgSlug,
					campaignSlug,
					objectSlug,
					updateSlug: slug
				})
			: resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/[number]/updates/[updateSlug]', {
					orgSlug,
					campaignSlug,
					objectSlug,
					number,
					updateSlug: slug
				})}
	class={cn('transition-colors', className)}
>
	{@render children()}
</a>
