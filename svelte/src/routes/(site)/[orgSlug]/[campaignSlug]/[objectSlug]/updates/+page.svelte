<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/i18n/messages';
	import UpdateList from '$lib/features/public-site/UpdateList.svelte';

	let { data } = $props();
	const campaign = $derived(data.campaign);
</script>

<svelte:head>
	<title>{m.updates_allTitle()} · {campaign.name}</title>
	<meta name="description" content="{m.updates_allTitle()} · {campaign.name}" />
</svelte:head>

<!-- A reading column, not the grid's six. This page is prose end to end, so it
     takes the story's measure rather than the layout the record cards need. -->
<section class="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
	<a
		href={resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]', {
			orgSlug: data.orgProfile.slug,
			campaignSlug: campaign.slug,
			objectSlug: campaign.objectSlug
		})}
		class="text-muted-foreground hover:text-primary text-sm font-medium transition-colors"
	>
		&larr; {m.updates_backToCampaign({ name: campaign.name })}
	</a>

	<h1 class="ps-serif text-foreground mt-6 text-4xl leading-tight sm:text-5xl">
		{m.updates_allTitle()}
	</h1>

	<!-- Unlike the teaser on the grid, this page says so when there is nothing.
	     Arriving here is a deliberate act — someone followed "View all updates"
	     or a shared link — and an empty page with no explanation reads as broken
	     rather than as quiet. -->
	{#if data.updates.length === 0}
		<p class="text-muted-foreground mt-8 leading-relaxed">{m.updates_emptyPublic()}</p>
	{:else}
		<UpdateList
			class="mt-10"
			updates={data.updates}
			orgSlug={data.orgProfile.slug}
			campaignSlug={campaign.slug}
			objectSlug={campaign.objectSlug}
			number={null}
		/>
	{/if}
</section>
