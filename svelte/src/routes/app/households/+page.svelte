<script lang="ts">
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import { getActiveCampaignContext } from '$lib/campaigns/active.svelte';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as m from '$lib/i18n/messages';

	const access = getAccessContext();
	const active = getActiveCampaignContext();
	const allowed = $derived(access.can('contacts:read', active.id));
</script>

<PageContainer title={m.nav_households()} access={allowed}>
	<EmptyState title={m.state_empty()} />
</PageContainer>
