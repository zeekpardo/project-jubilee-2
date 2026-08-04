<script lang="ts">
	// The blog index's list of posts: title, date, a sentence or two, each linking
	// to its permalink. Shared by the campaign index and the record index, which
	// differ only in what `number` is.
	//
	// The excerpts are PLAIN TEXT, produced by `richTextExcerpt` in the load
	// function. An index of thirty posts rendering thirty bodies to HTML would ask
	// a donor on a phone to download thirty articles to read thirty titles, and
	// the markdown pipeline stays server-side either way.
	import UpdateDateline from '$lib/features/public-site/UpdateDateline.svelte';
	import UpdateLink from '$lib/features/public-site/UpdateLink.svelte';

	type Entry = {
		title: string;
		/** Permalink segment, minted when the post was published. */
		slug: string;
		/** Milliseconds, or null when the row was published before this was kept. */
		publishedAt: number | null;
		/** Plain text from `richTextExcerpt`. Never markup. */
		excerpt: string;
	};

	type Props = {
		updates: Entry[];
		orgSlug: string;
		campaignSlug: string;
		objectSlug: string;
		/** The record's number for a record blog; null for the campaign's. */
		number: string | null;
		class?: string;
	};

	let { updates, orgSlug, campaignSlug, objectSlug, number, class: className }: Props = $props();
</script>

<!-- Newest first, exactly as the query ordered them. Not re-sorted here:
     `publishedAt` is null for a row published before that column existed, and a
     client-side sort would have to invent a position for it. -->
<ol class={className}>
	{#each updates as update (update.slug)}
		<li class="border-border/60 border-b py-8 first:pt-0 last:border-b-0 last:pb-0">
			<h2 class="ps-serif text-foreground text-2xl leading-snug">
				<UpdateLink
					{orgSlug}
					{campaignSlug}
					{objectSlug}
					{number}
					slug={update.slug}
					class="hover:text-primary"
				>
					{update.title}
				</UpdateLink>
			</h2>
			<UpdateDateline publishedAt={update.publishedAt} class="mt-1" />
			{#if update.excerpt}
				<p class="text-muted-foreground mt-3 max-w-prose leading-relaxed">{update.excerpt}</p>
			{/if}
		</li>
	{/each}
</ol>
