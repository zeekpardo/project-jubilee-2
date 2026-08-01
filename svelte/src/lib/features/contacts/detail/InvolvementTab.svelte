<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { getAccessContext } from '$lib/access';
	import { campaignRoleLabel } from '$lib/features/contacts/campaign-roles';
	import { projectMemberRoleLabel } from '$lib/features/projects/labels';
	import * as m from '$lib/i18n/messages';

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import type { Id } from '$convex/_generated/dataModel';

	let { contactId, campaignId }: { contactId: Id<'contacts'>; campaignId: Id<'campaigns'> } =
		$props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	const canRead = $derived(access.can('contacts:read', campaignId));

	const involvementResponse = useQuery(api.contacts.detail.getCampaignInvolvement, () =>
		auth.isAuthenticated && canRead ? { contactId, campaignId } : 'skip'
	);
	const memberships = $derived(involvementResponse?.data?.memberships ?? []);
	const projects = $derived(involvementResponse?.data?.projects ?? []);
	const loading = $derived(involvementResponse?.isLoading ?? false);
</script>

<div class="flex flex-col gap-4">
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.contactDetail_campaignRole()}</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if loading}
				<Skeleton class="h-6 w-32" />
			{:else if memberships.length > 0}
				<div class="flex flex-wrap gap-2">
					{#each memberships as membership (membership._id)}
						<Badge variant="secondary">{campaignRoleLabel(membership.role)}</Badge>
					{/each}
				</div>
			{:else if projects.length > 0}
				<p class="text-muted-foreground text-sm">{m.campaignContacts_viaOnly()}</p>
			{:else}
				<EmptyState title={m.campaignContacts_noRole()} />
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>{m.contactDetail_campaignRecords()}</Card.Title>
		</Card.Header>
		<Card.Content>
			{#if loading}
				<div class="flex flex-col gap-2">
					<Skeleton class="h-10 w-full" />
					<Skeleton class="h-10 w-full" />
				</div>
			{:else if projects.length === 0}
				<EmptyState title={m.contactDetail_noProjects()} />
			{:else}
				<ul>
					{#each projects as link, index (link.project?._id ?? index)}
						<li class="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
							{#if link.project}
								<a
									class="min-w-0 truncate font-medium hover:underline"
									href={resolve('/app/projects/[number]', { number: link.project.number })}
								>
									{link.project.number}
									{link.project.name}
								</a>
							{:else}
								<span class="font-medium">—</span>
							{/if}
							<Badge variant="secondary">{projectMemberRoleLabel(link.role)}</Badge>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
