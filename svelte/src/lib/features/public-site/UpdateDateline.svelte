<script lang="ts">
	// The "published on ..." line, in one component because five surfaces show it
	// and they must agree: the feed's lead, the feed's headlines, both blog
	// indexes and both permalinks.
	import { cn } from '$lib/primitives/utils';
	import * as m from '$lib/i18n/messages';

	type Props = {
		/** Milliseconds, or null when the row was published before this was kept. */
		publishedAt: number | null;
		class?: string;
	};

	let { publishedAt, class: className }: Props = $props();

	/**
	 * An explicit locale rather than the ambient one. These pages are rendered on
	 * a server and then held in a CDN for five minutes, so whatever locale the
	 * rendering machine happened to have would be baked into the copy every
	 * visitor is served — and the hydrating client, formatting the same timestamp
	 * under a different default, would disagree with the markup it was given.
	 */
	function formatPublishedAt(ms: number): string {
		return new Date(ms).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<!-- Nothing at all rather than an empty line for a row published before the
     column existed: an undated post reads better than one dated "Invalid Date". -->
{#if publishedAt !== null}
	<p class={cn('text-muted-foreground text-xs', className)}>
		{m.updates_publishedOn({ date: formatPublishedAt(publishedAt) })}
	</p>
{/if}
