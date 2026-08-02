<script lang="ts">
	import * as m from '$lib/i18n/messages';
	import ProjectPhoto from '$lib/features/public-site/ProjectPhoto.svelte';
	import StageChip from '$lib/features/public-site/StageChip.svelte';
	import FundingProgress from '$lib/features/public-site/FundingProgress.svelte';

	let { data } = $props();
	const campaign = $derived(data.campaign);
	const project = $derived(data.project);

	const objectLower = $derived(campaign.objectLabel.toLowerCase());
	const title = $derived(
		project.name
			? m.publicSite_projectTitle({ name: project.name, object: objectLower })
			: m.publicSite_projectTitlePlaceholder({ object: objectLower })
	);
	const excerpt = $derived(project.story?.trim() || m.publicSite_storyPending());

	// Same same-origin construction as the grid widget: this page IS the
	// record's detail data, so unlike ProjectCard (built for a grid, where the
	// whole card links onward) this card is not itself a link — only the
	// explicit "view full profile" action below opens the real page.
	const fullProfileHref = $derived(
		`/${data.orgProfile.slug}/${campaign.slug}/${campaign.objectSlug}/${project.number}`
	);
</script>

<svelte:head>
	<title>{title} ({project.number}) · {campaign.name}</title>
</svelte:head>

<div class="p-4 sm:p-5">
	<div class="bg-card ring-border overflow-hidden rounded-xl shadow-xs ring-1">
		<div class="relative aspect-[4/3] overflow-hidden">
			<ProjectPhoto
				src={project.photoUrl}
				alt={title}
				name={project.name ?? campaign.objectLabel}
			/>
			<StageChip
				isGoalMet={project.isGoalMet}
				goalLabel={project.goalLabel}
				progress={project.progress}
				class="absolute top-3 left-3 shadow-sm"
			/>
		</div>

		<div class="flex flex-col gap-3 p-4 sm:p-5">
			<div>
				<p class="text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase">
					{project.number}
				</p>
				<h1 class="ps-serif text-card-foreground mt-0.5 text-xl leading-snug">{title}</h1>
			</div>

			<p class="text-muted-foreground line-clamp-3 text-sm leading-relaxed">{excerpt}</p>

			<FundingProgress
				raisedCents={project.raisedCents}
				targetCents={project.targetCents}
				progress={project.progress}
				isGoalMet={project.isGoalMet}
				objectLabel={campaign.objectLabel}
				goalLabel={project.goalLabel}
				compact
			/>

			<a
				href={fullProfileHref}
				target="_blank"
				rel="noopener noreferrer"
				class="text-primary hover:text-primary/80 mt-1 text-sm font-semibold underline-offset-4 hover:underline"
			>
				{m.publicSite_embedViewFullProfile()}
			</a>
		</div>
	</div>
</div>
