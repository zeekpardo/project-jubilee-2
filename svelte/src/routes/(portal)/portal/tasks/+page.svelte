<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { resolve } from '$app/paths';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();

	const tasksResponse = useQuery(api.portal.queries.listPortalTasks, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const tasks = $derived(tasksResponse.data);

	const PRIORITY_LABEL: Record<'low' | 'normal' | 'high' | 'urgent', () => string> = {
		low: m.taskPriority_low,
		normal: m.taskPriority_normal,
		high: m.taskPriority_high,
		urgent: m.taskPriority_urgent
	};

	function formatDue(dueOn: string | null): string {
		return dueOn
			? m.portal_taskDueOn({ date: new Date(dueOn).toLocaleDateString() })
			: m.portal_taskNoDueDate();
	}
</script>

<svelte:head>
	<title>{m.portal_tasksTitle()}</title>
</svelte:head>

<header>
	<h1 class="ps-serif text-foreground text-3xl leading-tight">{m.portal_tasksTitle()}</h1>
	<p class="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
		{m.portal_tasksSubtitle()}
	</p>
</header>

{#if tasks}
	{#if tasks.truncated}
		<p class="text-muted-foreground mt-4 text-xs">{m.portal_tasksTruncated()}</p>
	{/if}

	{#if tasks.tasks.length === 0}
		<div class="mt-8">
			<EmptyState title={m.portal_tasksEmpty()} />
		</div>
	{:else}
		<ul class="mt-6 flex flex-col gap-3">
			{#each tasks.tasks as task (task.id)}
				<li class="bg-card ring-border rounded-xl p-4 shadow-xs ring-1">
					<div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
						<p class="text-foreground font-medium">{task.label}</p>
						<span
							class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] font-medium tracking-wide uppercase"
						>
							{PRIORITY_LABEL[task.priority]()}
						</span>
					</div>

					{#if task.description}
						<p class="text-muted-foreground mt-1 text-sm leading-relaxed">{task.description}</p>
					{/if}

					<div
						class="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
					>
						<span>{formatDue(task.dueOn)}</span>
						{#if task.recordNumber}
							<a
								href={resolve('/(portal)/portal/records/[number]', { number: task.recordNumber })}
								class="text-primary hover:underline"
							>
								{task.recordName ?? task.recordNumber}
							</a>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
{/if}
