<script lang="ts">
	import * as m from '$lib/i18n/messages';

	let { orgName, tagline }: { orgName: string; tagline: string | null } = $props();

	const year = new Date().getFullYear();
</script>

<footer class="ps-rule mt-16 sm:mt-24">
	<div class="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
		<div class="max-w-md">
			<p class="ps-serif text-foreground text-lg font-semibold">{orgName}</p>
			{#if tagline}
				<p class="text-muted-foreground mt-3 text-sm leading-relaxed">{tagline}</p>
			{/if}
		</div>

		<div class="mt-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<p class="text-muted-foreground/80 text-xs leading-relaxed">
				{m.publicSite_privacyNote()}
			</p>
			<p class="text-muted-foreground/60 text-xs whitespace-nowrap">
				&copy;
				{year}
				{orgName}
			</p>
		</div>
	</div>
</footer>
