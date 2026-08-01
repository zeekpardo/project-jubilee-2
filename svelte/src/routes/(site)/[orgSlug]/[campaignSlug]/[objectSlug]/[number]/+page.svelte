<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/i18n/messages';
	import ProjectPhoto from '$lib/features/public-site/ProjectPhoto.svelte';
	import StageChip from '$lib/features/public-site/StageChip.svelte';
	import FundingProgress from '$lib/features/public-site/FundingProgress.svelte';
	import ArticleBody from '$lib/features/public-site/ArticleBody.svelte';
	import InterestForm from '$lib/features/public-site/InterestForm.svelte';
	import { formatCents } from '$lib/features/money/format';
	import type { PublicAttribute } from '$lib/domain/field-definitions';

	let { data } = $props();
	const campaign = $derived(data.campaign);
	const project = $derived(data.project);

	const objectLower = $derived(campaign.objectLabel.toLowerCase());
	const title = $derived(
		project.name
			? m.publicSite_projectTitle({ name: project.name, object: objectLower })
			: m.publicSite_projectTitlePlaceholder({ object: objectLower })
	);

	const gridHref = $derived(
		resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]', {
			orgSlug: data.orgProfile.slug,
			campaignSlug: campaign.slug,
			objectSlug: campaign.objectSlug
		})
	);

	// Field LABELS never cross the privacy wall (src/convex/model/public.ts
	// exposes `attributes` as a plain key/value bag), so this humanizes the
	// raw field key rather than showing e.g. "years_enslaved" verbatim.
	// Formatted from the definition's own type rather than the runtime type of
	// the value: money is stored as integer cents, so a plain number check
	// would publish 150000 where the admin meant $1,500.00.
	function formatAttributeValue(attribute: PublicAttribute): string {
		switch (attribute.type) {
			case 'boolean':
				return attribute.value ? m.publicSite_attributeYes() : m.publicSite_attributeNo();
			case 'money':
				return typeof attribute.value === 'number'
					? formatCents(attribute.value)
					: String(attribute.value);
			case 'number':
				return typeof attribute.value === 'number'
					? attribute.value.toLocaleString('en-US')
					: String(attribute.value);
			default:
				return String(attribute.value);
		}
	}

	// The wall already drops empty and non-public values, and orders what
	// remains by the campaign's own field order.
	const attributeEntries = $derived(
		project.attributes.map((attribute) => ({
			label: attribute.label,
			value: formatAttributeValue(attribute)
		}))
	);

	const details = $derived([
		...attributeEntries,
		...(project.memberCount > 0
			? [
					{
						label: m.publicSite_objectSize({ object: campaign.objectLabel }),
						value: String(project.memberCount)
					}
				]
			: []),
		...(project.memberFirstNames.length > 0
			? [{ label: m.publicSite_members(), value: project.memberFirstNames.join(', ') }]
			: [])
	]);
</script>

<svelte:head>
	<title>{title} ({project.number}) · {campaign.name}</title>
	{#if project.story}
		<meta name="description" content={project.story.slice(0, 160)} />
	{/if}
</svelte:head>

<article class="mx-auto max-w-4xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
	<a
		href={gridHref}
		class="text-muted-foreground hover:text-primary text-sm font-medium transition-colors"
	>
		&larr; {campaign.objectLabelPlural}
	</a>

	<header class="mt-6 grid gap-6 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-end">
		<div class="ring-border aspect-[4/3] overflow-hidden rounded-xl shadow-sm ring-1">
			<ProjectPhoto
				src={project.photoUrl}
				alt={title}
				name={project.name ?? campaign.objectLabel}
			/>
		</div>
		<div>
			<div class="flex flex-wrap items-center gap-3">
				<StageChip
					isGoalMet={project.isGoalMet}
					goalLabel={project.goalLabel}
					progress={project.progress}
				/>
				<span class="text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase">
					{project.number}
				</span>
			</div>
			<h1 class="ps-serif text-foreground mt-3 text-4xl leading-tight sm:text-5xl">{title}</h1>
			<!-- The wall exposes no published date for a project (see
			     src/convex/model/public.ts) — "Sharing their story since …" is
			     omitted rather than invented. -->
		</div>
	</header>

	{#if details.length > 0}
		<section aria-label={m.publicSite_projectDetailsLabel()} class="mt-8">
			<dl
				class="text-foreground/90 flex flex-wrap gap-x-2 gap-y-1 text-sm leading-relaxed sm:text-base"
			>
				{#each details as detail, index (detail.label)}
					<div class="inline-flex flex-wrap items-baseline gap-x-1.5">
						<dt class="text-muted-foreground">{detail.label}:</dt>
						<dd class="font-medium">{detail.value}</dd>
						{#if index < details.length - 1}
							<span aria-hidden="true" class="text-muted-foreground/50 ml-1">&middot;</span>
						{/if}
					</div>
				{/each}
			</dl>
		</section>
	{/if}

	<section
		aria-label={m.publicSite_fundingProgressLabel()}
		class="bg-card ring-border mt-8 rounded-xl p-5 shadow-xs ring-1 sm:p-6"
	>
		<FundingProgress
			raisedCents={project.raisedCents}
			targetCents={project.targetCents}
			progress={project.progress}
			isGoalMet={project.isGoalMet}
			objectLabel={campaign.objectLabel}
			goalLabel={project.goalLabel}
		/>
	</section>

	{#if project.videoUrl}
		<section aria-label={m.publicSite_videoLabel({ object: campaign.objectLabel })} class="mt-8">
			<a
				href={project.videoUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="ring-border bg-card hover:bg-muted/50 group flex items-center gap-4 rounded-xl p-5 shadow-xs ring-1 transition-colors"
			>
				<span
					class="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-full"
				>
					<svg
						viewBox="0 0 24 24"
						aria-hidden="true"
						class="size-5"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polygon points="5 3 19 12 5 21 5 3" />
					</svg>
				</span>
				<span class="min-w-0 flex-1">
					<span class="text-foreground block text-sm font-medium">
						{m.publicSite_watchVideo()}
					</span>
					<span class="text-muted-foreground block truncate text-xs">
						{m.publicSite_watchVideoHint()}
					</span>
				</span>
			</a>
		</section>
	{/if}

	{#if project.story}
		<section class="mt-10">
			<h2 class="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">
				{m.publicSite_theirStory()}
			</h2>
			<div class="mt-4">
				<ArticleBody text={project.story} />
			</div>
		</section>
	{/if}

	<section class="mt-14 scroll-mt-8">
		<div class="ps-rule pt-8">
			<InterestForm objectLabel={campaign.objectLabel} disabled />
		</div>
	</section>
</article>
