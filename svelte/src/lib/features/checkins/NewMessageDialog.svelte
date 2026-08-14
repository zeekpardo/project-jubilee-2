<script lang="ts">
	// Opening a conversation with one family.
	//
	// TWO ENTRY POINTS, ONE DIALOG. From the Messages page the record has to be
	// chosen; from a record's own page it is already known and the picker is not
	// shown. `projectId` being optional is what makes that one component rather
	// than two that drift.
	//
	// THE KIND PICKER IS NOT DECORATION. This surface is Messages — conversations
	// with families — and a check-in is one kind of conversation it can open.
	// Today it is the only kind, because a check-in is the only thing the engine
	// knows how to run and there is no transport for anything a person would type
	// themselves. So the select has one option and says so, rather than listing
	// greyed-out futures: a control for something that does not exist is a
	// promise the product has not made.
	//
	// Both remaining fields are decisions the conversation cannot take back. The
	// contact is who the messages are addressed to; the locale is the language the
	// responder writes in AND the language the escalation scanner has phrase lists
	// for — which is why the help text says so plainly rather than calling it a
	// preference. A conversation opened in a language the scanner cannot read
	// would run with the safety net switched off.

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button, buttonVariants } from '$lib/primitives/ui/button';
	import { Label } from '$lib/primitives/ui/label';
	import { createListCollection } from '@ark-ui/svelte/select';
	import MessageSquarePlusIcon from '@lucide/svelte/icons/message-square-plus';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import Can from '$lib/access/Can.svelte';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import { getLocale } from '$lib/i18n';
	import * as m from '$lib/i18n/messages';

	let {
		campaignId,
		projectId,
		label,
		variant = 'default'
	}: {
		/** Never sent — `startCheckin` derives the campaign from the record itself.
		 *  It is here so the TRIGGER can be gated on the same capability the
		 *  mutation checks, which is the one place in this feature where hiding the
		 *  control is right: an unopenable dialog teaches nothing. */
		campaignId: Id<'campaigns'>;
		/** Absent on the Messages page, where the record is chosen in the dialog. */
		projectId?: Id<'projects'>;
		label?: string;
		variant?: 'default' | 'outline';
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();
	const active = getActiveCampaignContext();

	const NO_CONTACT = '';
	const NO_PROJECT = '';

	/** The only kind the engine can run. See the header. */
	const KIND_CHECKIN = 'checkin';

	// The two languages the escalation phrase lists cover. Codes, not prose — the
	// display names come from Intl in the reader's own locale, so this list needs
	// no message key and stays right when the app gains a third UI language.
	const CHECKIN_LOCALES = ['en', 'es'] as const;
	const DEFAULT_CHECKIN_LOCALE = 'en';

	let open = $state(false);
	let selectedProjectId = $state(NO_PROJECT);
	let contactId = $state(NO_CONTACT);
	let locale = $state<string>(DEFAULT_CHECKIN_LOCALE);
	let isSubmitting = $state(false);

	/** The record this will open against: the prop when given, else the picker.
	 *  Typed explicitly — the picker's value is a bare string off a Select, and
	 *  without the narrowing every consumer downstream widens to `string` and the
	 *  mutation stops type-checking against `Id<'projects'>`. */
	const targetProjectId: Id<'projects'> | null = $derived(
		projectId ?? (selectedProjectId ? (selectedProjectId as Id<'projects'>) : null)
	);

	// Both reads are suspended until the dialog opens: neither is displayed by
	// the page behind the trigger.
	const projectsResponse = useQuery(api.projects.queries.listProjects, () =>
		auth.isAuthenticated && open && !projectId ? { campaignId } : 'skip'
	);
	const projects = $derived(projectsResponse.data ?? []);

	// Depends on the chosen record, so it stays suspended until there is one —
	// and re-subscribes when the choice changes.
	const membersResponse = useQuery(api.projectMembers.queries.listMembersForProject, () =>
		auth.isAuthenticated && open && targetProjectId ? { projectId: targetProjectId } : 'skip'
	);
	const members = $derived(membersResponse.data ?? []);

	const projectCollection = $derived(
		createListCollection({
			items: projects.map((project) => ({
				value: project._id as string,
				label: `${project.number} · ${project.name}`
			}))
		})
	);

	const contactCollection = $derived(
		createListCollection({
			items: [
				{ value: NO_CONTACT, label: m.trips_projectNone() },
				// flatMap rather than filter-then-map so the narrowing survives: a
				// member row whose contact was deleted has `contact: null`.
				...members.flatMap((member) =>
					member.contact
						? [{ value: member.contactId as string, label: contactDisplayName(member.contact) }]
						: []
				)
			]
		})
	);

	const kindCollection = createListCollection({
		items: [{ value: KIND_CHECKIN, label: m.messages_kindCheckin() }]
	});

	const localeCollection = $derived.by(() => {
		const names = new Intl.DisplayNames([getLocale()], { type: 'language' });
		return createListCollection({
			items: CHECKIN_LOCALES.map((value) => ({ value, label: names.of(value) ?? value }))
		});
	});

	$effect(() => {
		if (!open) return;
		selectedProjectId = NO_PROJECT;
		contactId = NO_CONTACT;
		locale = DEFAULT_CHECKIN_LOCALE;
	});

	const canSubmit = $derived(targetProjectId !== null);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSubmitting || !targetProjectId) return;
		isSubmitting = true;

		try {
			await client.mutation(api.checkins.mutations.startCheckin, {
				projectId: targetProjectId,
				contactId: contactId === NO_CONTACT ? undefined : (contactId as Id<'contacts'>),
				locale,
				now: Date.now()
			});
			toast.success(m.checkinStart_started());
			open = false;
		} catch (error: unknown) {
			// The common refusal here is "this family already has a check-in in
			// progress", which is a sentence a coordinator needs to read — so the
			// server's own words win over the generic failure copy.
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Can do="projects:write" {campaignId}>
		<Dialog.Trigger class={buttonVariants({ variant, size: 'sm' })}>
			<MessageSquarePlusIcon class="size-4" aria-hidden="true" />
			{label ?? m.messages_new()}
		</Dialog.Trigger>
	</Can>

	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.messages_newTitle()}</Dialog.Title>
			<Dialog.Description>{m.messages_newBody()}</Dialog.Description>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleSubmit}>
			<div class="flex flex-col gap-2">
				<Label for="new-message-kind">{m.messages_kind()}</Label>
				<Select.Root collection={kindCollection} value={[KIND_CHECKIN]}>
					<Select.Trigger
						id="new-message-kind"
						class="w-full"
						placeholder={m.messages_kindCheckin()}
					/>
					<Select.Content>
						{#each kindCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-muted-foreground text-xs">{m.messages_kindCheckinHelp()}</p>
				<p class="text-muted-foreground text-xs">{m.messages_kindOnly()}</p>
			</div>

			{#if !projectId}
				<div class="flex flex-col gap-2">
					<!-- The campaign's own word for a record — a campaign calling them
					     "Families" says so here too. -->
					<Label for="new-message-record">{active.objectLabel || m.messages_record()}</Label>
					<Select.Root
						collection={projectCollection}
						value={[selectedProjectId]}
						onValueChange={(details: { value: string[] }): void => {
							selectedProjectId = details.value[0] ?? NO_PROJECT;
							// The previous contact was a person on a different family's
							// record. Carrying it over would address this check-in to a
							// stranger, so the choice is dropped with the record.
							contactId = NO_CONTACT;
						}}
					>
						<Select.Trigger
							id="new-message-record"
							class="w-full"
							placeholder={m.messages_recordPlaceholder()}
						/>
						<Select.Content>
							{#each projectCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					<p class="text-muted-foreground text-xs">{m.messages_recordHelp()}</p>
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<Label for="new-message-contact">{m.checkinStart_contact()}</Label>
				<Select.Root
					collection={contactCollection}
					value={[contactId]}
					onValueChange={(details: { value: string[] }): void => {
						contactId = details.value[0] ?? NO_CONTACT;
					}}
				>
					<Select.Trigger
						id="new-message-contact"
						class="w-full"
						disabled={!targetProjectId}
						placeholder={m.projects_selectContact()}
					/>
					<Select.Content>
						{#each contactCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-muted-foreground text-xs">{m.checkinStart_contactHelp()}</p>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="new-message-locale">{m.checkinStart_locale()}</Label>
				<Select.Root
					collection={localeCollection}
					value={[locale]}
					onValueChange={(details: { value: string[] }): void => {
						const next = details.value[0];
						if (next) locale = next;
					}}
				>
					<Select.Trigger
						id="new-message-locale"
						class="w-full"
						placeholder={m.checkinStart_locale()}
					/>
					<Select.Content>
						{#each localeCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-muted-foreground text-xs">{m.checkinStart_localeHelp()}</p>
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
					{m.checkinStart_submit()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
