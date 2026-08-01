<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { cn } from '$lib/primitives/utils';
	import * as m from '$lib/i18n/messages';
	import StatRow from '$lib/features/public-site/StatRow.svelte';
	import ProjectCard from '$lib/features/public-site/ProjectCard.svelte';
	import ArticleBody from '$lib/features/public-site/ArticleBody.svelte';

	let { data } = $props();
	const campaign = $derived(data.campaign);

	// The `view` param value is a stable key ('met' / 'awaiting'), never the
	// campaign's own goalLabel text — so a campaign that renames its goal
	// later doesn't invalidate a URL someone already shared.
	type FilterKey = 'all' | 'met' | 'awaiting';
	const filter: FilterKey = $derived(
		page.url.searchParams.get('view') === 'met'
			? 'met'
			: page.url.searchParams.get('view') === 'awaiting'
				? 'awaiting'
				: 'all'
	);

	const filters = $derived([
		{ key: 'all' as const, label: m.publicSite_filterAll() },
		{ key: 'met' as const, label: campaign.goalLabel },
		{ key: 'awaiting' as const, label: m.publicSite_awaitingSponsor() }
	]);

	const visible = $derived(
		data.projects.filter((project) => {
			if (filter === 'met') return project.isGoalMet;
			if (filter === 'awaiting') return !project.isGoalMet;
			return true;
		})
	);

	const gridBaseHref = $derived(
		resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]', {
			orgSlug: data.orgProfile.slug,
			campaignSlug: campaign.slug,
			objectSlug: campaign.objectSlug
		})
	);
	function filterHref(key: FilterKey): string {
		return key === 'all' ? gridBaseHref : `${gridBaseHref}?view=${key}`;
	}

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
	</div>
</section>

<section class="mx-auto max-w-6xl px-4 sm:px-6">
	<div class="ps-rule flex flex-wrap items-center gap-2 pt-6 sm:pt-8">
		{#each filters as f (f.key)}
			<a
				href={filterHref(f.key)}
				aria-current={filter === f.key ? 'page' : undefined}
				class={cn(
					'rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
					filter === f.key
						? 'bg-primary text-primary-foreground shadow-xs'
						: 'text-muted-foreground ring-border hover:text-foreground hover:ring-primary/40 ring-1'
				)}
			>
				{f.label}
			</a>
		{/each}
		<span class="text-muted-foreground ml-auto hidden text-xs sm:block">
			{m.publicSite_projectCount({ count: visible.length, object: objectLower })}
		</span>
	</div>

	{#if visible.length === 0}
		<div class="py-20 text-center">
			<p class="ps-serif text-foreground text-2xl">{m.publicSite_gridEmptyTitle()}</p>
			<p class="text-muted-foreground mx-auto mt-3 max-w-md text-sm leading-relaxed">
				{m.publicSite_gridEmptyBody()}
			</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 gap-5 pt-6 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
			{#each visible as project (project.number)}
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
</section>
