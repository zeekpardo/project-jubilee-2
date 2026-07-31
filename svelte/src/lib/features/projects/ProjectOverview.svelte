<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import type { Doc } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';
	import ProjectFields from './ProjectFields.svelte';

	let { project }: { project: Doc<'projects'> } = $props();

	const details = $derived(
		[
			{ key: 'publicName', label: m.projects_publicName(), value: project.publicName, href: null },
			{
				key: 'videoUrl',
				label: m.projects_videoUrl(),
				value: project.videoUrl,
				href: project.videoUrl
			}
		].filter((detail) => Boolean(detail.value))
	);
</script>

<!-- The only links here are admin-entered external URLs, not app routes. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<div class="flex flex-col gap-6">
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.projects_story()}</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if project.story}
				<p class="text-sm leading-relaxed whitespace-pre-line">{project.story}</p>
			{:else}
				<p class="text-muted-foreground text-sm">{m.state_empty()}</p>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if details.length > 0}
		<Card.Root>
			<Card.Header>
				<Card.Title>{m.projects_editDetails()}</Card.Title>
			</Card.Header>
			<Card.Content class="flex flex-col gap-4">
				{#if details.length > 0}
					<dl class="grid gap-4 sm:grid-cols-2">
						{#each details as detail (detail.key)}
							<div class="flex flex-col gap-1">
								<dt class="text-muted-foreground text-xs">{detail.label}</dt>
								<dd class="text-sm break-words">
									{#if detail.href}
										<a
											class="text-primary hover:underline"
											href={detail.href}
											target="_blank"
											rel="noopener noreferrer"
										>
											{detail.value}
										</a>
									{:else}
										{detail.value}
									{/if}
								</dd>
							</div>
						{/each}
					</dl>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	<ProjectFields {project} />
</div>
