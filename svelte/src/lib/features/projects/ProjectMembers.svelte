<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import { Can } from '$lib/access';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import * as m from '$lib/i18n/messages';
	import { projectMemberRoleLabel } from './labels';
	import ProjectMemberDialog from './ProjectMemberDialog.svelte';
	import type { ProjectMemberRow } from './types';

	let { project }: { project: Doc<'projects'> } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const membersResponse = useQuery(api.projectMembers.queries.listMembersForProject, () => ({
		projectId: project._id
	}));
	const members = $derived(membersResponse.data ?? []);

	let dialogOpen = $state(false);
	let editing = $state<ProjectMemberRow | null>(null);
	let removeOpen = $state(false);
	let removing = $state<ProjectMemberRow | null>(null);

	function openAdd(): void {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(member: ProjectMemberRow): void {
		editing = member;
		dialogOpen = true;
	}

	function openRemove(member: ProjectMemberRow): void {
		removing = member;
		removeOpen = true;
	}

	async function removeMember(): Promise<void> {
		const target = removing;
		if (!target) return;
		await client.mutation(api.projectMembers.mutations.removeProjectMember, {
			projectMemberId: target._id
		});
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.projects_members()}</Card.Title>
		<Can do="projects:write" campaignId={project.campaignId}>
			<Card.Action>
				<Button variant="outline" size="sm" onclick={openAdd}>
					<PlusIcon class="size-4" aria-hidden="true" />
					{m.projects_addMember()}
				</Button>
			</Card.Action>
		</Can>
	</Card.Header>
	<Card.Content>
		{#if membersResponse.isLoading}
			<div class="flex flex-col gap-3">
				<Skeleton class="h-8 w-full" />
				<Skeleton class="h-8 w-full" />
				<Skeleton class="h-8 w-full" />
			</div>
		{:else if members.length === 0}
			<EmptyState variant="plain" size="sm" title={m.projects_noMembers()} />
		{:else}
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.field_name()}</Table.Head>
						<Table.Head>{m.projects_memberRole()}</Table.Head>
						<Table.Head class="w-24 text-right">{m.field_actions()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each members as member (member._id)}
						<Table.Row>
							<Table.Cell class="font-medium">
								{member.contact ? contactDisplayName(member.contact) : '—'}
							</Table.Cell>
							<Table.Cell>
								<Badge variant="secondary">{projectMemberRoleLabel(member.role)}</Badge>
							</Table.Cell>
							<Table.Cell class="text-right">
								<Can do="projects:write" campaignId={project.campaignId}>
									<div class="flex justify-end gap-1">
										<Button
											variant="ghost"
											size="icon"
											aria-label={m.projects_editMember()}
											title={m.projects_editMember()}
											onclick={() => openEdit(member)}
										>
											<PencilIcon class="size-4" aria-hidden="true" />
										</Button>
										<Button
											variant="ghost"
											size="icon"
											aria-label={m.projects_removeMember()}
											title={m.projects_removeMember()}
											onclick={() => openRemove(member)}
										>
											<Trash2Icon class="size-4" aria-hidden="true" />
										</Button>
									</div>
								</Can>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Content>
</Card.Root>

<ProjectMemberDialog bind:open={dialogOpen} projectId={project._id} member={editing} />

<ConfirmDialog
	bind:open={removeOpen}
	title={m.projects_removeMember()}
	body={m.projects_removeMemberBody()}
	confirmLabel={m.action_remove()}
	onConfirm={removeMember}
/>
