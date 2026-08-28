<script lang="ts">
	// Opening a conversation with anyone in a campaign.
	//
	// TWO ENTRY POINTS, ONE DIALOG. From the Messages page the other party has to
	// be chosen; from a record's own page it is already known and the picker is
	// not shown. `projectId` being optional is what makes that one component
	// rather than two that drift.
	//
	// THE KIND PICKER NOW DECIDES SOMETHING. A `direct` conversation is people
	// talking: staff write every outbound message, replies are recorded against
	// it, and no model is ever called. A `checkin` is handed to the engine at
	// birth — objectives, a responder, a judge, a turn cap, a draft at the end.
	// They are the same thread type, so a direct conversation can be handed over
	// later from the thread itself; what cannot be undone is starting one already
	// running.
	//
	// WHICH IS WHY THE RECIPIENT RULES DIFFER BY KIND. A message can be addressed
	// to a record or to a person — a sponsor, a trip attendee, a member of staff.
	// A check-in cannot: the engine builds its profile from a record and its
	// objectives are about a household, so `startCheckin` requires one and the
	// picker narrows to records the moment the kind changes. The narrowing is
	// done here rather than left to the mutation's refusal because the choice is
	// visible before the click.
	//
	// The two remaining fields are decisions the conversation cannot take back.
	// The contact is who the messages are addressed to; the locale is the
	// language the responder writes in AND the language the escalation scanner
	// has phrase lists for — which is why the help text says so plainly rather
	// than calling it a preference. The scan runs on every conversation, not just
	// on check-ins, so a `direct` conversation opened in a language the scanner
	// cannot read would run with the safety net switched off too.

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
	import { CHECKIN_KINDS, checkinKindLabel } from './labels';
	import type { CheckinKind } from './types';

	let {
		campaignId,
		projectId,
		label,
		variant = 'default'
	}: {
		/** Sent by `startConversation`, which needs it to scope a conversation that
		 *  names only a person. It is also what the TRIGGER is gated on, so the
		 *  control is hidden from someone the mutation would refuse — the one place
		 *  in this feature where hiding is right: an unopenable dialog teaches
		 *  nothing. */
		campaignId: Id<'campaigns'>;
		/** Absent on the Messages page, where the other party is chosen here. */
		projectId?: Id<'projects'>;
		label?: string;
		variant?: 'default' | 'outline';
	} = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();
	const active = getActiveCampaignContext();

	const NO_CONTACT = '';
	const NO_TARGET = '';

	// One Select holds two different kinds of thing, so the value carries which
	// kind it is. A bare id would be ambiguous the moment a record and a contact
	// were both selectable, and "which table is this id from" is not a question
	// the submit handler should be guessing at.
	const PROJECT_PREFIX = 'project:';
	const CONTACT_PREFIX = 'contact:';

	// The two languages the escalation phrase lists cover. Codes, not prose — the
	// display names come from Intl in the reader's own locale, so this list needs
	// no message key and stays right when the app gains a third UI language.
	const CHECKIN_LOCALES = ['en', 'es'] as const;
	const DEFAULT_CHECKIN_LOCALE = 'en';

	let open = $state(false);
	let kind = $state<CheckinKind>('direct');
	let target = $state(NO_TARGET);
	let contactId = $state(NO_CONTACT);
	let locale = $state<string>(DEFAULT_CHECKIN_LOCALE);
	let isSubmitting = $state(false);

	/** The record this will open against: the prop when given, else the picker.
	 *  Typed explicitly — the picker's value is a bare string off a Select, and
	 *  without the narrowing every consumer downstream widens to `string` and the
	 *  mutation stops type-checking against `Id<'projects'>`. */
	const targetProjectId: Id<'projects'> | null = $derived(
		projectId ??
			(target.startsWith(PROJECT_PREFIX)
				? (target.slice(PROJECT_PREFIX.length) as Id<'projects'>)
				: null)
	);

	/** Set only when a PERSON was picked as the other party, which is a different
	 *  fact from "which member of this family holds the phone" below. */
	const targetContactId: Id<'contacts'> | null = $derived(
		target.startsWith(CONTACT_PREFIX)
			? (target.slice(CONTACT_PREFIX.length) as Id<'contacts'>)
			: null
	);

	/** True when the thing being messaged is a record, so the "who on it" picker
	 *  has something to mean. It is meaningless when the target is a person: they
	 *  are already the person. */
	const targetIsRecord = $derived(targetProjectId !== null);

	const resolvedContactId = $derived(
		targetContactId ??
			(targetIsRecord && contactId !== NO_CONTACT ? (contactId as Id<'contacts'>) : null)
	);

	// Every read is suspended until the dialog opens: none is displayed by the
	// page behind the trigger.
	const projectsResponse = useQuery(api.projects.queries.listProjects, () =>
		auth.isAuthenticated && open && !projectId ? { campaignId } : 'skip'
	);
	const projects = $derived(projectsResponse.data ?? []);

	// Everyone connected to this campaign, from all three directions the query
	// gathers: an explicit membership, a record, or a trip. Gated on
	// `contacts:read` server-side, so a coordinator who may open conversations
	// but not read contacts simply gets no people to choose from rather than an
	// error — the record half of the picker still works.
	const membersResponse = useQuery(api.campaignMembers.queries.listCampaignMembers, () =>
		auth.isAuthenticated && open && !projectId ? { campaignId } : 'skip'
	);
	const campaignMembers = $derived(membersResponse.data ?? []);

	// Depends on the chosen record, so it stays suspended until there is one —
	// and re-subscribes when the choice changes.
	const projectMembersResponse = useQuery(api.projectMembers.queries.listMembersForProject, () =>
		auth.isAuthenticated && open && targetProjectId ? { projectId: targetProjectId } : 'skip'
	);
	const projectMembers = $derived(projectMembersResponse.data ?? []);

	const projectOptions = $derived(
		projects.map((project) => ({
			value: `${PROJECT_PREFIX}${project._id}`,
			label: `${project.number} · ${project.name}`
		}))
	);

	// Empty on a check-in, which is the whole narrowing: a person cannot be the
	// subject of one, so they are not offered as one.
	const personOptions = $derived(
		kind === 'checkin'
			? []
			: // flatMap rather than filter-then-map so the narrowing survives: a
				// member row whose contact was deleted has `contact: null`.
				campaignMembers.flatMap((member) => {
					if (!member.contact) return [];
					// Whatever role this campaign already knows them by — their
					// membership's, else the first record or trip they came in through.
					// Free text from the data, not a UI string.
					const role =
						member.role ?? member.viaProjects[0]?.role ?? member.viaTrips[0]?.role ?? null;
					const name = contactDisplayName(member.contact);
					return [
						{
							value: `${CONTACT_PREFIX}${member.contactId}`,
							label: role ? `${name} · ${role}` : name
						}
					];
				})
	);

	// One collection over both groups: the Select resolves a value through it, so
	// splitting it would leave whichever half was not current unable to render
	// its own selection.
	const targetCollection = $derived(
		createListCollection({ items: [...projectOptions, ...personOptions] })
	);

	const contactCollection = $derived(
		createListCollection({
			items: [
				{ value: NO_CONTACT, label: m.trips_projectNone() },
				...projectMembers.flatMap((member) =>
					member.contact
						? [{ value: member.contactId as string, label: contactDisplayName(member.contact) }]
						: []
				)
			]
		})
	);

	const kindCollection = createListCollection({
		items: CHECKIN_KINDS.map((value) => ({ value, label: checkinKindLabel(value) }))
	});

	const localeCollection = $derived.by(() => {
		const names = new Intl.DisplayNames([getLocale()], { type: 'language' });
		return createListCollection({
			items: CHECKIN_LOCALES.map((value) => ({ value, label: names.of(value) ?? value }))
		});
	});

	$effect(() => {
		if (!open) return;
		kind = 'direct';
		target = NO_TARGET;
		contactId = NO_CONTACT;
		locale = DEFAULT_CHECKIN_LOCALE;
	});

	function changeKind(next: CheckinKind): void {
		kind = next;
		// A person chosen for a message cannot carry over into a check-in: the
		// mutation would refuse, and leaving the name sitting in a picker that no
		// longer offers it is a selection the user cannot see the reason for.
		if (next === 'checkin' && targetContactId) {
			target = NO_TARGET;
			contactId = NO_CONTACT;
		}
	}

	// `startConversation` needs at least one of the two; `startCheckin` needs the
	// record specifically.
	const canSubmit = $derived(
		kind === 'checkin'
			? targetProjectId !== null
			: targetProjectId !== null || resolvedContactId !== null
	);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSubmitting || !canSubmit) return;
		isSubmitting = true;

		try {
			if (kind === 'checkin') {
				// Guarded rather than asserted: `startCheckin` takes a required
				// `projectId`, and `canSubmit` is a different expression from this one.
				if (!targetProjectId) return;
				await client.mutation(api.checkins.mutations.startCheckin, {
					projectId: targetProjectId,
					contactId: resolvedContactId ?? undefined,
					locale,
					now: Date.now()
				});
			} else {
				await client.mutation(api.checkins.mutations.startConversation, {
					campaignId,
					projectId: targetProjectId ?? undefined,
					contactId: resolvedContactId ?? undefined,
					locale,
					now: Date.now()
				});
			}
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
				<Select.Root
					collection={kindCollection}
					value={[kind]}
					onValueChange={(details: { value: string[] }): void => {
						const next = details.value[0];
						if (next) changeKind(next as CheckinKind);
					}}
				>
					<Select.Trigger
						id="new-message-kind"
						class="w-full"
						placeholder={m.messages_kindDirect()}
					/>
					<Select.Content>
						{#each kindCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-muted-foreground text-xs">
					{kind === 'checkin' ? m.messages_kindCheckinHelp() : m.messages_kindDirectHelp()}
				</p>
			</div>

			{#if !projectId}
				<div class="flex flex-col gap-2">
					<Label for="new-message-target">{m.messages_record()}</Label>
					<Select.Root
						collection={targetCollection}
						value={[target]}
						onValueChange={(details: { value: string[] }): void => {
							target = details.value[0] ?? NO_TARGET;
							// The previous contact was a person on a different family's
							// record. Carrying it over would address this conversation to a
							// stranger, so the choice is dropped with the target.
							contactId = NO_CONTACT;
						}}
					>
						<Select.Trigger
							id="new-message-target"
							class="w-full"
							placeholder={kind === 'checkin'
								? m.messages_recordPlaceholder()
								: m.messages_recipientPlaceholder()}
						/>
						<Select.Content>
							{#if projectOptions.length > 0}
								<Select.Group>
									<!-- The campaign's own word for a record — a campaign calling
									     them "Families" says so here too. -->
									<Select.GroupHeading>
										{active.objectLabel || m.messages_groupRecords()}
									</Select.GroupHeading>
									{#each projectOptions as option (option.value)}
										<Select.Item item={option}>
											<Select.ItemText>{option.label}</Select.ItemText>
										</Select.Item>
									{/each}
								</Select.Group>
							{/if}

							{#if personOptions.length > 0}
								<Select.Group>
									<Select.GroupHeading>{m.messages_groupPeople()}</Select.GroupHeading>
									{#each personOptions as option (option.value)}
										<Select.Item item={option}>
											<Select.ItemText>{option.label}</Select.ItemText>
										</Select.Item>
									{/each}
								</Select.Group>
							{/if}
						</Select.Content>
					</Select.Root>
					<p class="text-muted-foreground text-xs">
						{kind === 'checkin' ? m.messages_recipientCheckinHelp() : m.messages_recipientHelp()}
					</p>
				</div>
			{/if}

			<!-- Only when a RECORD is being messaged. Asking which member of a
			     household holds the phone is a real question; asking it about a
			     sponsor who was chosen by name is not. -->
			{#if targetIsRecord}
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
			{/if}

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
