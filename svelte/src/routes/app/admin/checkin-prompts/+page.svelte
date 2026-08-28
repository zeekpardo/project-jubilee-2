<script lang="ts">
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import * as m from '$lib/i18n/messages';
	import PromptVersionsPanel from '$lib/features/checkins/PromptVersionsPanel.svelte';
	import CheckinTemplatePanel from '$lib/features/checkins/CheckinTemplatePanel.svelte';
	import UpdateFormatPanel from '$lib/features/checkins/UpdateFormatPanel.svelte';

	const access = getAccessContext();

	// Org-wide, so no campaign id — the words a machine says on the charity's
	// behalf are not a per-campaign decision.
	const allowed = $derived(access.can('settings:manage'));
</script>

<PageContainer
	title={m.checkinPrompts_title()}
	description={m.checkinPrompts_subtitle()}
	access={allowed}
>
	<CheckinTemplatePanel />
	<UpdateFormatPanel />
	<PromptVersionsPanel />
</PageContainer>
