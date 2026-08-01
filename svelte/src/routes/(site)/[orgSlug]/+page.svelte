<script lang="ts">
	import { resolve } from '$app/paths';
	import * as m from '$lib/i18n/messages';

	let { data } = $props();
</script>

<svelte:head>
	<title>{m.publicSite_campaignsTitle()} · {data.orgProfile.name}</title>
</svelte:head>

{#if data.campaigns.length === 0}
	<section class="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
		<h1 class="ps-serif text-foreground text-3xl leading-tight sm:text-4xl">
			{m.publicSite_orgEmptyTitle()}
		</h1>
		<p class="text-muted-foreground mx-auto mt-4 max-w-md text-sm leading-relaxed">
			{m.publicSite_orgEmptyBody()}
		</p>
	</section>
{:else}
	<section class="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
		<h1 class="ps-serif text-foreground text-3xl leading-[1.08] sm:text-5xl">
			{m.publicSite_campaignsTitle()}
		</h1>
		<div class="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
			{#each data.campaigns as campaign (campaign.slug)}
				<a
					href={resolve('/(site)/[orgSlug]/[campaignSlug]', {
						orgSlug: data.orgProfile.slug,
						campaignSlug: campaign.slug
					})}
					class="group bg-card ring-border hover:ring-primary/40 focus-visible:ring-ring flex flex-col overflow-hidden rounded-xl shadow-xs ring-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2 focus-visible:outline-none"
				>
					{#if campaign.coverImageUrl}
						<img
							src={campaign.coverImageUrl}
							alt=""
							loading="lazy"
							class="aspect-video w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
						/>
					{/if}
					<div class="flex flex-1 flex-col gap-2 p-4 sm:p-5">
						<h2 class="ps-serif text-card-foreground text-xl leading-snug">{campaign.name}</h2>
						{#if campaign.summary}
							<p class="text-muted-foreground line-clamp-2 text-sm leading-relaxed">
								{campaign.summary}
							</p>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	</section>
{/if}
