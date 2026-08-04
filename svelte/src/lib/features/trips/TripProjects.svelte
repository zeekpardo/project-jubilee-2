<script lang="ts">
	// The records this trip visits, each linking through to its own page.
	//
	// Linking a record to a trip changes NOTHING about the record — in particular
	// the trip's attendees do not become members of it. That is the whole
	// served-versus-team distinction of §1, and a screen that quietly added people
	// to a family's roster would undo it.
	//
	// Adding a record here also leaves the trip NAME alone. The create dialog's
	// picker seeds the name once; from then on the name is the user's.

	// Primitives
	import { resolve } from '$app/paths';
	import * as Card from '$lib/primitives/ui/card';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import * as Table from '$lib/primitives/ui/table';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { createListCollection } from '@ark-ui/svelte/select';
	import LinkIcon from '@lucide/svelte/icons/link';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc, Id } from '$convex/_generated/dataModel';

	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import * as m from '$lib/i18n/messages';
	import type { TripProjectRow } from './types';

	let {
		trip,
		canWrite,
		objectLabelPlural
	}: {
		trip: Doc<'trips'>;
		canWrite: boolean;
		/** What this campaign calls its records — "Families" at Jubilee. */
		objectLabelPlural: string;
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const linksResponse = useQuery(api.trips.queries.listProjectsForTrip, () => ({
		tripId: trip._id
	}));
	const links = $derived(linksResponse.data ?? []);
	const linkedIds = $derived(links.map((link) => link.projectId as string));

	let linkOpen = $state(false);
	let projectId = $state('');
	let note = $state('');
	let isSaving = $state(false);

	let unlinkOpen = $state(false);
	let unlinking = $state<TripProjectRow | null>(null);

	const projectsResponse = useQuery(api.projects.queries.listProjects, () =>
		auth.isAuthenticated && linkOpen ? { campaignId: trip.campaignId } : 'skip'
	);
	// A record already on the itinerary is not offered again — unique(tripId,
	// projectId) is enforced server-side and a duplicate would render twice.
	const available = $derived(
		(projectsResponse.data ?? []).filter((project) => !linkedIds.includes(project._id as string))
	);

	const projectCollection = $derived(
		createListCollection({
			items: available.map((project) => ({
				value: project._id as string,
				label: `${project.number} ${project.name}`
			}))
		})
	);

	$effect(() => {
		if (!linkOpen) return;
		projectId = '';
		note = '';
	});

	async function linkProject(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || projectId === '') return;
		isSaving = true;
		try {
			await client.mutation(api.trips.mutations.linkTripProject, {
				tripId: trip._id,
				projectId: projectId as Id<'projects'>,
				note: note.trim() || undefined
			});
			linkOpen = false;
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}

	function openUnlink(link: TripProjectRow): void {
		unlinking = link;
		unlinkOpen = true;
	}

	async function unlinkProject(): Promise<void> {
		const target = unlinking;
		if (!target) return;
		await client.mutation(api.trips.mutations.unlinkTripProject, { tripProjectId: target._id });
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{objectLabelPlural}</Card.Title>
		<Card.Description>{m.tripDetail_projectsBody()}</Card.Description>
		{#if canWrite}
			<Card.Action>
				<Button variant="outline" size="sm" onclick={() => (linkOpen = true)}>
					<PlusIcon class="size-4" aria-hidden="true" />
					{m.tripDetail_linkProject()}
				</Button>
			</Card.Action>
		{/if}
	</Card.Header>
	<Card.Content>
		{#if linksResponse.isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-8 w-full" />
				<Skeleton class="h-8 w-full" />
			</div>
		{:else if links.length === 0}
			<EmptyState
				size="sm"
				variant="plain"
				title={m.tripDetail_noProjects()}
				description={m.tripDetail_noProjectsBody()}
			>
				{#snippet icon()}
					<LinkIcon />
				{/snippet}
			</EmptyState>
		{:else}
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.projects_number()}</Table.Head>
						<Table.Head>{m.field_name()}</Table.Head>
						<Table.Head>{m.field_notes()}</Table.Head>
						<Table.Head class="w-20 text-right">{m.field_actions()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each links as link (link._id)}
						<Table.Row>
							<Table.Cell class="font-mono text-xs whitespace-nowrap">
								{link.project?.number ?? '—'}
							</Table.Cell>
							<Table.Cell class="font-medium">
								{#if link.project}
									<a
										class="hover:underline"
										href={resolve('/app/projects/[number]', { number: link.project.number })}
									>
										{link.project.name}
									</a>
								{:else}
									—
								{/if}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground text-sm">{link.note ?? ''}</Table.Cell>
							<Table.Cell class="text-right">
								{#if canWrite}
									<Button
										variant="ghost"
										size="icon"
										aria-label={m.tripDetail_unlinkProject()}
										title={m.tripDetail_unlinkProject()}
										onclick={() => openUnlink(link)}
									>
										<Trash2Icon class="size-4" aria-hidden="true" />
									</Button>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Content>
</Card.Root>

<Dialog.Root bind:open={linkOpen}>
	<Dialog.Content class="md:max-w-md">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.tripDetail_linkProject()}</Dialog.Title>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={linkProject}>
			<div class="flex flex-col gap-2">
				<Label>{objectLabelPlural}</Label>
				<Select.Root
					collection={projectCollection}
					value={projectId === '' ? [] : [projectId]}
					onValueChange={(details: { value: string[] }): void => {
						projectId = details.value[0] ?? '';
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.tripDetail_selectProject()} />
					<Select.Content>
						{#each projectCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if !projectsResponse.isLoading && available.length === 0}
					<p class="text-muted-foreground text-xs">{m.list_noResults()}</p>
				{/if}
			</div>

			<div class="flex flex-col gap-2">
				<Label for="trip-project-note">{m.field_notes()}</Label>
				<Input
					id="trip-project-note"
					bind:value={note}
					placeholder={m.tripDetail_projectNotePlaceholder()}
					autocomplete="off"
				/>
			</div>

			<Dialog.Footer class="w-full">
				<Button
					type="button"
					variant="outline"
					onclick={() => (linkOpen = false)}
					disabled={isSaving}
				>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || projectId === ''}>
					{m.action_add()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>

<ConfirmDialog
	bind:open={unlinkOpen}
	title={m.tripDetail_unlinkProject()}
	body={m.tripDetail_unlinkProjectBody()}
	confirmLabel={m.action_remove()}
	onConfirm={unlinkProject}
/>
