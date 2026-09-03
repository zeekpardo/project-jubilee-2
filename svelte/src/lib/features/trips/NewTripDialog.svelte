<script lang="ts">
	// The create dialog, and the only place the §15 name prefill happens.
	//
	// The optional record picker does exactly two things: it seeds the name and
	// it writes the first `tripProjects` row. Choosing none is normal — a trip may
	// exist in August with the family visits decided in October — and every
	// further record is linked on the trip page afterwards, where it deliberately
	// leaves the name alone.

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button, buttonVariants } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { createListCollection } from '@ark-ui/svelte/select';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';
	import { tripNamePrefill } from './format';

	let {
		campaignId,
		campaignName,
		objectLabel
	}: {
		campaignId: Id<'campaigns'>;
		/** The first part of the prefilled name. */
		campaignName: string;
		/** What this campaign calls its records — "Family" at Jubilee. */
		objectLabel: string;
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const NO_PROJECT = '';

	let open = $state(false);
	let name = $state('');
	// The prefill stops the moment the user types. Without this the name would
	// silently rewrite itself under them every time they picked a record or
	// nudged the departure date.
	let nameTouched = $state(false);
	let startOn = $state('');
	let endOn = $state('');
	let destination = $state('');
	let countryCode = $state('');
	let summary = $state('');
	let projectId = $state(NO_PROJECT);
	let isSubmitting = $state(false);

	const projectsResponse = useQuery(api.projects.queries.listProjects, () =>
		auth.isAuthenticated && open ? { campaignId } : 'skip'
	);
	const projects = $derived(projectsResponse.data ?? []);

	const projectCollection = $derived(
		createListCollection({
			items: [
				{ value: NO_PROJECT, label: m.trips_projectNone() },
				...projects.map((project) => ({
					value: project._id as string,
					label: `${project.number} ${project.name}`
				}))
			]
		})
	);

	const selectedProjectName = $derived(
		projects.find((project) => (project._id as string) === projectId)?.name ?? null
	);

	$effect(() => {
		if (nameTouched) return;
		name = tripNamePrefill({ campaignName, projectName: selectedProjectName, startOn });
	});

	function reset(): void {
		name = '';
		nameTouched = false;
		startOn = '';
		endOn = '';
		destination = '';
		countryCode = '';
		summary = '';
		projectId = NO_PROJECT;
	}

	const canSubmit = $derived(
		name.trim() !== '' && startOn !== '' && endOn !== '' && destination.trim() !== ''
	);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSubmitting || !canSubmit) return;

		isSubmitting = true;
		try {
			await client.mutation(api.trips.mutations.createTrip, {
				campaignId,
				name: name.trim(),
				startOn,
				endOn,
				destination: destination.trim(),
				countryCode: countryCode.trim() || undefined,
				summary: summary.trim() || undefined,
				projectId: projectId === NO_PROJECT ? undefined : (projectId as Id<'projects'>)
			});
			toast.success(m.trips_created());
			reset();
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class={buttonVariants({ variant: 'default' })}>
		<PlusIcon class="size-4" aria-hidden="true" />
		{m.trips_new()}
	</Dialog.Trigger>

	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{m.trips_new()}</Dialog.Title>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleSubmit}>
			<div class="flex flex-col gap-2">
				<Label for="new-trip-project">{objectLabel}</Label>
				<Select.Root
					triggerId="new-trip-project"
					collection={projectCollection}
					value={[projectId]}
					onValueChange={(details: { value: string[] }): void => {
						projectId = details.value[0] ?? NO_PROJECT;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.trips_projectNone()} />
					<Select.Content>
						{#each projectCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-muted-foreground text-xs">{m.trips_projectHelp()}</p>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="new-trip-start">{m.trips_startOn()}</Label>
					<Input id="new-trip-start" type="date" bind:value={startOn} required />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="new-trip-end">{m.trips_endOn()}</Label>
					<Input id="new-trip-end" type="date" bind:value={endOn} required />
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="new-trip-name">{m.field_name()}</Label>
				<Input
					id="new-trip-name"
					bind:value={name}
					oninput={() => (nameTouched = true)}
					required
					autocomplete="off"
				/>
				<p class="text-muted-foreground text-xs">{m.trips_nameHelp()}</p>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="new-trip-destination">{m.trips_destination()}</Label>
					<Input id="new-trip-destination" bind:value={destination} required autocomplete="off" />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="new-trip-country">{m.trips_countryCode()}</Label>
					<Input id="new-trip-country" bind:value={countryCode} maxlength={2} autocomplete="off" />
					<p class="text-muted-foreground text-xs">{m.trips_countryCodeHelp()}</p>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="new-trip-summary">{m.trips_summary()}</Label>
				<Textarea id="new-trip-summary" bind:value={summary} rows={3} />
			</div>

			<Dialog.Footer class="w-full">
				<Button
					type="button"
					variant="outline"
					onclick={() => (open = false)}
					disabled={isSubmitting}
				>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSubmitting} disabled={isSubmitting || !canSubmit}>
					{m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
