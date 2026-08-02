<script lang="ts">
	import * as m from '$lib/i18n/messages';
	import type { PublicProject } from '$convex/model/public';
	import ProjectPhoto from './ProjectPhoto.svelte';
	import StageChip from './StageChip.svelte';
	import FundingProgress from './FundingProgress.svelte';

	let {
		project,
		href,
		objectLabel,
		target,
		rel
	}: {
		project: PublicProject;
		href: string;
		objectLabel: string;
		/** Set by an (embed) widget: its links must open the real page, not navigate the iframe. */
		target?: '_blank';
		rel?: string;
	} = $props();

	// `name` is null unless an admin explicitly set a public name (see the
	// privacy wall in src/convex/model/public.ts) — never derived from a
	// real name, so an unset name falls back to generic, objectLabel-based
	// copy rather than showing the internal `number`.
	const title = $derived(
		project.name
			? m.publicSite_projectTitle({ name: project.name, object: objectLabel.toLowerCase() })
			: m.publicSite_projectTitlePlaceholder({ object: objectLabel.toLowerCase() })
	);
	const excerpt = $derived(project.story?.trim() || m.publicSite_storyPending());
</script>

<a
	{href}
	{target}
	{rel}
	class="group bg-card ring-border hover:ring-primary/40 focus-visible:ring-ring flex flex-col overflow-hidden rounded-xl shadow-xs ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none"
>
	<div class="relative aspect-[4/3] overflow-hidden">
		<div class="h-full w-full transition-transform duration-300 group-hover:scale-[1.03]">
			<ProjectPhoto src={project.photoUrl} alt={title} name={project.name ?? objectLabel} />
		</div>
		<StageChip
			isGoalMet={project.isGoalMet}
			goalLabel={project.goalLabel}
			progress={project.progress}
			class="absolute top-3 left-3 shadow-sm"
		/>
	</div>

	<div class="flex flex-1 flex-col gap-3 p-4 sm:p-5">
		<div>
			<p class="text-muted-foreground font-mono text-[11px] tracking-[0.15em] uppercase">
				{project.number}
			</p>
			<h3 class="ps-serif text-card-foreground mt-0.5 text-xl leading-snug">{title}</h3>
		</div>

		<p class="text-muted-foreground line-clamp-2 text-sm leading-relaxed">{excerpt}</p>

		<FundingProgress
			raisedCents={project.raisedCents}
			targetCents={project.targetCents}
			progress={project.progress}
			isGoalMet={project.isGoalMet}
			{objectLabel}
			goalLabel={project.goalLabel}
			compact
			class="mt-auto"
		/>
	</div>
</a>
