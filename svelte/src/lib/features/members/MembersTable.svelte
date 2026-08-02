<script lang="ts">
	// Primitives
	import * as Table from '$lib/primitives/ui/table';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import * as Avatar from '$lib/primitives/ui/avatar';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';

	// Rules
	import { isAssignedRole, isRole, type Role } from '$lib/domain/permissions';
	import { roleBadgeVariant, roleLabel } from './roles';
	import RoleSelect from './RoleSelect.svelte';

	import type { Member } from '$lib/auth/types';
	import * as m from '$lib/i18n/messages';

	let {
		members,
		assignedCounts,
		currentUserId,
		assignable,
		onRoleChange,
		onAssign
	}: {
		members: Member[];
		assignedCounts: Record<string, number>;
		currentUserId: string | null;
		/** assignableRoles(callerRole): what this caller may hand out, and nothing more. */
		assignable: Role[];
		onRoleChange: (member: Member, role: Role) => void;
		onAssign: (member: Member) => void;
	} = $props();

	function domainRole(member: Member): Role | null {
		return isRole(member.role) ? member.role : null;
	}

	/**
	 * A role is editable only when the caller may hand out the role the member
	 * already holds — that is what stops an admin from touching another admin.
	 */
	function canEditRole(member: Member): boolean {
		const role = domainRole(member);
		if (!role) return false;
		if (member.userId === currentUserId) return false;
		return assignable.includes(role);
	}
</script>

<div class="overflow-hidden rounded-lg border">
	<Table.Root>
		<Table.Header class="bg-muted">
			<Table.Row>
				<Table.Head>{m.field_name()}</Table.Head>
				<Table.Head>{m.field_role()}</Table.Head>
				<Table.Head>{m.members_assignedCampaigns()}</Table.Head>
				<Table.Head class="text-right">{m.field_actions()}</Table.Head>
			</Table.Row>
		</Table.Header>
		<Table.Body>
			{#each members as member (member.id)}
				{@const role = domainRole(member)}
				<Table.Row>
					<Table.Cell>
						<div class="flex items-center gap-3">
							<Avatar.Root class="size-8">
								<Avatar.Image src={member.user.image} alt={member.user.name} />
								<Avatar.Fallback>
									<Avatar.Marble name={member.user.name} />
								</Avatar.Fallback>
							</Avatar.Root>
							<div class="flex min-w-0 flex-col">
								<span class="flex items-center gap-2 truncate text-sm font-medium">
									{member.user.name}
									{#if member.userId === currentUserId}
										<Badge variant="outline">{m.members_you()}</Badge>
									{/if}
								</span>
								<span class="text-muted-foreground truncate text-xs">{member.user.email}</span>
							</div>
						</div>
					</Table.Cell>
					<Table.Cell>
						{#if role && canEditRole(member)}
							<RoleSelect
								value={role}
								options={assignable}
								onSelect={(next) => onRoleChange(member, next)}
							/>
						{:else if role}
							<Badge variant={roleBadgeVariant(role)}>{roleLabel(role)}</Badge>
						{:else}
							<Badge variant="outline">{member.role}</Badge>
						{/if}
					</Table.Cell>
					<Table.Cell class="text-muted-foreground">
						{#if isAssignedRole(role)}
							{assignedCounts[member.userId] ?? 0}
						{:else}
							—
						{/if}
					</Table.Cell>
					<Table.Cell>
						<div class="flex justify-end">
							{#if isAssignedRole(role)}
								<Button variant="outline" size="sm" onclick={() => onAssign(member)}>
									<SlidersHorizontalIcon />
									{m.members_assignedCampaigns()}
								</Button>
							{/if}
						</div>
					</Table.Cell>
				</Table.Row>
			{/each}
		</Table.Body>
	</Table.Root>
</div>
