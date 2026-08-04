<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/i18n/messages';
	import UpdateArticle from '$lib/features/public-site/UpdateArticle.svelte';

	let { data } = $props();
	const campaign = $derived(data.campaign);
	const update = $derived(data.update);
</script>

<svelte:head>
	<title>{update.title} · {campaign.name}</title>
	{#if update.description}
		<meta name="description" content={update.description} />
		<meta property="og:description" content={update.description} />
	{/if}
	<meta property="og:title" content={update.title} />
	<meta property="og:type" content="article" />
</svelte:head>

<article class="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
	<!-- Up to the archive, not to the campaign: someone who arrived on a shared
	     link most likely wants the other posts next, and the campaign itself is
	     one more step down the page. -->
	<a
		href={resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/updates', {
			orgSlug: data.orgProfile.slug,
			campaignSlug: campaign.slug,
			objectSlug: campaign.objectSlug
		})}
		class="text-muted-foreground hover:text-primary text-sm font-medium transition-colors"
	>
		&larr; {m.updates_backToAll()}
	</a>

	<div class="mt-6">
		<UpdateArticle title={update.title} publishedAt={update.publishedAt} html={update.html} />
	</div>

	<!-- And at the end, the way back to the thing the post is about. A reader who
	     got here from a forwarded link has finished the news and has no other
	     route into the campaign. -->
	<p class="border-border/60 mt-12 border-t pt-6">
		<a
			href={resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]', {
				orgSlug: data.orgProfile.slug,
				campaignSlug: campaign.slug,
				objectSlug: campaign.objectSlug
			})}
			class="text-primary text-sm font-medium transition-colors hover:underline"
		>
			{m.updates_backToCampaign({ name: campaign.name })} &rarr;
		</a>
	</p>
</article>
