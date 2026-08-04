<script lang="ts">
	// What a campaign has told its supporters since they gave, as it appears on
	// the page they were already reading — a record page or the campaign's grid.
	//
	// This is a TEASER, not the archive. It shows the newest post cut to a few
	// blocks, the three after it as headlines, and a way through to the blog. The
	// cut is not made here: `truncateMarkdown` runs in the load function and the
	// dropped blocks never leave the server, because a `line-clamp` would leave
	// the whole body in HTML that a CDN then hands to every visitor. `truncated`
	// arriving as a prop is that decision made visible — this component is told
	// there is more, it cannot work it out from what it was given.
	//
	// The bodies arriving here are ALREADY sanitized HTML produced by
	// `renderRichText` in the page's load function — this component never sees
	// markdown and never imports the renderer, which is what keeps the whole
	// markdown pipeline out of a bundle served to strangers.
	// Imported from its own module rather than through the package barrel, and
	// that is load-bearing rather than a style preference. The barrel also
	// re-exports `RichTextEditor`, which pulls in Milkdown and ProseMirror,
	// so importing the renderer through it puts the whole editor in
	// this page's module graph — and this page is the CDN-cached donor page the
	// markdown-over-JSON decision existed to keep empty. The barrel is for the
	// admin side, where the editor is wanted anyway.
	import RichTextBody from '$lib/features/rich-text/RichTextBody.svelte';
	import UpdateDateline from '$lib/features/public-site/UpdateDateline.svelte';
	import UpdateLink from '$lib/features/public-site/UpdateLink.svelte';
	import * as m from '$lib/i18n/messages';

	type Headline = {
		title: string;
		/** Permalink segment, minted when the post was published. */
		slug: string;
		/** Milliseconds, or null when the row was published before this was kept. */
		publishedAt: number | null;
	};

	type Lead = Headline & {
		/** Sanitized HTML of the TRUNCATED markdown. Never the whole body. */
		html: string;
		/** True when the load function dropped blocks, so there is more to read. */
		truncated: boolean;
	};

	type Props = {
		/** The newest post, or null when the parent has published nothing. */
		lead: Lead | null;
		/** The next few, title and date only. */
		headlines: Headline[];
		orgSlug: string;
		campaignSlug: string;
		objectSlug: string;
		/** The record's number on a record page; null on the campaign's grid. */
		number: string | null;
		/** Optional, for layout composition (e.g. `mt-10` under the story). */
		class?: string;
	};

	let {
		lead,
		headlines,
		orgSlug,
		campaignSlug,
		objectSlug,
		number,
		class: className
	}: Props = $props();
</script>

<!-- Nothing at all when there is nothing to say: no heading, no "no updates yet"
     box. A record whose campaign has never posted should read exactly as it did
     before this feature existed, rather than acquiring an empty section that
     tells a donor the org has been silent. The blog index is the one place that
     says so out loud, because arriving there is a deliberate act. -->
{#if lead}
	<section class={className}>
		<h2 class="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">
			{m.updates_publicHeading()}
		</h2>

		<article class="mt-4">
			<h3 class="ps-serif text-foreground text-2xl leading-snug">
				<UpdateLink
					{orgSlug}
					{campaignSlug}
					{objectSlug}
					{number}
					slug={lead.slug}
					class="hover:text-primary"
				>
					{lead.title}
				</UpdateLink>
			</h3>
			<UpdateDateline publishedAt={lead.publishedAt} class="mt-1" />

			<div class="mt-4">
				<RichTextBody html={lead.html} />
			</div>

			<!-- Only when blocks were actually dropped. Offering "Read more" on a
			     post the reader has just finished sends them to a page identical to
			     the one they are on; the linked title above is the way through for
			     a short post. -->
			{#if lead.truncated}
				<p class="mt-4">
					<UpdateLink
						{orgSlug}
						{campaignSlug}
						{objectSlug}
						{number}
						slug={lead.slug}
						class="text-primary text-sm font-medium hover:underline"
					>
						{m.updates_readMore()} &rarr;
					</UpdateLink>
				</p>
			{/if}
		</article>

		<!-- Headlines, not excerpts. Someone on a record page came for the record;
		     the second-newest post earns a line and a date, and the blog is where
		     it earns paragraphs. -->
		{#if headlines.length > 0}
			<h3 class="text-muted-foreground mt-8 text-[11px] font-semibold tracking-[0.2em] uppercase">
				{m.updates_moreRecent()}
			</h3>
			<ul class="divide-border/60 mt-3 divide-y">
				{#each headlines as headline (headline.slug)}
					<li class="py-3 first:pt-0 last:pb-0">
						<UpdateLink
							{orgSlug}
							{campaignSlug}
							{objectSlug}
							{number}
							slug={headline.slug}
							class="ps-serif text-foreground hover:text-primary text-lg leading-snug"
						>
							{headline.title}
						</UpdateLink>
						<UpdateDateline publishedAt={headline.publishedAt} class="mt-0.5" />
					</li>
				{/each}
			</ul>
		{/if}

		<!-- Shown whenever the feed is, including when the four posts above are
		     the whole archive: the index is not a longer list of the same thing,
		     it is where each post is readable in full at its own URL. -->
		<p class="mt-6">
			<UpdateLink
				{orgSlug}
				{campaignSlug}
				{objectSlug}
				{number}
				slug={null}
				class="text-primary text-sm font-medium hover:underline"
			>
				{m.updates_viewAll()} &rarr;
			</UpdateLink>
		</p>
	</section>
{/if}
