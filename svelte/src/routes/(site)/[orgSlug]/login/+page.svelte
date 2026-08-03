<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	import SignIn from '$lib/auth/ui/SignIn.svelte';
	import { safeRedirectTo } from '$lib/domain/safe-redirect';
	import * as m from '$lib/i18n/messages';

	let { data } = $props();

	const orgName = $derived(data.orgProfile.name);
	const orgHref = $derived(resolve('/(site)/[orgSlug]', { orgSlug: data.orgProfile.slug }));

	/**
	 * Passing this down unconditionally matters: SignIn falls back to reading
	 * `redirectTo` off the URL itself when the prop is absent, and that read is
	 * unvalidated. Always handing it the sanitised value is what keeps the raw
	 * query string from reaching the redirect at all.
	 */
	const redirectTo = $derived(safeRedirectTo(page.url.searchParams.get('redirectTo'), orgHref));
</script>

<svelte:head>
	<title>{m.publicSite_loginTitle({ orgName })} · {orgName}</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-md flex-col px-4 py-16 sm:px-6 sm:py-24">
	<div class="text-center">
		<h1 class="ps-serif text-foreground text-3xl leading-tight sm:text-4xl">
			{m.publicSite_loginTitle({ orgName })}
		</h1>
		<p class="text-muted-foreground mx-auto mt-4 max-w-sm text-sm leading-relaxed">
			{m.publicSite_loginSubtitle()}
		</p>
	</div>

	<!--
		Magic link only. A donor visits twice a year, so a password or a rotating
		code is a credential they will have forgotten by the next gift, and every
		forgotten credential is a support ticket the org has to answer. The prop
		narrows the offer; AUTH_CONSTANTS still decides what is possible at all.
	-->
	<SignIn methods={['magicLink']} {redirectTo} hideHeader class="mt-8 px-0" />

	<a
		href={orgHref}
		class="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-8 self-center rounded-sm text-sm underline underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
	>
		{m.publicSite_loginBack({ orgName })}
	</a>
</section>
