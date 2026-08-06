<script lang="ts">
	// Named budget presets a new trip can start from.
	//
	// Unversioned, unlike cost and task templates on the neighbouring tabs.
	// Applying a preset COPIES its lines onto the trip, so no trip references
	// the preset it came from and editing one later cannot reach a trip that
	// already used it — see the note on `tripBudgetTemplates` in schema.ts.
	// That is also why this tab offers a plain delete where the others offer
	// only "new version".

	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import WalletIcon from '@lucide/svelte/icons/wallet';
	import { toast } from 'svelte-sonner';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import TripBudgetTemplateDialog from './TripBudgetTemplateDialog.svelte';
	import ConfirmDialog from './ConfirmDialog.svelte';
	import type { TripBudgetTemplate } from './types';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	let { campaignId }: { campaignId: Id<'campaigns'> } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const response = useQuery(api.tripBudgetTemplates.queries.listTripBudgetTemplates, () =>
		auth.isAuthenticated ? { campaignId } : 'skip'
	);
	const templates = $derived((response.data ?? []) as TripBudgetTemplate[]);
	const isLoading = $derived(response.isLoading);

	let dialogOpen = $state(false);
	let editing = $state<TripBudgetTemplate | null>(null);
	let confirmOpen = $state(false);
	let deleting = $state<TripBudgetTemplate | null>(null);

	function openNew(): void {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(template: TripBudgetTemplate): void {
		editing = template;
		dialogOpen = true;
	}

	function confirmDelete(template: TripBudgetTemplate): void {
		deleting = template;
		confirmOpen = true;
	}

	// ConfirmDialog owns the in-flight state and surfaces the failure itself, so
	// this only has to throw — swallowing the error here would close the dialog
	// on a delete that did not happen.
	async function remove(): Promise<void> {
		const target = deleting;
		if (!target) return;
		await client.mutation(api.tripBudgetTemplates.mutations.deleteTripBudgetTemplate, {
			templateId: target._id
		});
		toast.success(m.state_deleted());
		deleting = null;
	}
</script>

<div class="flex flex-col gap-4">
	<p class="text-muted-foreground text-xs">{m.settings_tripBudgetHelp()}</p>

	<div class="flex justify-end">
		<Button onclick={openNew}>
			<PlusIcon />
			{m.settings_tripBudgetNew()}
		</Button>
	</div>

	{#if isLoading}
		<div class="flex flex-col gap-3">
			<Skeleton class="h-32 w-full" />
			<Skeleton class="h-32 w-full" />
		</div>
	{:else if templates.length === 0}
		<EmptyState title={m.settings_tripBudgetEmpty()} description={m.settings_tripBudgetEmptyBody()}>
			{#snippet icon()}
				<WalletIcon />
			{/snippet}
			{#snippet action()}
				<Button onclick={openNew}>
					<PlusIcon />
					{m.settings_tripBudgetNew()}
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="flex flex-col gap-4">
			{#each templates as template (template._id)}
				<Card.Root>
					<Card.Header>
						<Card.Title>{template.name}</Card.Title>
						<Card.Description>
							{m.settings_tripBudgetLineCount({ count: template.lines.length })}
						</Card.Description>
						<Card.Action>
							<div class="flex gap-1">
								<Button
									variant="ghost"
									size="icon"
									aria-label={m.action_edit()}
									title={m.action_edit()}
									onclick={() => openEdit(template)}
								>
									<PencilIcon />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									aria-label={m.action_delete()}
									title={m.action_delete()}
									onclick={() => confirmDelete(template)}
								>
									<Trash2Icon />
								</Button>
							</div>
						</Card.Action>
					</Card.Header>
					<Card.Content>
						<ul class="flex flex-col gap-1 text-sm">
							{#each [...template.lines].sort((a, b) => a.order - b.order) as line (line.order)}
								<li class="flex items-center justify-between gap-2">
									<span class="flex items-center gap-2">
										{line.label}
										{#if line.perAttendee}
											<Badge variant="outline">{m.settings_perAttendee()}</Badge>
										{/if}
									</span>
									<span class="text-muted-foreground tabular-nums">
										{formatCents(line.amountCents)}
									</span>
								</li>
							{/each}
						</ul>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>

<TripBudgetTemplateDialog bind:open={dialogOpen} {campaignId} template={editing} />

<ConfirmDialog
	bind:open={confirmOpen}
	title={m.settings_tripBudgetDelete()}
	body={m.settings_tripBudgetDeleteBody()}
	confirmLabel={m.action_delete()}
	onConfirm={remove}
/>
