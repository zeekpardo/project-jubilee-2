<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import StageChip from '$lib/features/public-site/StageChip.svelte';
	import FundingProgress from '$lib/features/public-site/FundingProgress.svelte';
	import ArticleBody from '$lib/features/public-site/ArticleBody.svelte';
	import ProjectHeroMedia from '$lib/features/public-site/ProjectHeroMedia.svelte';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';
	import type { PublicAttribute } from '$lib/domain/field-definitions';

	const { api } = getAuthContext();
	const auth = useAuth();

	const recordResponse = useQuery(api.portal.queries.getPortalRecord, () => {
		const number = page.params.number;
		return auth.isAuthenticated && number ? { number } : 'skip';
	});
	const record = $derived(recordResponse.data);

	const objectLower = $derived(record?.campaign.objectLabel.toLowerCase() ?? '');

	// `own` is set only for someone this record SERVES, and it swaps in the real
	// name and the full story in place of the scrubbed public ones — see
	// `toPortalRecord` for why that is the one place the public view is wrong
	// rather than merely partial.
	const displayName = $derived(record ? (record.own?.name ?? record.card.name) : null);
	const displayStory = $derived(record ? (record.own?.story ?? record.card.story) : null);

	const title = $derived(
		displayName
			? m.publicSite_projectTitle({ name: displayName, object: objectLower })
			: m.publicSite_projectTitlePlaceholder({ object: objectLower })
	);

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

	const details = $derived(
		record
			? [
					...record.card.attributes.map((attribute) => ({
						label: attribute.label,
						value: formatAttributeValue(attribute)
					})),
					...(record.card.memberCount > 0
						? [
								{
									label: m.publicSite_objectSize({ object: record.campaign.objectLabel }),
									value: String(record.card.memberCount)
								}
							]
						: []),
					...(record.card.memberFirstNames.length > 0
						? [{ label: m.publicSite_members(), value: record.card.memberFirstNames.join(', ') }]
						: [])
				]
			: []
	);
</script>

<svelte:head>
	<title>{record ? title : m.portal_recordNotFound()}</title>
</svelte:head>

{#if !record}
	<EmptyState title={m.portal_recordNotFound()} />
{:else}
	<article>
		<a
			href={resolve('/(portal)/portal/records')}
			class="text-muted-foreground hover:text-primary text-sm font-medium transition-colors"
		>
			&larr; {m.portal_navRecords()}
		</a>

		<header class="mt-6">
			{#if record.own}
				<p class="text-muted-foreground text-xs">{m.portal_ownRecordNote()}</p>
			{/if}
			<h1 class="ps-serif text-foreground mt-1 text-3xl leading-tight sm:text-4xl">{title}</h1>

			<div class="mt-6">
				<ProjectHeroMedia
					photoUrl={record.card.photoUrl}
					videoUrl={record.card.videoUrl}
					alt={title}
					name={displayName ?? record.campaign.objectLabel}
					objectLabel={record.campaign.objectLabel}
				>
					{#snippet badge()}
						<StageChip
							isGoalMet={record.card.isGoalMet}
							goalLabel={record.card.goalLabel}
							progress={record.card.progress}
						/>
					{/snippet}
				</ProjectHeroMedia>
			</div>
		</header>

		{#if displayStory}
			<section class="mt-10">
				<h2 class="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">
					{m.publicSite_theirStory()}
				</h2>
				<div class="mt-4 max-w-prose">
					<ArticleBody text={displayStory} />
				</div>
			</section>
		{/if}

		<div class="mt-10 grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
			<div class="min-w-0">
				{#if details.length > 0}
					<section aria-label={m.publicSite_projectDetailsLabel()}>
						<h2 class="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">
							{m.publicSite_additionalDetails()}
						</h2>
						<dl class="mt-4 text-sm sm:text-base">
							{#each details as detail (detail.label)}
								<div
									class="border-border/60 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b py-3 last:border-b-0"
								>
									<dt class="text-muted-foreground">{detail.label}</dt>
									<dd class="text-foreground font-medium">{detail.value}</dd>
								</div>
							{/each}
						</dl>
					</section>
				{/if}
			</div>

			<aside
				aria-label={m.publicSite_fundingProgressLabel()}
				class="bg-card ring-border rounded-xl p-5 shadow-xs ring-1 sm:p-6 lg:sticky lg:top-8"
			>
				<h2 class="ps-serif text-foreground text-xl">{m.publicSite_fundingProgressLabel()}</h2>
				<div class="mt-4">
					<FundingProgress
						raisedCents={record.card.raisedCents}
						targetCents={record.card.targetCents}
						progress={record.card.progress}
						isGoalMet={record.card.isGoalMet}
						objectLabel={record.campaign.objectLabel}
						goalLabel={record.card.goalLabel}
					/>
				</div>
			</aside>
		</div>
	</article>
{/if}
