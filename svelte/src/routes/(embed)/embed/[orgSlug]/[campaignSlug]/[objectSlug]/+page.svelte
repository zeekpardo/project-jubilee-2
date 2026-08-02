<script lang="ts">
	import * as m from '$lib/i18n/messages';
	import ProjectCard from '$lib/features/public-site/ProjectCard.svelte';

	let { data } = $props();
	const campaign = $derived(data.campaign);

	// The widget is served from this app's own origin regardless of the host
	// page it's framed in, so a plain same-origin path to the real public
	// page is correct — same construction as the (site) org index's redirect
	// target, just built as a link instead of a redirect.
	function projectHref(number: string): string {
		return `/${data.orgProfile.slug}/${campaign.slug}/${campaign.objectSlug}/${number}`;
	}
</script>

<svelte:head>
	<title>{campaign.objectLabelPlural} · {campaign.name}</title>
</svelte:head>

<div class="px-4 py-6 sm:px-6 sm:py-8">
	{#if data.projects.length === 0}
		<div class="py-12 text-center">
			<p class="ps-serif text-foreground text-xl">{m.publicSite_gridEmptyTitle()}</p>
			<p class="text-muted-foreground mx-auto mt-2 max-w-md text-sm leading-relaxed">
				{m.publicSite_gridEmptyBody()}
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
			{#each data.projects as project (project.number)}
				<ProjectCard
					{project}
					href={projectHref(project.number)}
					objectLabel={campaign.objectLabel}
					target="_blank"
					rel="noopener noreferrer"
				/>
			{/each}
		</div>
	{/if}
</div>
