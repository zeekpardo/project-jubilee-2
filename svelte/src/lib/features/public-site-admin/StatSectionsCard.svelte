<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Select from '$lib/primitives/ui/select';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { createListCollection } from '@ark-ui/svelte/select';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc, Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';

	let { settings, canWrite }: { settings: Doc<'orgSettings'> | null; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const campaignsResponse = useQuery(api.campaigns.queries.listCampaigns, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const campaigns = $derived(campaignsResponse.data ?? []);

	type Section = { campaignId: Id<'campaigns'>; heading: string; order: number };

	let rows = $state<Section[]>([]);
	let isSaving = $state(false);

	// One-time seed, same rule as the other cards on this page.
	let loaded = $state(false);
	$effect(() => {
		if (loaded || settings === null) return;
		rows = [...(settings.publicStatSections ?? [])]
			.sort((a, b) => a.order - b.order)
			.map((section, index) => ({
				campaignId: section.campaignId,
				heading: section.heading ?? '',
				order: index
			}));
		loaded = true;
	});

	const chosen = $derived(new Set(rows.map((row) => row.campaignId as string)));

	// Only published campaigns are offered: an unpublished one renders nothing
	// on the public page, so listing it would promise a section that never
	// appears.
	const available = $derived(
		campaigns.filter((campaign) => campaign.isPublished && !chosen.has(campaign._id))
	);

	const addCollection = $derived(
		createListCollection({
			items: available.map((campaign) => ({ value: campaign._id, label: campaign.name }))
		})
	);

	let addValue = $state('');

	function campaignName(campaignId: string): string {
		return campaigns.find((campaign) => campaign._id === campaignId)?.name ?? campaignId;
	}

	function add(): void {
		if (!addValue) return;
		rows = [...rows, { campaignId: addValue as Id<'campaigns'>, heading: '', order: rows.length }];
		addValue = '';
	}

	function move(index: number, delta: number): void {
		const target = index + delta;
		if (target < 0 || target >= rows.length) return;
		const next = [...rows];
		[next[index], next[target]] = [next[target], next[index]];
		rows = next.map((row, position) => ({ ...row, order: position }));
	}

	function remove(campaignId: string): void {
		rows = rows
			.filter((row) => row.campaignId !== campaignId)
			.map((row, position) => ({ ...row, order: position }));
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canWrite) return;
		isSaving = true;
		try {
			await client.mutation(api.orgSettings.mutations.setPublicStatSections, {
				sections: rows.map((row, index) => ({
					campaignId: row.campaignId,
					heading: row.heading.trim() || undefined,
					order: index
				}))
			});
			toast.success(m.publicSiteSettings_identitySaved());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.orgStats_title()}</Card.Title>
		<Card.Description>{m.orgStats_body()}</Card.Description>
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-6" onsubmit={save}>
			{#if rows.length === 0}
				<EmptyState variant="plain" size="sm" title={m.orgStats_empty()} />
			{:else}
				<ul class="flex flex-col gap-3">
					{#each rows as row, index (row.campaignId)}
						<li class="flex flex-wrap items-end gap-3 rounded-md border p-4">
							<Badge variant="outline">{campaignName(row.campaignId)}</Badge>
							<div class="flex min-w-48 flex-1 flex-col gap-2">
								<Label for={`stat-section-${row.campaignId}`}>{m.orgStats_heading()}</Label>
								<Input
									id={`stat-section-${row.campaignId}`}
									value={row.heading}
									placeholder={campaignName(row.campaignId)}
									disabled={!canWrite}
									oninput={(event: Event & { currentTarget: HTMLInputElement }) => {
										row.heading = event.currentTarget.value;
									}}
								/>
							</div>
							<div class="flex items-center gap-1">
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={m.settings_stageMoveUp()}
									disabled={!canWrite || index === 0}
									onclick={() => move(index, -1)}
								>
									<ChevronUpIcon />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={m.settings_stageMoveDown()}
									disabled={!canWrite || index === rows.length - 1}
									onclick={() => move(index, 1)}
								>
									<ChevronDownIcon />
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={m.action_remove()}
									disabled={!canWrite}
									onclick={() => remove(row.campaignId)}
								>
									<Trash2Icon />
								</Button>
							</div>
						</li>
					{/each}
				</ul>
			{/if}

			{#if canWrite}
				<div class="flex flex-col gap-2">
					<Label for="org-stats-add">{m.orgStats_add()}</Label>
					<div class="flex items-center gap-2">
						<Select.Root
							collection={addCollection}
							ids={{ trigger: 'org-stats-add' }}
							value={addValue ? [addValue] : []}
							disabled={available.length === 0}
							onValueChange={(details: { value: string[] }): void => {
								addValue = details.value[0] ?? '';
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.orgStats_addPlaceholder()} />
							<Select.Content>
								{#each addCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
						<Button type="button" variant="outline" disabled={!addValue} onclick={add}>
							<PlusIcon />
							{m.action_add()}
						</Button>
					</div>
				</div>

				<div>
					<Button type="submit" loading={isSaving} disabled={isSaving}>
						{m.action_saveChanges()}
					</Button>
				</div>
			{/if}
		</form>
	</Card.Content>
</Card.Root>
