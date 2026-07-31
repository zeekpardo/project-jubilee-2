<script lang="ts">
	// Svelte
	import { resolve } from '$app/paths';

	// Shell
	import PageContainer from '$lib/shell/PageContainer.svelte';
	// Access
	import { getAccessContext } from '$lib/access';
	// Primitives
	import { Button } from '$lib/primitives/ui/button';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { toast } from 'svelte-sonner';
	import UserPlusIcon from '@lucide/svelte/icons/user-plus';
	import UserCogIcon from '@lucide/svelte/icons/user-cog';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { DIALOG_KEY } from '$lib/organizations/utils/organization.constants';

	// Rules
	import { assignableRoles, type Role } from '$lib/domain/permissions';

	// Feature
	import MembersTable from '$lib/features/members/MembersTable.svelte';
	import AssignCampaignsDialog from '$lib/features/members/AssignCampaignsDialog.svelte';
	import type { Campaign } from '$lib/features/campaigns/types';
	import type { Member, Role as OrgRole } from '$lib/auth/types';
	import * as m from '$lib/i18n/messages';

	const { api, authClient } = getAuthContext();
	const access = getAccessContext();
	const auth = useAuth();
	const client = useConvexClient();

	const allowed = $derived(access.can('members:manage'));
	const enabled = $derived(auth.isAuthenticated && allowed);

	// The roles this caller may hand out. Everything the role select offers comes
	// from here, so an admin is never shown owner or admin.
	const assignable = $derived(assignableRoles(access.role));

	const organizationResponse = useQuery(api.organizations.queries.getActiveOrganization, () =>
		enabled ? {} : 'skip'
	);
	const campaignsResponse = useQuery(api.campaigns.queries.listCampaigns, () =>
		enabled ? {} : 'skip'
	);
	const assignmentsResponse = useQuery(api.access.queries.listMembers, () =>
		enabled ? {} : 'skip'
	);

	const members = $derived((organizationResponse.data?.members ?? []) as Member[]);
	const campaigns = $derived((campaignsResponse.data ?? []) as Campaign[]);

	const assignedByUser = $derived.by(() => {
		const map: Record<string, string[]> = {};
		for (const row of assignmentsResponse.data ?? []) {
			map[row.userId] = row.campaignIds as string[];
		}
		return map;
	});

	const assignedCounts = $derived.by(() => {
		const counts: Record<string, number> = {};
		for (const [userId, campaignIds] of Object.entries(assignedByUser)) {
			counts[userId] = campaignIds.length;
		}
		return counts;
	});

	const isLoading = $derived(
		organizationResponse.isLoading || campaignsResponse.isLoading || assignmentsResponse.isLoading
	);

	const inviteHref = $derived(`${resolve('/app/members')}?dialog=${DIALOG_KEY}&tab=members`);

	let assignOpen = $state(false);
	let assignTarget = $state<Member | null>(null);

	const assignTargetCampaignIds = $derived(
		assignTarget ? (assignedByUser[assignTarget.userId] ?? []) : []
	);

	function openAssign(member: Member): void {
		assignTarget = member;
		assignOpen = true;
	}

	async function handleRoleChange(member: Member, role: Role): Promise<void> {
		try {
			// Convex authorises the change against assignableRoles; Better Auth owns
			// the member record and performs the write.
			await client.mutation(api.access.mutations.setMemberRole, {
				memberId: member.id,
				role
			});
			const { error } = await authClient.organization.updateMemberRole({
				memberId: member.id,
				role: [role as OrgRole]
			});
			if (error) {
				toast.error(error.message ?? m.state_saveFailed());
				return;
			}
			toast.success(m.members_roleUpdated());
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : m.state_saveFailed());
		}
	}
</script>

<PageContainer
	title={m.members_title()}
	description={m.members_subtitle()}
	access={allowed}
	loading={isLoading}
>
	{#snippet action()}
		<Button variant="outline" href={inviteHref}>
			<UserPlusIcon />
			{m.members_invite()}
		</Button>
	{/snippet}

	{#if members.length === 0}
		<EmptyState title={m.members_empty()} description={m.members_inviteHelp()}>
			{#snippet icon()}
				<UserCogIcon />
			{/snippet}
			{#snippet action()}
				<Button href={inviteHref}>
					<UserPlusIcon />
					{m.members_invite()}
				</Button>
			{/snippet}
		</EmptyState>
	{:else}
		<div class="flex flex-col gap-4">
			<MembersTable
				{members}
				{assignedCounts}
				{assignable}
				currentUserId={access.userId}
				onRoleChange={handleRoleChange}
				onAssign={openAssign}
			/>
			<p class="text-muted-foreground text-sm">{m.members_assignHelp()}</p>
		</div>
	{/if}
</PageContainer>

<AssignCampaignsDialog
	bind:open={assignOpen}
	userId={assignTarget?.userId ?? null}
	memberName={assignTarget?.user.name ?? ''}
	{campaigns}
	assignedCampaignIds={assignTargetCampaignIds}
/>
