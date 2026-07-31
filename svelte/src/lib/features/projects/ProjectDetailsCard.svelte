<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { ConvexError } from 'convex/values';

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { InlineEdit } from '$lib/primitives/ui/inline-edit';

	import { getAccessContext } from '$lib/access';
	import {
		attributeValue,
		coerceFieldValue,
		formatFieldValue
	} from '$lib/domain/field-definitions';
	import { centsToDollarInput } from '$lib/features/settings/amount';
	import type { Doc } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';
	import type { ProjectFieldDefinition } from './types';

	let { project }: { project: Doc<'projects'> } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();
	const access = getAccessContext();

	const canWrite = $derived(access.can('projects:write', project.campaignId));

	const fieldsResponse = useQuery(api.customFields.queries.resolveFields, () => ({
		entity: 'project' as const,
		campaignId: project.campaignId
	}));
	const fields = $derived(fieldsResponse.data ?? []);

	// The edited string has to survive a round trip through coerceFieldValue, so
	// money shows plain dollars rather than the formatted currency string.
	function editableValue(def: ProjectFieldDefinition, value: unknown): string {
		if (def.type === 'money') {
			return typeof value === 'number' ? centsToDollarInput(value) : '';
		}
		return formatFieldValue(def, value);
	}

	async function save(def: ProjectFieldDefinition, next: string): Promise<void> {
		// One field at a time: the bag is rebuilt from the current values of the
		// definitions that still exist, with only this key replaced.
		const attributes: Record<string, string | number | boolean | null> = {};
		for (const other of fields) {
			attributes[other.key] = (
				other.key === def.key
					? coerceFieldValue(def, next)
					: attributeValue(project.attributes, other)
			) as string | number | boolean | null;
		}

		try {
			await client.mutation(api.customFields.mutations.setRecordAttributes, {
				entity: 'project',
				recordId: project._id,
				attributes
			});
		} catch (error: unknown) {
			throw new Error(
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_saveFailed(),
				{ cause: error }
			);
		}
	}
</script>

{#if fieldsResponse.isLoading}
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">{m.projectDetail_details()}</Card.Title>
		</Card.Header>
		<Card.Content class="flex flex-col gap-3">
			<Skeleton class="h-6 w-full" />
			<Skeleton class="h-6 w-full" />
		</Card.Content>
	</Card.Root>
{:else if fields.length > 0}
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">{m.projectDetail_details()}</Card.Title>
		</Card.Header>
		<Card.Content>
			<dl class="flex flex-col gap-4">
				{#each fields as def (def.key)}
					<div class="flex flex-col gap-1">
						<dt class="text-muted-foreground flex items-center gap-2 text-xs">
							{def.label}
							{#if !def.isPublic}
								<Badge variant="outline">{m.projectDetail_internalTitle()}</Badge>
							{/if}
						</dt>
						<dd class="text-sm">
							<InlineEdit
								value={editableValue(def, attributeValue(project.attributes, def))}
								disabled={!canWrite}
								multiline={def.type === 'longtext'}
								ariaLabel={def.label}
								placeholder="—"
								onSave={(next) => save(def, next)}
							/>
						</dd>
					</div>
				{/each}
			</dl>
		</Card.Content>
	</Card.Root>
{/if}
