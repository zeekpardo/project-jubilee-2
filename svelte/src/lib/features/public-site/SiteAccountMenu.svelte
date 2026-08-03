<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';

	import { Portal } from '@ark-ui/svelte';
	import { toast } from 'svelte-sonner';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	import * as Menu from '$lib/primitives/ui/menu';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { getSiteViewerContext } from '$lib/features/site/context.svelte';
	import * as m from '$lib/i18n/messages';

	// The viewer is read from context rather than threaded through props: the
	// public site layout is shared with pages that know nothing about identity,
	// and only this component ever needs to know who is signed in.
	const site = getSiteViewerContext();
	const { authClient } = getAuthContext();

	const loginHref = $derived(resolve('/(site)/[orgSlug]/login', { orgSlug: site.orgSlug }));

	// Phase 3 relocates the donor portal under the org slug as `/{orgSlug}/me`.
	// That route does not exist yet, so this points at the portal that works
	// today and moves when the relocation lands.
	const portalHref = resolve('/(portal)/portal');

	// Public-site HTML is cached by the CDN and served to every visitor alike,
	// so no personal detail may appear in it. `hydrated` is only set from an
	// effect, which never runs on the server and runs after hydration on the
	// client, so the server markup and the first client render both show the
	// anonymous state and identity is filled in afterwards.
	let hydrated = $state(false);
	$effect(() => {
		hydrated = true;
	});

	// While the viewer query is still in flight `site.viewer` is null, which is
	// the signed-out state — the header must never hold up the page or reserve
	// space for a name that may never arrive.
	const viewer = $derived(hydrated ? site.viewer : null);

	// Shared with the sign-in link so the trigger is visually indistinguishable
	// from the other header links.
	const headerLinkClass =
		'text-muted-foreground/80 hover:text-foreground focus-visible:ring-ring rounded-md text-xs font-medium tracking-wide transition-colors focus-visible:ring-2 focus-visible:outline-none';

	async function signOut(): Promise<void> {
		try {
			const result = await authClient.signOut();
			if (result.data?.success) {
				// Server loads captured the signed-in session, so they have to
				// re-run before the page agrees the visitor is anonymous.
				await invalidateAll();
				return;
			}
			toast.error(m.publicSite_accountSignOutFailed());
		} catch {
			toast.error(m.publicSite_accountSignOutFailed());
		}
	}
</script>

{#if viewer}
	<Menu.Root positioning={{ placement: 'bottom-end', gutter: 8 }}>
		<Menu.Trigger
			class="{headerLinkClass} flex items-center gap-1 outline-hidden"
			aria-label={m.publicSite_accountMenuLabel()}
		>
			<span class="max-w-32 truncate">{viewer.firstName}</span>
			<ChevronDownIcon class="size-3.5 shrink-0" />
		</Menu.Trigger>

		<Portal>
			<Menu.Content class="min-w-48 rounded-lg">
				<!-- The full display name only needs to be read, so it is a label
				     rather than an item: nothing here is selectable. -->
				<Menu.Label class="text-muted-foreground text-xs font-normal">
					{m.publicSite_accountSignedInAs({ name: viewer.displayName })}
				</Menu.Label>

				<Menu.Separator />

				<!-- Rendered as a real anchor so it can be opened in a new tab and
				     read as a link; the menu machine follows the href on Enter. -->
				<Menu.Item value="__site-me">
					{#snippet asChild(props)}
						<a href={portalHref} {...props()}>{m.publicSite_accountMe()}</a>
					{/snippet}
				</Menu.Item>

				<Menu.Item value="__site-sign-out" onSelect={() => void signOut()}>
					{m.publicSite_accountSignOut()}
				</Menu.Item>
			</Menu.Content>
		</Portal>
	</Menu.Root>
{:else}
	<a href={loginHref} class={headerLinkClass}>
		{m.publicSite_signIn()}
	</a>
{/if}
