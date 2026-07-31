<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { ConvexError } from 'convex/values';

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { InlineEdit } from '$lib/primitives/ui/inline-edit';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import * as m from '$lib/i18n/messages';

	import { coerceFieldValue, formatFieldValue } from '$lib/domain/field-definitions';
	import type { Doc } from '$convex/_generated/dataModel';

	let {
		project,
		canWrite = false
	}: {
		project: Doc<'projects'>;
		canWrite?: boolean;
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const fieldsResponse = useQuery(api.customFields.queries.resolveFields, () =>
		auth.isAuthenticated ? { entity: 'project' as const, campaignId: project.campaignId } : 'skip'
	);
	const loading = $derived(fieldsResponse?.isLoading ?? false);

	// Internal is simply "not public". One flag decides both what shows here and
	// what the privacy wall withholds, so the two can never disagree.
	const fields = $derived((fieldsResponse?.data ?? []).filter((def) => !def.isPublic));

	async function save(key: string, next: string) {
		const def = fields.find((field) => field.key === key);
		if (!def) return;

		let coerced: unknown;
		try {
			coerced = coerceFieldValue(def, next);
		} catch (error) {
			throw new Error(error instanceof Error ? error.message : m.state_saveFailed(), {
				cause: error
			});
		}

		// The bag is rewritten whole, so it is rebuilt from the live definitions
		// with only this key changed; a value whose definition was deleted drops.
		const attributes: Record<string, string | number | boolean | null> = {};
		for (const field of fieldsResponse?.data ?? []) {
			const value = field.key === key ? coerced : project.attributes[field.key];
			if (value !== undefined && value !== null && value !== '') {
				attributes[field.key] = value as string | number | boolean;
			}
		}

		try {
			await client.mutation(api.customFields.mutations.setRecordAttributes, {
				entity: 'project',
				recordId: project._id,
				attributes
			});
		} catch (error) {
			throw new Error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed(), {
				cause: error
			});
		}
	}
</script>

<Card.Root class="border-warning-500/60 bg-warning-500/5 dark:bg-warning-500/10 border-dashed">
	<Card.Header>
		<Card.Title class="flex items-center gap-2 text-base">
			<EyeOffIcon class="size-4" />
			{m.projectDetail_internalTitle()}
			<Badge variant="warning">{m.projectDetail_neverPublic()}</Badge>
		</Card.Title>
		<Card.Description>{m.projectDetail_internalFieldsHelp()}</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		{#if loading}
			<Skeleton class="h-9 w-full" />
			<Skeleton class="h-9 w-full" />
		{:else if fields.length === 0}
			<EmptyState
				variant="plain"
				size="sm"
				title={m.projectDetail_noInternalFields()}
				description={m.projectDetail_noInternalFieldsBody()}
			/>
		{:else}
			{#each fields as def (def.key)}
				<div class="flex flex-col gap-1">
					<span class="text-muted-foreground text-xs font-medium uppercase">{def.label}</span>
					<InlineEdit
						value={formatFieldValue(def, project.attributes[def.key] ?? null)}
						disabled={!canWrite}
						multiline={def.type === 'longtext'}
						ariaLabel={def.label}
						placeholder="—"
						onSave={(next) => save(def.key, next)}
					/>
				</div>
			{/each}
		{/if}
	</Card.Content>
</Card.Root>
