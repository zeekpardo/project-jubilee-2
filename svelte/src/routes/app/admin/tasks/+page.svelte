<script lang="ts">
	// The org-wide twin of /app/tasks. It differs by exactly two things — the
	// scope it asks for and the Campaign column and filter that scope implies —
	// both of which `TaskListView` handles from `scope="org"`. There is no
	// second list here on purpose.
	import PageContainer from '$lib/shell/PageContainer.svelte';
	import { getAccessContext } from '$lib/access';
	import TaskListView from '$lib/features/tasks/TaskListView.svelte';
	import * as m from '$lib/i18n/messages';

	const access = getAccessContext();

	// Unscoped: a team leader passes this and `listTasks` narrows the read to the
	// campaigns they hold, rather than the page guessing on their behalf.
	const allowed = $derived(access.can('projects:read'));
</script>

<PageContainer title={m.taskList_title()} description={m.taskList_adminSubtitle()} access={allowed}>
	<TaskListView scope="org" />
</PageContainer>
