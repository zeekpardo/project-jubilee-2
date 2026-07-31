<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { resolve } from '$app/paths';

	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { DIALOG_KEY } from '$lib/organizations/utils/organization.constants';
	import * as m from '$lib/i18n/messages';

	import OrgSettingsCard from '$lib/features/organization/OrgSettingsCard.svelte';
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Skeleton } from '$lib/primitives/ui/skeleton';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	// org:manage is owner-only by design, so an admin reaching this URL gets the
	// refusal from PageContainer rather than a half-populated form.
	const allowed = $derived(access.can('org:manage'));

	const organizationResponse = useQuery(api.organizations.queries.getActiveOrganization, () =>
		auth.isAuthenticated && allowed ? {} : 'skip'
	);
	const organization = $derived(organizationResponse?.data);
	const loading = $derived(organizationResponse?.isLoading ?? false);

	const settingsResponse = useQuery(api.orgSettings.queries.getOrgSettings, () =>
		auth.isAuthenticated && allowed ? {} : 'skip'
	);
	const settings = $derived(settingsResponse?.data);

	const editHref = $derived(resolve(`/app/organization?dialog=${DIALOG_KEY}`));
</script>

<PageContainer title={m.org_title()} description={m.org_subtitle()} access={allowed}>
	<Card.Root>
		<Card.Header>
			<Card.Title>{m.settings_general()}</Card.Title>
			<Card.Action>
				<Button variant="outline" href={editHref} data-sveltekit-noscroll>{m.action_edit()}</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content>
			{#if loading}
				<div class="flex flex-col gap-2">
					<Skeleton class="h-5 w-48" />
					<Skeleton class="h-5 w-32" />
				</div>
			{:else}
				<dl class="grid gap-4 sm:grid-cols-2">
					<div>
						<dt class="text-muted-foreground text-sm">{m.field_name()}</dt>
						<dd class="font-medium">{organization?.name ?? '—'}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground text-sm">{m.field_slug()}</dt>
						<dd class="font-medium">{organization?.slug ?? '—'}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground text-sm">{m.shell_campaign()}</dt>
						<dd class="font-medium">{settings?.campaignLabel ?? '—'}</dd>
					</div>
					<div>
						<dt class="text-muted-foreground text-sm">{m.theme_label()}</dt>
						<dd class="font-medium">{settings?.theme ?? '—'}</dd>
					</div>
				</dl>
			{/if}
		</Card.Content>
	</Card.Root>

	<OrgSettingsCard canEdit={allowed} />
</PageContainer>
