<script lang="ts">
	import * as m from '$lib/i18n/messages';

	// Projects are never publicly identifiable pre-publication, so many
	// profiles intentionally have no photo. The placeholder must read as
	// warm and dignified, never a gray box — see .ps-photo-placeholder.
	let { src, alt, name }: { src: string | null; alt: string; name: string } = $props();

	// Remembers WHICH src failed rather than a bare boolean, so a card that is
	// re-used for a different project clears the failure on its own instead of
	// inheriting it. Photos are signed storage URLs that expire, so a broken
	// one is an expected state, not an edge case.
	let failedSrc = $state<string | null>(null);
	const showImage = $derived(src !== null && failedSrc !== src);
</script>

<!-- The weave sits under the image rather than replacing it, so the space is
     already warm while the photo loads. Swapping between the two left the card
     blank until the image painted, which on a full grid reads as broken. -->
<div class="ps-photo-placeholder relative size-full overflow-hidden">
	{#if !showImage}
		<div aria-hidden="true" class="absolute inset-0 flex items-center justify-center">
			<div class="text-center">
				<span class="ps-serif text-primary/70 block text-5xl italic">{name.charAt(0) || 'J'}</span>
				<span class="text-muted-foreground/80 mt-1 block text-[10px] tracking-[0.2em] uppercase">
					{m.publicSite_photoComingSoon()}
				</span>
			</div>
		</div>
	{/if}

	{#if showImage}
		<img
			{src}
			{alt}
			loading="lazy"
			class="absolute inset-0 size-full object-cover"
			onerror={() => (failedSrc = src)}
		/>
	{/if}
</div>
