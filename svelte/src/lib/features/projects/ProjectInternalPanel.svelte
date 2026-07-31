<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { ConvexError } from 'convex/values';

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { InlineEdit } from '$lib/primitives/ui/inline-edit';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import * as m from '$lib/i18n/messages';

	import type { Id } from '$convex/_generated/dataModel';

	let {
		projectId,
		siteRef,
		whatsappPhone,
		managedMissionsLink,
		note,
		canWrite = false
	}: {
		projectId: Id<'projects'>;
		siteRef?: string;
		whatsappPhone?: string;
		managedMissionsLink?: string;
		note?: string;
		canWrite?: boolean;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	// A blank field means unset, so it is sent as undefined rather than ''.
	async function save(field: string, next: string) {
		try {
			await client.mutation(api.projects.mutations.updateProject, {
				projectId,
				[field]: next
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
		<Card.Description>{m.projectDetail_internalHelp()}</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		<div class="flex flex-col gap-1">
			<span class="text-muted-foreground text-xs font-medium uppercase">
				{m.projectDetail_siteRef()}
			</span>
			<InlineEdit
				value={siteRef}
				disabled={!canWrite}
				ariaLabel={m.projectDetail_siteRef()}
				placeholder="—"
				onSave={(next) => save('siteRef', next)}
			/>
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-muted-foreground text-xs font-medium uppercase">
				{m.projectDetail_whatsapp()}
			</span>
			<InlineEdit
				value={whatsappPhone}
				disabled={!canWrite}
				type="tel"
				ariaLabel={m.projectDetail_whatsapp()}
				placeholder="—"
				inputClass="font-mono tabular-nums"
				onSave={(next) => save('whatsappPhone', next)}
			/>
		</div>

		<div class="flex flex-col gap-1">
			<span class="text-muted-foreground text-xs font-medium uppercase">
				{m.projectDetail_managedMissions()}
			</span>
			<InlineEdit
				value={managedMissionsLink}
				disabled={!canWrite}
				type="url"
				ariaLabel={m.projectDetail_managedMissions()}
				placeholder="—"
				inputClass="font-mono"
				onSave={(next) => save('managedMissionsLink', next)}
			/>
			{#if managedMissionsLink}
				<!-- eslint-disable svelte/no-navigation-without-resolve -- operator-entered
				     external system; there is no internal route to resolve -->
				<a
					class="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-xs"
					href={managedMissionsLink}
					target="_blank"
					rel="noopener noreferrer"
				>
					{m.projectDetail_openLink()}
					<ExternalLinkIcon class="size-3" />
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			{/if}
		</div>

		<div class="border-warning-500/40 flex flex-col gap-1 border-t pt-4">
			<span class="text-muted-foreground text-xs font-medium uppercase">
				{m.projectDetail_note()}
			</span>
			<InlineEdit
				value={note}
				disabled={!canWrite}
				multiline
				ariaLabel={m.projectDetail_note()}
				placeholder="—"
				onSave={(next) => save('note', next)}
			/>
		</div>
	</Card.Content>
</Card.Root>
