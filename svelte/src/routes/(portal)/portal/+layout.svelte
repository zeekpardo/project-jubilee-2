<script lang="ts">
	// The portal borrows the public site's stylesheet rather than the admin
	// shell's. A donor or a family member arrives from an email, not from a
	// working session in an app, and the surface they land on should look like
	// the one they were reading a minute ago.
	import '$lib/features/public-site/public.css';

	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import { cn } from '$lib/primitives/utils';
	import * as m from '$lib/i18n/messages';

	let { data, children } = $props();

	const NAV = [
		{ href: resolve('/(portal)/portal'), label: () => m.portal_navHome() },
		{ href: resolve('/(portal)/portal/records'), label: () => m.portal_navRecords() },
		{ href: resolve('/(portal)/portal/giving'), label: () => m.portal_navGiving() },
		{ href: resolve('/(portal)/portal/tasks'), label: () => m.portal_navTasks() },
		{ href: resolve('/(portal)/portal/profile'), label: () => m.portal_navProfile() }
	];

	// Exact for the root so every child does not light it up as well.
	const isCurrent = (href: string) =>
		href === '/portal' ? page.url.pathname === '/portal' : page.url.pathname.startsWith(href);
</script>

<div data-theme="jubilee" class="bg-background text-foreground flex min-h-[100dvh] flex-col">
	{#if !data.overview}
		<!--
			Reached only by a signed-in person with no portal identity who is also
			not staff — staff are redirected to /app in the load. There is nothing
			to gate further and nothing to show, so this says so plainly rather
			than rendering an empty portal.
		-->
		<main class="flex flex-1 items-center justify-center p-8">
			<EmptyState title={m.portal_noAccessTitle()} description={m.portal_noAccessBody()} />
		</main>
	{:else}
		<header class="border-border/70 bg-background/85 sticky top-0 z-40 border-b backdrop-blur-md">
			<div class="mx-auto flex max-w-4xl flex-col gap-2 px-4 py-3 sm:px-6">
				<p class="ps-serif text-lg leading-none font-semibold tracking-tight">
					{m.portal_greeting({ name: data.overview.profile.firstName })}
				</p>
				<nav aria-label={m.portal_navigation()} class="-mx-1 flex gap-1 overflow-x-auto">
					<!-- Every href in NAV is already a resolve() of a literal route id;
					     the rule only recognises the call at the attribute itself. -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					{#each NAV as item (item.href)}
						<a
							href={item.href}
							aria-current={isCurrent(item.href) ? 'page' : undefined}
							class={cn(
								'focus-visible:ring-ring rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:outline-none',
								isCurrent(item.href)
									? 'bg-primary/10 text-primary font-medium'
									: 'text-muted-foreground hover:text-foreground'
							)}
						>
							{item.label()}
						</a>
					{/each}
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				</nav>
			</div>
		</header>

		<main class="mx-auto w-full max-w-4xl flex-1 px-4 py-6 sm:px-6">
			{@render children()}
		</main>
	{/if}
</div>
