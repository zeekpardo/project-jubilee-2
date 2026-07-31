<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import * as m from '$lib/i18n/messages';
	import { PROJECT_MEMBER_ROLES, projectMemberRoleLabel } from './labels';
	import type { ProjectMemberRole } from './labels';
	import type { ProjectMemberRow } from './types';

	let {
		open = $bindable(false),
		projectId,
		member = null
	}: {
		open?: boolean;
		projectId: Id<'projects'>;
		/** Null adds a new link, a row edits the existing one. */
		member?: ProjectMemberRow | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let search = $state('');
	let contactId = $state('');
	let role = $state<ProjectMemberRole>('member');
	let isSaving = $state(false);

	const isEdit = $derived(member !== null);

	const contactsResponse = useQuery(api.contacts.queries.listContacts, () =>
		open && !isEdit ? { search: search.trim() || undefined, limit: 50 } : 'skip'
	);
	const contacts = $derived(contactsResponse.data ?? []);

	const contactCollection = $derived(
		createListCollection({
			items: contacts.map((contact) => ({
				value: contact._id as string,
				label: contactDisplayName(contact)
			}))
		})
	);

	const roleCollection = createListCollection({
		items: PROJECT_MEMBER_ROLES.map((value) => ({ value, label: projectMemberRoleLabel(value) }))
	});

	$effect(() => {
		if (!open) return;
		const source = member;
		search = '';
		contactId = source?.contactId ?? '';
		role = source?.role ?? 'member';
	});

	const canSubmit = $derived(isEdit || contactId !== '');

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			if (member) {
				await client.mutation(api.projectMembers.mutations.updateProjectMember, {
					projectMemberId: member._id,
					role
				});
			} else {
				await client.mutation(api.projectMembers.mutations.addProjectMember, {
					projectId,
					contactId: contactId as Id<'contacts'>,
					role
				});
			}
			open = false;
		} catch (error: unknown) {
			toast.error(
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_saveFailed()
			);
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-lg">
		<Dialog.Header class="w-full">
			<Dialog.Title>{isEdit ? m.projects_editMember() : m.projects_addMember()}</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			{#if isEdit}
				<div class="flex flex-col gap-1">
					<span class="text-muted-foreground text-xs">{m.field_name()}</span>
					<span class="text-sm font-medium">
						{member?.contact ? contactDisplayName(member.contact) : '—'}
					</span>
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					<Label for="member-search">{m.projects_selectContact()}</Label>
					<Input
						id="member-search"
						type="search"
						bind:value={search}
						placeholder={m.list_search()}
						autocomplete="off"
					/>
					<Select.Root
						collection={contactCollection}
						value={contactId === '' ? [] : [contactId]}
						onValueChange={(details: { value: string[] }): void => {
							contactId = details.value[0] ?? '';
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.projects_selectContact()} />
						<Select.Content>
							{#each contactCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
					{#if !contactsResponse.isLoading && contacts.length === 0}
						<p class="text-muted-foreground text-xs">{m.list_noResults()}</p>
					{/if}
				</div>
			{/if}

			<div class="flex flex-col gap-2">
				<Label>{m.projects_memberRole()}</Label>
				<Select.Root
					collection={roleCollection}
					value={[role]}
					onValueChange={(details: { value: string[] }): void => {
						const next = details.value[0];
						if (next) role = next as ProjectMemberRole;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.projects_memberRole()} />
					<Select.Content>
						{#each roleCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="grid gap-4 sm:grid-cols-2"></div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{isEdit ? m.action_save() : m.action_add()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
