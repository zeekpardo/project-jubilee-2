<script lang="ts">
	import StatRow from '$lib/features/public-site/StatRow.svelte';

	let { data } = $props();
	const campaign = $derived(data.campaign);

	// StatRow's local Stat type only knows 'number' | 'money'; the wall's
	// StatFormat adds 'count' for the same "plain toLocaleString" behavior
	// StatRow already gives anything that isn't 'money' — same mapping as the
	// (site) grid page.
	const statRowStats = $derived(
		data.stats.map((stat) => ({
			key: stat.key,
			label: stat.label,
			value: stat.value,
			format: stat.format === 'money' ? ('money' as const) : ('number' as const)
		}))
	);
</script>

<svelte:head>
	<title>{campaign.objectLabelPlural} · {campaign.name}</title>
</svelte:head>

<div class="px-4 py-6 sm:px-6 sm:py-8">
	<StatRow stats={statRowStats} />
</div>
