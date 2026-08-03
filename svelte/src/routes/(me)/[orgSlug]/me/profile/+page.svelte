<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { createListCollection } from '@ark-ui/svelte/select';

	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import * as Select from '$lib/primitives/ui/select';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	// The org comes from the URL, not the session. It matters most here of
	// anywhere: this form WRITES, and the row it corrects is the one this org
	// holds about them, not whichever org the session happens to be active in.
	const orgSlug = $derived(page.params.orgSlug);

	const profileResponse = useQuery(api.portal.queries.getPortalProfile, () =>
		auth.isAuthenticated && orgSlug ? { orgSlug } : 'skip'
	);
	const profile = $derived(profileResponse.data);

	// `updateDetail`/`preferredContact` are closed unions with no "cleared"
	// member, so an unset choice needs a sentinel rather than an empty string
	// — the same convention `ContactFormDialog` uses for the identical fields.
	const UNSET = '__none__';

	let phone = $state('');
	let addressLine1 = $state('');
	let addressLine2 = $state('');
	let city = $state('');
	let stateRegion = $state('');
	let postalCode = $state('');
	let country = $state('');
	let updateDetail = $state<string>(UNSET);
	let preferredContact = $state<string>(UNSET);
	let saving = $state(false);

	$effect(() => {
		if (!profile) return;
		phone = profile.phone ?? '';
		addressLine1 = profile.addressLine1 ?? '';
		addressLine2 = profile.addressLine2 ?? '';
		city = profile.city ?? '';
		stateRegion = profile.state ?? '';
		postalCode = profile.postalCode ?? '';
		country = profile.country ?? '';
		updateDetail = profile.updateDetail ?? UNSET;
		preferredContact = profile.preferredContact ?? UNSET;
	});

	const updateDetailCollection = createListCollection({
		items: [
			{ value: UNSET, label: m.portal_profileNoPreference() },
			{ value: 'summary', label: m.contactDetail_updateDetail_summary() },
			{ value: 'full', label: m.contactDetail_updateDetail_full() }
		]
	});

	const preferredContactCollection = createListCollection({
		items: [
			{ value: UNSET, label: m.portal_profileNoPreference() },
			{ value: 'email', label: m.contactDetail_preferred_email() },
			{ value: 'mail', label: m.contactDetail_preferred_mail() },
			{ value: 'phone', label: m.contactDetail_preferred_phone() }
		]
	});

	const displayName = $derived(
		profile ? [profile.firstName, profile.lastName].filter(Boolean).join(' ') : ''
	);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (saving || !orgSlug) return;
		saving = true;
		try {
			await client.mutation(api.portal.mutations.updatePortalProfile, {
				orgSlug,
				phone: phone.trim() || null,
				addressLine1: addressLine1.trim() || null,
				addressLine2: addressLine2.trim() || null,
				city: city.trim() || null,
				state: stateRegion.trim() || null,
				postalCode: postalCode.trim() || null,
				country: country.trim() || null,
				updateDetail: updateDetail === UNSET ? null : (updateDetail as 'summary' | 'full'),
				preferredContact:
					preferredContact === UNSET ? null : (preferredContact as 'email' | 'mail' | 'phone')
			});
			toast.success(m.portal_profileSaved());
		} catch {
			toast.error(m.portal_profileSaveFailed());
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head>
	<title>{m.portal_profileTitle()}</title>
</svelte:head>

<header>
	<h1 class="ps-serif text-foreground text-3xl leading-tight">{m.portal_profileTitle()}</h1>
	<p class="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
		{m.portal_profileSubtitle()}
	</p>
</header>

{#if profile}
	<div class="mt-6 grid gap-4 sm:grid-cols-2">
		<div class="space-y-1.5">
			<Label>{m.portal_profileName()}</Label>
			<p class="text-foreground text-sm">{displayName}</p>
		</div>
		<div class="space-y-1.5">
			<Label>{m.portal_profileEmail()}</Label>
			<p class="text-foreground text-sm">{profile.email ?? ''}</p>
		</div>
	</div>
	<p class="text-muted-foreground mt-2 text-xs">{m.portal_profileFixedNote()}</p>

	<form onsubmit={handleSubmit} class="mt-8 flex flex-col gap-4">
		<div class="space-y-1.5">
			<Label for="portal-phone">{m.portal_profilePhone()}</Label>
			<Input id="portal-phone" bind:value={phone} />
		</div>

		<div class="space-y-1.5">
			<Label for="portal-address1">{m.portal_profileAddress()}</Label>
			<Input id="portal-address1" bind:value={addressLine1} />
		</div>
		<div class="space-y-1.5">
			<Label for="portal-address2">{m.portal_profileAddressLine2()}</Label>
			<Input id="portal-address2" bind:value={addressLine2} />
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<Label for="portal-city">{m.portal_profileCity()}</Label>
				<Input id="portal-city" bind:value={city} />
			</div>
			<div class="space-y-1.5">
				<Label for="portal-state">{m.portal_profileState()}</Label>
				<Input id="portal-state" bind:value={stateRegion} />
			</div>
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<Label for="portal-postal">{m.portal_profilePostalCode()}</Label>
				<Input id="portal-postal" bind:value={postalCode} />
			</div>
			<div class="space-y-1.5">
				<Label for="portal-country">{m.portal_profileCountry()}</Label>
				<Input id="portal-country" bind:value={country} />
			</div>
		</div>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<Label>{m.portal_profilePreferredContact()}</Label>
				<Select.Root
					collection={preferredContactCollection}
					value={[preferredContact]}
					onValueChange={(details: { value: string[] }): void => {
						preferredContact = details.value[0] ?? UNSET;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.portal_profileNoPreference()} />
					<Select.Content>
						{#each preferredContactCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="space-y-1.5">
				<Label>{m.portal_profileUpdateDetail()}</Label>
				<Select.Root
					collection={updateDetailCollection}
					value={[updateDetail]}
					onValueChange={(details: { value: string[] }): void => {
						updateDetail = details.value[0] ?? UNSET;
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.portal_profileNoPreference()} />
					<Select.Content>
						{#each updateDetailCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</div>

		<div>
			<Button type="submit" loading={saving} disabled={saving}>{m.portal_profileSave()}</Button>
		</div>
	</form>
{/if}
