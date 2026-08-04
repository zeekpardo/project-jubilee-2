<script lang="ts">
	// What a campaign has told its supporters since they gave, on the donor-facing
	// page. The bodies arriving here are ALREADY sanitized HTML produced by
	// `renderRichText` in the page's load function — this component never sees
	// markdown and never imports the renderer, which is what keeps the whole
	// markdown pipeline out of a bundle served to strangers.
	import { RichTextBody } from '$lib/features/rich-text';
	import * as m from '$lib/i18n/messages';

	type Update = {
		title: string;
		/** Milliseconds, or null when the row was published before this was kept. */
		publishedAt: number | null;
		/** Sanitized HTML from the load function. Never raw admin markdown. */
		html: string;
	};

	type Props = {
		updates: Update[];
		/** Optional, for layout composition (e.g. `mt-10` under the story). */
		class?: string;
	};

	let { updates, class: className }: Props = $props();

	/**
	 * An explicit locale rather than the ambient one. These pages are rendered on
	 * a server and then held in a CDN for five minutes, so whatever locale the
	 * rendering machine happened to have would be baked into the copy every
	 * visitor is served — and the hydrating client, formatting the same timestamp
	 * under a different default, would disagree with the markup it was given.
	 */
	function formatPublishedAt(publishedAt: number): string {
		return new Date(publishedAt).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	}
</script>

<!-- Nothing at all when there is nothing to say: no heading, no "no updates yet"
     box. A record whose campaign has never posted should read exactly as it did
     before this feature existed, rather than acquiring an empty section that
     tells a donor the org has been silent. -->
{#if updates.length > 0}
	<section class={className}>
		<h2 class="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">
			{m.updates_publicHeading()}
		</h2>

		<!-- Newest first, exactly as the query ordered them. Not re-sorted here:
		     `publishedAt` is null for a row published before that column existed,
		     and a client-side sort would have to invent a position for it. -->
		<div class="divide-border/60 mt-4 divide-y">
			{#each updates as update, index (index)}
				<article class="py-8 first:pt-0 last:pb-0">
					<h3 class="ps-serif text-foreground text-2xl leading-snug">{update.title}</h3>
					{#if update.publishedAt !== null}
						<p class="text-muted-foreground mt-1 text-xs">
							{m.updates_publishedOn({ date: formatPublishedAt(update.publishedAt) })}
						</p>
					{/if}
					<div class="mt-4">
						<RichTextBody html={update.html} />
					</div>
				</article>
			{/each}
		</div>
	</section>
{/if}
