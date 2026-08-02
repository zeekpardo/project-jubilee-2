<script lang="ts">
	import * as m from '$lib/i18n/messages';
	import { toVideoEmbed } from '$lib/domain/video-embed';
	import ProjectPhoto from './ProjectPhoto.svelte';

	import type { Snippet } from 'svelte';

	let {
		photoUrl,
		videoUrl,
		alt,
		name,
		objectLabel,
		badge
	}: {
		photoUrl: string | null;
		videoUrl: string | null;
		alt: string;
		name: string;
		objectLabel: string;
		/** Overlaid on the photo, and withdrawn once the player takes over. */
		badge?: Snippet;
	} = $props();

	// Also the validation gate: an unparseable URL, or one whose scheme is not
	// http(s), resolves to null and no play affordance appears at all, rather
	// than putting an admin's typo behind a button.
	const embed = $derived(toVideoEmbed(videoUrl));
	const label = $derived(m.publicSite_videoLabel({ object: objectLabel }));

	// The photo stands in for the player until someone asks for it. That keeps
	// YouTube's iframe — and its cookies and scripts — off a page served to
	// people whose safety depends on this site being quiet, unless a visitor
	// deliberately opts in.
	let playing = $state(false);

	const playerSrc = $derived.by(() => {
		if (!embed || embed.kind !== 'iframe') return null;
		const url = new URL(embed.src);
		// Only reached by an explicit click, so starting playback is what was
		// asked for rather than something forced on arrival.
		url.searchParams.set('autoplay', '1');
		return url.toString();
	});
</script>

<div class="ring-border relative overflow-hidden rounded-2xl shadow-sm ring-1">
	{#if playing && playerSrc}
		<div class="aspect-[4/3] sm:aspect-[16/9]">
			<!--
				allow-scripts with allow-same-origin is required for a first-party
				YouTube/Vimeo player to run at all; the pair cannot be tightened
				without breaking playback. Only those two hosts reach this branch.
			-->
			<iframe
				src={playerSrc}
				title={label}
				allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
				allowfullscreen
				sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
				class="size-full"
			></iframe>
		</div>
	{:else}
		<div class="aspect-[4/3] sm:aspect-[16/9]">
			<ProjectPhoto src={photoUrl} {alt} {name} />
		</div>

		{#if badge}
			<div class="pointer-events-none absolute top-4 left-4">{@render badge()}</div>
		{/if}

		{#if embed}
			{#snippet playIcon()}
				<span
					class="bg-card/90 text-primary flex size-16 items-center justify-center rounded-full shadow-lg backdrop-blur-sm transition group-hover:scale-105 sm:size-20"
				>
					<svg
						viewBox="0 0 24 24"
						aria-hidden="true"
						class="ml-1 size-7 sm:size-8"
						fill="currentColor"
					>
						<polygon points="6 4 20 12 6 20 6 4" />
					</svg>
				</span>
			{/snippet}

			{#if embed.kind === 'iframe'}
				<button
					type="button"
					onclick={() => (playing = true)}
					aria-label={m.publicSite_watchVideo()}
					class="group focus-visible:ring-ring absolute inset-0 flex items-center justify-center focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
				>
					{@render playIcon()}
				</button>
			{:else}
				<!-- Instagram, TikTok and the like are never embedded, so the same
				     affordance opens the post instead of loading their SDK here. -->
				<a
					href={embed.href}
					target="_blank"
					rel="noopener noreferrer"
					aria-label={m.publicSite_watchVideo()}
					class="group focus-visible:ring-ring absolute inset-0 flex items-center justify-center focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset"
				>
					{@render playIcon()}
				</a>
			{/if}
		{/if}
	{/if}
</div>
