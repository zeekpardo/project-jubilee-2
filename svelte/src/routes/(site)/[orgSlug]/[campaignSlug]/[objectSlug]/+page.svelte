<script lang="ts">
	import { resolve } from '$app/paths';
	import { cn } from '$lib/primitives/utils';
	import * as m from '$lib/i18n/messages';
	import StatRow from '$lib/features/public-site/StatRow.svelte';
	import ProjectCard from '$lib/features/public-site/ProjectCard.svelte';
	import ArticleBody from '$lib/features/public-site/ArticleBody.svelte';
	import YourGivingNote from '$lib/features/public-site/YourGivingNote.svelte';
	import UpdatesFeed from '$lib/features/public-site/UpdatesFeed.svelte';

	let { data } = $props();
	const campaign = $derived(data.campaign);

	// Both groups render unconditionally, headed rather than gated behind a
	// filter chip: a donor scanning the page sees every record at once, and
	// a crawler indexing the page sees every record too, instead of only
	// whichever chip happened to be selected when it was crawled.
	const metRecords = $derived(data.projects.filter((project) => project.isGoalMet));
	const restRecords = $derived(data.projects.filter((project) => !project.isGoalMet));

	const orgHref = $derived(resolve('/(site)/[orgSlug]', { orgSlug: data.orgProfile.slug }));
	const objectLower = $derived(campaign.objectLabelPlural.toLowerCase());

	// StatRow's local Stat type only knows 'number' | 'money'; the wall's
	// StatFormat adds 'count' for the same "plain toLocaleString" behavior
	// StatRow already gives anything that isn't 'money'.
	const statRowStats = $derived(
		data.stats.map((stat) => ({
			key: stat.key,
			label: stat.label,
			value: stat.value,
			format: stat.format === 'money' ? ('money' as const) : ('number' as const)
		}))
	);
</script>

