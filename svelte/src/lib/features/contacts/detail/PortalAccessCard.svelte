<script lang="ts">
	// Inviting someone to the portal is TWO writes in one moment, in two
	// systems, and both are needed.
	//
	// Better Auth issues the organization invitation, because a portal member is
	// an org member — without it the person signs in, has no active
	// organization, and every portal query resolves them to nobody. Convex marks
	// the contact, because the invitation lives in the auth tables and the
	// contact is where "have we asked this person yet" has to be readable from.
	//
	// The auth invitation goes first. If the mail send fails the contact is left
	// unmarked, which reads as "not invited" — true, and recoverable by
	// inviting again. The other order would leave a contact badged as invited
	// with no email ever sent, which is the failure nobody notices.
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import ConfirmDialog from '$lib/features/settings/ConfirmDialog.svelte';
	import * as m from '$lib/i18n/messages';

	import type { Id } from '$convex/_generated/dataModel';

	let {
		contactId,
		email,
		authUserId,
		invitedAt,
		portalAccess,
		organizationId,
		canManage
	}: {
		contactId: Id<'contacts'>;
		email: string | undefined;
		authUserId: string | undefined;
		invitedAt: number | undefined;
		portalAccess: 'invited' | 'active' | 'revoked' | undefined;
		organizationId: string | undefined;
		/** `members:manage` — granting a login is member management, not editing. */
		canManage: boolean;
	} = $props();

	const { api, authClient } = getAuthContext();
	const client = useConvexClient();

	let isWorking = $state(false);
	let confirmRevoke = $state(false);

	const hasEmail = $derived((email ?? '').trim() !== '');
	const isActive = $derived(portalAccess === 'active' || authUserId !== undefined);
	const isRevoked = $derived(portalAccess === 'revoked');
	const isInvited = $derived(portalAccess === 'invited' || (invitedAt !== undefined && !isActive));

	async function invite(): Promise<void> {
		if (isWorking || !hasEmail || !organizationId) return;
		isWorking = true;
		try {
			const { error } = await authClient.organization.inviteMember({
				email: email!,
				role: 'portal_member',
				organizationId,
				// The same person may be invited twice — a lost email, a changed
				// address — and a second invite should replace the first rather
				// than collide with it.
				resend: true
			});
			if (error) throw new Error(error.message ?? m.contactDetail_portalInviteFailed());

			await client.mutation(api.portal.mutations.invitePortalAccess, { contactId });
			toast.success(m.contactDetail_portalInviteSent({ email: email! }));
		} catch (error: unknown) {
			toast.error(
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.contactDetail_portalInviteFailed()
			);
		} finally {
			isWorking = false;
		}
	}

	async function revoke(): Promise<void> {
		await client.mutation(api.portal.mutations.revokePortalAccessFor, { contactId });
		toast.success(m.contactDetail_portalRevoked());
	}
</script>

<div class="grid gap-1 sm:grid-cols-3 sm:gap-4">
	<span class="text-muted-foreground text-sm">{m.contactDetail_portalLogin()}</span>
	<div class="flex flex-wrap items-center gap-2 sm:col-span-2">
		{#if isActive}
			<Badge variant="secondary">{m.contactDetail_hasPortalLogin()}</Badge>
		{:else if isRevoked}
			<Badge variant="outline">{m.contactDetail_portalRevokedBadge()}</Badge>
		{:else if isInvited && invitedAt !== undefined}
			<Badge variant="outline">
				{m.contactDetail_invitedOn()}
				{new Date(invitedAt).toLocaleDateString()}
			</Badge>
		{:else}
			<span class="text-muted-foreground text-sm">{m.contactDetail_noPortalLogin()}</span>
		{/if}

		{#if canManage}
			{#if !hasEmail}
				<!-- Said here rather than left to a failed send, which happens
				     somewhere the admin is no longer looking. -->
				<span class="text-muted-foreground text-sm">{m.contactDetail_portalNeedsEmail()}</span>
			{:else}
				<Button variant="outline" size="sm" loading={isWorking} onclick={invite}>
					{isInvited || isActive
						? m.contactDetail_resendPortalInvite()
						: m.contactDetail_invitePortal()}
				</Button>
				{#if isActive || isInvited}
					<Button variant="ghost" size="sm" onclick={() => (confirmRevoke = true)}>
						{m.contactDetail_revokePortal()}
					</Button>
				{/if}
			{/if}
		{/if}
	</div>
</div>

<ConfirmDialog
	bind:open={confirmRevoke}
	title={m.contactDetail_revokePortalTitle()}
	body={m.contactDetail_revokePortalBody()}
	confirmLabel={m.contactDetail_revokePortal()}
	onConfirm={revoke}
/>
