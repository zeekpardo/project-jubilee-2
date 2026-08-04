<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import * as m from '$lib/i18n/messages';
	import StageChip from '$lib/features/public-site/StageChip.svelte';
	import FundingProgress from '$lib/features/public-site/FundingProgress.svelte';
	import ArticleBody from '$lib/features/public-site/ArticleBody.svelte';
	import InterestForm from '$lib/features/public-site/InterestForm.svelte';
	import DonationForm from '$lib/features/public-site/DonationForm.svelte';
	import YourGivingNote from '$lib/features/public-site/YourGivingNote.svelte';
	import UpdatesFeed from '$lib/features/public-site/UpdatesFeed.svelte';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import ProjectHeroMedia from '$lib/features/public-site/ProjectHeroMedia.svelte';
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

	let donateOpen = $state(false);
	let pledgeOpen = $state(false);

	// Dialog content portals to <body>, which puts it OUTSIDE the (site)
	// layout's theme wrapper — so without this it inherits whatever the admin
	// app left on <html>, and a visitor in dark mode gets a dark modal over a
	// light page. Re-declaring `data-theme` here (and never `.dark`, which is
	// what the theme files key their dark tokens on) keeps the public site
	// light-only right through the portal.
	const theme = $derived((page.data.theme as string | undefined) ?? 'jubilee');

	// Seeds the donation form's context; null when the campaign sets no target.
	const remainingCents = $derived(
		project.targetCents === null ? null : Math.max(0, project.targetCents - project.raisedCents)
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

<!-- Wider than a pure reading column so the hero has presence and the details
     can sit beside the funding aside; the story keeps its own measure below. -->
<article class="mx-auto max-w-5xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
	<a
		href={gridHref}
		class="text-muted-foreground hover:text-primary text-sm font-medium transition-colors"
	>
		&larr; {campaign.objectLabelPlural}
	</a>

	<header class="mt-6">
		<h1 class="ps-serif text-foreground text-4xl leading-tight sm:text-5xl">{title}</h1>
		<!-- The wall exposes no published date for a project (see
		     src/convex/model/public.ts) — "Sharing their story since …" is
		     omitted rather than invented. -->

		<!-- Photo and video share one frame: the photo is the poster, and the
		     player only replaces it once someone presses play. Only the stage
		     rides on top — the name above already says whose it is. -->
		<div class="mt-6">
			<ProjectHeroMedia
				photoUrl={project.photoUrl}
				videoUrl={project.videoUrl}
				alt={title}
				name={project.name ?? campaign.objectLabel}
				objectLabel={campaign.objectLabel}
			>
				{#snippet badge()}
					<StageChip
						isGoalMet={project.isGoalMet}
						goalLabel={project.goalLabel}
						progress={project.progress}
					/>
				{/snippet}
			</ProjectHeroMedia>
		</div>
	</header>

	{#if project.story}
		<section class="mt-10">
			<h2 class="text-muted-foreground text-[11px] font-semibold tracking-[0.2em] uppercase">
				{m.publicSite_theirStory()}
			</h2>
			<!-- Full width, but the prose keeps a reading measure: a line running
			     the whole container is markedly harder to read back to. -->
			<div class="mt-4 max-w-prose">
				<ArticleBody text={project.story} />
			</div>
		</section>
	{/if}

	<!-- Directly after their story, because that is what an update is: the next
	     chapter of it. Above the details and the ask, since a supporter deciding
	     whether to give again reads what has happened before they read the
	     attributes. Same reading measure as the story, and nothing at all —
	     not even a heading — for a record nobody has posted about.

	     A teaser rather than the whole feed: the newest post arrives already cut
	     to a few blocks by the load function, the three after it as headlines,
	     and this record's blog index carries everything else. -->
	<UpdatesFeed
		class="mt-10 max-w-prose"
		lead={data.updates.lead}
		headlines={data.updates.headlines}
		orgSlug={data.orgProfile.slug}
		campaignSlug={campaign.slug}
		objectSlug={campaign.objectSlug}
		number={project.number}
	/>

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

		<!-- Sticky on desktop so the ask stays in reach through a long story;
		     static on narrow screens, where it would otherwise eat the viewport. -->
		<aside
			aria-label={m.publicSite_fundingProgressLabel()}
			class="bg-card ring-border rounded-xl p-5 shadow-xs ring-1 sm:p-6 lg:sticky lg:top-8"
		>
			<h2 class="ps-serif text-foreground text-xl">
				{m.publicSite_helpThis({ object: campaign.objectLabel.toLowerCase() })}
			</h2>

			<div class="mt-4">
				<FundingProgress
					raisedCents={project.raisedCents}
					targetCents={project.targetCents}
					progress={project.progress}
					isGoalMet={project.isGoalMet}
					objectLabel={campaign.objectLabel}
					goalLabel={project.goalLabel}
				/>
			</div>

			<!-- Under the record's own numbers and above the ask, because that is
			     where someone deciding whether to give again is already looking.
			     Renders nothing at all unless the visitor is signed in and has
			     given to this record, so for every other reader the aside is
			     byte-for-byte the one that was cached. -->
			<YourGivingNote
				class="mt-4"
				orgSlug={data.orgProfile.slug}
				campaignSlug={campaign.slug}
				projectNumber={project.number}
				objectLabel={campaign.objectLabel}
			/>

			<!-- Two genuinely different asks: giving goes to Stripe, a pledge is an
			     enquiry our team follows up by hand. -->
			<div class="mt-6 flex flex-col gap-2">
				<button
					type="button"
					onclick={() => (donateOpen = true)}
					class="bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:ring-ring inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					{m.publicSite_giveNow()}
				</button>
				<button
					type="button"
					onclick={() => (pledgeOpen = true)}
					class="ring-border text-foreground hover:bg-muted/60 focus-visible:ring-ring inline-flex items-center justify-center rounded-full px-6 py-2.5 text-sm font-semibold ring-1 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					{m.publicSite_makePledge()}
				</button>
			</div>
		</aside>
	</div>
</article>

<Dialog.Root bind:open={donateOpen}>
	<Dialog.Content data-theme={theme} class="bg-background text-foreground md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.publicSite_giveNow()}</Dialog.Title>
		</Dialog.Header>
		<div class="w-full">
			<DonationForm disabled {remainingCents} />
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={pledgeOpen}>
	<Dialog.Content data-theme={theme} class="bg-background text-foreground md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.publicSite_makePledge()}</Dialog.Title>
		</Dialog.Header>
		<div class="w-full">
			<InterestForm objectLabel={campaign.objectLabel} disabled />
		</div>
	</Dialog.Content>
</Dialog.Root>
