<script lang="ts">
	import * as m from '$lib/i18n/messages';

	// `homeHref` is a prop (not hardcoded '/') because the public site is
	// multi-campaign: the wordmark should go to the org root or the current
	// campaign, depending on where the caller is rendering this from.
	let { orgName, homeHref }: { orgName: string; homeHref: string } = $props();
</script>

<header class="border-border/70 bg-background/85 sticky top-0 z-40 border-b backdrop-blur-md">
	<div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:h-16 sm:px-6">
		<a
			href={homeHref}
			class="focus-visible:ring-ring rounded-md focus-visible:ring-2 focus-visible:outline-none"
			aria-label={m.publicSite_homeAriaLabel({ orgName })}
		>
			<span class="flex items-center gap-2.5">
				<svg
					viewBox="0 0 24 24"
					aria-hidden="true"
					class="text-primary size-6"
					fill="none"
					stroke="currentColor"
					stroke-width="1.75"
					stroke-linecap="round"
				>
					<!-- Rising sun over an open horizon. -->
					<path d="M4 15.5a8 8 0 0 1 16 0" />
					<path d="M2.5 19h19" class="text-accent" stroke="var(--accent)" />
					<path d="M12 4v2.5" />
					<path d="M6.2 6.7l1.7 1.7" />
					<path d="M17.8 6.7l-1.7 1.7" />
				</svg>
				<span
					class="ps-serif text-foreground text-lg leading-none font-semibold tracking-tight sm:text-xl"
				>
					{orgName}
				</span>
			</span>
		</a>

		<nav aria-label={m.publicSite_navLabel()} class="flex items-center gap-5 sm:gap-7">
			<!-- Newsletter is out of scope for this slice; sign-in is the only
			     other public-site link the reference header keeps. -->
			<a
				href="/signin"
				class="text-muted-foreground/80 hover:text-foreground focus-visible:ring-ring rounded-md text-xs font-medium tracking-wide transition-colors focus-visible:ring-2 focus-visible:outline-none"
			>
				{m.publicSite_signIn()}
			</a>
		</nav>
	</div>
</header>
