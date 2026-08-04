<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/i18n/messages';
	import UpdateList from '$lib/features/public-site/UpdateList.svelte';

	let { data } = $props();
	const campaign = $derived(data.campaign);
	const project = $derived(data.project);

	// Built exactly as the record page builds it, so the back link names the
	// record the way its own page does rather than inventing a second wording.
	const objectLower = $derived(campaign.objectLabel.toLowerCase());
	const recordTitle = $derived(
		project.name
			? m.publicSite_projectTitle({ name: project.name, object: objectLower })
			: m.publicSite_projectTitlePlaceholder({ object: objectLower })
	);
</script>

<svelte:head>
	<title>{m.updates_allTitle()} · {recordTitle} · {campaign.name}</title>
	<meta name="description" content="{m.updates_allTitle()} · {recordTitle}" />
</svelte:head>

<section class="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
	<a
		href={resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/[number]', {
			orgSlug: data.orgProfile.slug,
			campaignSlug: campaign.slug,
			objectSlug: campaign.objectSlug,
			number: project.number
		})}
		class="text-muted-foreground hover:text-primary text-sm font-medium transition-colors"
	>
		&larr; {m.updates_backToRecord({ name: recordTitle })}
	</a>

	<h1 class="ps-serif text-foreground mt-6 text-4xl leading-tight sm:text-5xl">
		{m.updates_allTitle()}
	</h1>
	<p class="text-muted-foreground mt-2">{recordTitle}</p>

	<!-- Said out loud here, unlike the teaser on the record page. Someone who
	     followed "View all updates" or a shared link has asked the question, and
	     a blank page reads as broken rather than as quiet. The record itself is
	     published — an unpublished one 404s in the load — so this discloses
	     nothing the record page does not. -->
	{#if data.updates.length === 0}
		<p class="text-muted-foreground mt-8 leading-relaxed">{m.updates_emptyPublic()}</p>
	{:else}
		<UpdateList
			class="mt-10"
			updates={data.updates}
			orgSlug={data.orgProfile.slug}
			campaignSlug={campaign.slug}
			objectSlug={campaign.objectSlug}
			number={project.number}
		/>
	{/if}
</section>
