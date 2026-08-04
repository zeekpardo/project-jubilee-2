<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/i18n/messages';
	import UpdateArticle from '$lib/features/public-site/UpdateArticle.svelte';

	let { data } = $props();
	const campaign = $derived(data.campaign);
	const project = $derived(data.project);
	const update = $derived(data.update);

	// Built exactly as the record page builds it, so the links back name the
	// record the way its own page does.
	const objectLower = $derived(campaign.objectLabel.toLowerCase());
	const recordTitle = $derived(
		project.name
			? m.publicSite_projectTitle({ name: project.name, object: objectLower })
			: m.publicSite_projectTitlePlaceholder({ object: objectLower })
	);
</script>

<svelte:head>
	<title>{update.title} · {recordTitle} · {campaign.name}</title>
	{#if update.description}
		<meta name="description" content={update.description} />
		<meta property="og:description" content={update.description} />
	{/if}
	<meta property="og:title" content={update.title} />
	<meta property="og:type" content="article" />
</svelte:head>

<article class="mx-auto max-w-3xl px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
	<!-- Up to this record's archive rather than to the record: someone who
	     arrived on a shared link is most likely reading the news, and the record
	     itself is one more step at the foot of the page. -->
	<a
		href={resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/[number]/updates', {
			orgSlug: data.orgProfile.slug,
			campaignSlug: campaign.slug,
			objectSlug: campaign.objectSlug,
			number: project.number
		})}
		class="text-muted-foreground hover:text-primary text-sm font-medium transition-colors"
	>
		&larr; {m.updates_backToAll()}
	</a>

	<div class="mt-6">
		<UpdateArticle title={update.title} publishedAt={update.publishedAt} html={update.html} />
	</div>

	<!-- And at the end, back to the family the post is about. A reader who got
	     here from a forwarded link has finished the news and has no other route
	     into the record — which is the page with the way to give on it. -->
	<p class="border-border/60 mt-12 border-t pt-6">
		<a
			href={resolve('/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/[number]', {
				orgSlug: data.orgProfile.slug,
				campaignSlug: campaign.slug,
				objectSlug: campaign.objectSlug,
				number: project.number
			})}
			class="text-primary text-sm font-medium transition-colors hover:underline"
		>
			{m.updates_backToRecord({ name: recordTitle })} &rarr;
		</a>
	</p>
</article>
