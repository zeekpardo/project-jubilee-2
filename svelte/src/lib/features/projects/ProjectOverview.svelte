<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { attributeValue, formatFieldValue } from '$lib/domain/field-definitions';
	import type { Doc, Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';
	import { formatCents } from './format';

	let { project, campaignId }: { project: Doc<'projects'>; campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();

	const fieldsResponse = useQuery(api.customFields.queries.resolveFields, () => ({
		entity: 'project' as const,
		campaignId
	}));

	const fields = $derived(fieldsResponse.data ?? []);

	const values = $derived(
		fields.map((def) => {
			const raw = attributeValue(project.attributes, def);
			return {
				key: def.key,
				label: def.label,
				type: def.type,
				display: def.type === 'money' && typeof raw === 'number' ? formatCents(raw) : null,
				fallback: formatFieldValue(def, raw)
			};
		})
	);
</script>

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

	<Card.Root>
		<Card.Header>
			<Card.Title>{m.nav_customFields()}</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if fieldsResponse.isLoading}
				<div class="flex flex-col gap-3">
					<Skeleton class="h-6 w-full" />
					<Skeleton class="h-6 w-full" />
				</div>
			{:else if values.length === 0}
				<EmptyState variant="plain" size="sm" title={m.state_empty()} />
			{:else}
				<dl class="grid gap-4 sm:grid-cols-2">
					{#each values as field (field.key)}
						<div class="flex flex-col gap-1">
							<dt class="text-muted-foreground flex items-center gap-2 text-xs">
								{field.label}
								<Badge variant="outline" class="font-mono">{field.type}</Badge>
							</dt>
							<dd class="text-sm">
								{#if field.display}
									<span class="tabular-nums">{field.display}</span>
								{:else if field.fallback}
									{field.fallback}
								{:else}
									<span class="text-muted-foreground" aria-hidden="true">—</span>
								{/if}
							</dd>
						</div>
					{/each}
				</dl>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