<svelte:head>
	<title>{campaign.objectLabelPlural} · {campaign.name}</title>
	{#if campaign.summary}
		<meta name="description" content={campaign.summary} />
		<meta property="og:description" content={campaign.summary} />
	{/if}
	<meta property="og:title" content="{campaign.objectLabelPlural} · {campaign.name}" />
	{#if campaign.coverImageUrl}
		<meta property="og:image" content={campaign.coverImageUrl} />
	{/if}
</svelte:head>

<section class="ps-hero-glow">
	<div class="mx-auto max-w-6xl px-4 pt-14 pb-10 sm:px-6 sm:pt-24 sm:pb-16">
		{#if data.hasOrgIndex}
			<a
				href={orgHref}
				class="text-muted-foreground hover:text-primary text-sm font-medium transition-colors"
			>
				&larr; {data.orgProfile.name}
			</a>
		{/if}

		<!-- This grid is the campaign's only public page, so the campaign's own
		     cover and summary live here — otherwise they are editable in the
		     admin and render nowhere. Decorative: the heading beneath carries
		     the meaning, so the alt text stays empty rather than repeating it. -->
		{#if campaign.coverImageUrl}
			<div
				class="ring-border overflow-hidden rounded-xl shadow-sm ring-1"
				class:mt-6={data.hasOrgIndex}
			>
				<img
					src={campaign.coverImageUrl}
					alt=""
					class="aspect-[16/9] w-full object-cover sm:aspect-[21/9]"
					loading="eager"
				/>
			</div>
		{/if}

		<!-- Without the back link or a cover this is the first thing on the
		     page, so it should not carry a top margin. -->
		<h1
			class="ps-serif text-foreground mt-4 max-w-3xl text-4xl leading-[1.08] sm:text-6xl"
			class:mt-0={!data.hasOrgIndex && !campaign.coverImageUrl}
			class:mt-8={!!campaign.coverImageUrl}
		>
			{campaign.objectLabelPlural}
		</h1>

		{#if campaign.summary}
			<p class="text-muted-foreground mt-5 max-w-2xl text-base leading-relaxed sm:text-lg">
				{campaign.summary}
			</p>
		{/if}

		<!-- Directly under the header, where it reads as the returning supporter's
		     half of the campaign's own summary. No `projectNumber`, so the backend
		     sums this person's giving across the whole campaign; for every other
		     reader it renders nothing and the hero is the one that was cached. -->
		<YourGivingNote class="mt-6" orgSlug={data.orgProfile.slug} campaignSlug={campaign.slug} />

		<div class="mt-10 sm:mt-12">
			<StatRow stats={statRowStats} />
		</div>

		<!-- Long-form copy sits after the stats: the numbers are the reason a
		     donor is here, the story is what they read once persuaded. Narrower
		     than the hero so the line length stays readable. -->
		{#if campaign.story}
			<div class="mt-10 max-w-2xl sm:mt-12">
				<ArticleBody text={campaign.story} />
			</div>
		{/if}

		<!-- And then what has happened since. The story is the case for giving,
		     written once; the updates are the answer to the question a donor asks
		     after they have given, so they continue that column at the same
		     measure rather than opening a new region of the page. Renders nothing
		     at all when the campaign has posted nothing.

		     A teaser, not the archive: the newest post arrives already cut to a few
		     blocks by the load function, the three after it as headlines, and the
		     blog index carries everything else. -->
		<UpdatesFeed
			class="mt-10 max-w-2xl sm:mt-12"
			lead={data.updates.lead}
			headlines={data.updates.headlines}
			orgSlug={data.orgProfile.slug}
			campaignSlug={campaign.slug}
			objectSlug={campaign.objectSlug}
			number={null}
		/>
	</div>
</section>

<section class="mx-auto max-w-6xl px-4 sm:px-6">
	{#if data.projects.length === 0}
		<div class="ps-rule py-20 text-center">
			<p class="ps-serif text-foreground text-2xl">{m.publicSite_gridEmptyTitle()}</p>
			<p class="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-relaxed">
				{m.publicSite_gridEmptyBody()}
			</p>
		</div>
	{:else}
		{#if metRecords.length > 0}
			<div class="ps-rule flex items-baseline justify-between gap-2 pt-6 sm:pt-8">
				<h2 class="ps-serif text-foreground text-2xl">{campaign.goalLabel}</h2>
				<span class="text-muted-foreground text-xs">
					{m.publicSite_projectCount({ count: metRecords.length, object: objectLower })}
				</span>
			</div>
			<div class="grid grid-cols-1 gap-5 pt-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
				{#each metRecords as project (project.number)}
					<ProjectCard
						{project}
						href={resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/[number]', {
							orgSlug: data.orgProfile.slug,
							campaignSlug: campaign.slug,
							objectSlug: campaign.objectSlug,
							number: project.number
						})}
						objectLabel={campaign.objectLabel}
					/>
				{/each}
			</div>
		{/if}

		{#if restRecords.length > 0}
			<div
				class={cn(
					'flex items-baseline justify-between gap-2 pt-6 sm:pt-8',
					metRecords.length > 0 ? 'mt-10 sm:mt-12' : 'ps-rule'
				)}
			>
				<h2 class="ps-serif text-foreground text-2xl">{m.publicSite_awaitingSponsor()}</h2>
				<span class="text-muted-foreground text-xs">
					{m.publicSite_projectCount({ count: restRecords.length, object: objectLower })}
				</span>
			</div>
			<div class="grid grid-cols-1 gap-5 pt-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
				{#each restRecords as project (project.number)}
					<ProjectCard
						{project}
						href={resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/[number]', {
							orgSlug: data.orgProfile.slug,
							campaignSlug: campaign.slug,
							objectSlug: campaign.objectSlug,
							number: project.number
						})}
						objectLabel={campaign.objectLabel}
					/>
				{/each}
			</div>
		{/if}
	{/if}
</section>
