<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';
	import { createListCollection } from '@ark-ui/svelte/select';

	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Switch } from '$lib/primitives/ui/switch';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { Separator } from '$lib/primitives/ui/separator';
	import * as m from '$lib/i18n/messages';

	import { GRADE_VALUES, gradeLabel } from './contact-info-labels';
	import type { ContactRow } from './types';

	let {
		open = $bindable(false),
		contact = null
	}: {
		open?: boolean;
		contact?: ContactRow | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const isEdit = $derived(contact !== null);

	type PreferredContact = NonNullable<ContactRow['preferredContact']>;
	type Transparency = NonNullable<ContactRow['transparency']>;
	type ContactStatus = NonNullable<ContactRow['status']>;

	// The schema types these as closed unions with no "cleared" member, so an
	// unset choice is sent as undefined rather than an empty string.
	const UNSET = '__none__';

	const preferredCollection = createListCollection({
		items: [
			{ value: UNSET, label: m.settings_impactTag_none() },
			{ value: 'email', label: m.contactDetail_preferred_email() },
			{ value: 'mail', label: m.contactDetail_preferred_mail() },
			{ value: 'phone', label: m.contactDetail_preferred_phone() }
		]
	});

	const transparencyCollection = createListCollection({
		items: [
			{ value: UNSET, label: m.settings_impactTag_none() },
			{ value: 'summary', label: m.contactDetail_transparency_summary() },
			{ value: 'full', label: m.contactDetail_transparency_full() }
		]
	});

	const statusCollection = createListCollection({
		items: [
			{ value: UNSET, label: m.settings_impactTag_none() },
			{ value: 'active', label: m.contactDetail_status_active() },
			{ value: 'inactive', label: m.contactDetail_status_inactive() }
		]
	});

	const gradeCollection = createListCollection({
		items: [
			{ value: UNSET, label: m.settings_impactTag_none() },
			...GRADE_VALUES.map((value) => ({ value: String(value), label: gradeLabel(value) }))
		]
	});

	let firstName = $state('');
	let lastName = $state('');
	let givenName = $state('');
	let middleName = $state('');
	let nickname = $state('');
	let namePrefix = $state('');
	let nameSuffix = $state('');
	let publicFirstName = $state('');
	let email = $state('');
	let phone = $state('');
	let organization = $state('');
	let addressLine1 = $state('');
	let addressLine2 = $state('');
	let city = $state('');
	let stateRegion = $state('');
	let postalCode = $state('');
	let country = $state('');
	let preferredContact = $state<string>(UNSET);
	let transparency = $state<string>(UNSET);
	let birthdate = $state('');
	let anniversary = $state('');
	let gender = $state('');
	let child = $state(false);
	let grade = $state<string>(UNSET);
	let graduationYear = $state('');
	let schoolName = $state('');
	let schoolType = $state('');
	let medicalNotes = $state('');
	let maritalStatus = $state('');
	let membership = $state('');
	let status = $state<string>(UNSET);
	let inactiveReason = $state('');
	let inactivatedOn = $state('');
	let campus = $state('');
	let barcodesText = $state('');
	let remoteId = $state('');
	let avatarUrl = $state('');
	let notes = $state('');
	let saving = $state(false);
	let errorMessage = $state('');

	$effect(() => {
		if (!open) return;
		firstName = contact?.firstName ?? '';
		lastName = contact?.lastName ?? '';
		givenName = contact?.givenName ?? '';
		middleName = contact?.middleName ?? '';
		nickname = contact?.nickname ?? '';
		namePrefix = contact?.namePrefix ?? '';
		nameSuffix = contact?.nameSuffix ?? '';
		publicFirstName = contact?.publicFirstName ?? '';
		email = contact?.email ?? '';
		phone = contact?.phone ?? '';
		organization = contact?.organization ?? '';
		addressLine1 = contact?.addressLine1 ?? '';
		addressLine2 = contact?.addressLine2 ?? '';
		city = contact?.city ?? '';
		stateRegion = contact?.state ?? '';
		postalCode = contact?.postalCode ?? '';
		country = contact?.country ?? '';
		preferredContact = contact?.preferredContact ?? UNSET;
		transparency = contact?.transparency ?? UNSET;
		birthdate = contact?.birthdate ?? '';
		anniversary = contact?.anniversary ?? '';
		gender = contact?.gender ?? '';
		child = contact?.child ?? false;
		grade = contact?.grade === undefined ? UNSET : String(contact.grade);
		graduationYear = contact?.graduationYear === undefined ? '' : String(contact.graduationYear);
		schoolName = contact?.schoolName ?? '';
		schoolType = contact?.schoolType ?? '';
		medicalNotes = contact?.medicalNotes ?? '';
		maritalStatus = contact?.maritalStatus ?? '';
		membership = contact?.membership ?? '';
		status = contact?.status ?? UNSET;
		inactiveReason = contact?.inactiveReason ?? '';
		inactivatedOn = contact?.inactivatedOn ?? '';
		campus = contact?.campus ?? '';
		barcodesText = (contact?.barcodes ?? []).join('\n');
		remoteId = contact?.remoteId ?? '';
		avatarUrl = contact?.avatarUrl ?? '';
		notes = contact?.notes ?? '';
		errorMessage = '';
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!firstName.trim()) return;
		saving = true;
		errorMessage = '';
		try {
			// An empty string clears the stored value; undefined would leave it be.
			const fields = {
				firstName: firstName.trim(),
				lastName: lastName.trim(),
				givenName: givenName.trim(),
				middleName: middleName.trim(),
				nickname: nickname.trim(),
				namePrefix: namePrefix.trim(),
				nameSuffix: nameSuffix.trim(),
				publicFirstName: publicFirstName.trim(),
				email: email.trim(),
				phone: phone.trim(),
				organization: organization.trim(),
				addressLine1: addressLine1.trim(),
				addressLine2: addressLine2.trim(),
				city: city.trim(),
				state: stateRegion.trim(),
				postalCode: postalCode.trim(),
				country: country.trim(),
				birthdate: birthdate.trim(),
				anniversary: anniversary.trim(),
				gender: gender.trim(),
				child,
				// Numbers have no empty-string equivalent, so a blank select/input is
				// sent as undefined: it leaves a previously stored value untouched
				// rather than clearing it.
				grade: grade === UNSET ? undefined : Number(grade),
				graduationYear:
					graduationYear.trim() === '' ? undefined : Number.parseInt(graduationYear.trim(), 10),
				schoolName: schoolName.trim(),
				schoolType: schoolType.trim(),
				medicalNotes: medicalNotes.trim(),
				maritalStatus: maritalStatus.trim(),
				membership: membership.trim(),
				inactiveReason: inactiveReason.trim(),
				inactivatedOn: inactivatedOn.trim(),
				campus: campus.trim(),
				barcodes: barcodesText
					.split('\n')
					.map((line) => line.trim())
					.filter((line) => line !== ''),
				remoteId: remoteId.trim(),
				avatarUrl: avatarUrl.trim(),
				notes: notes.trim()
			};
			const chosenPreferred =
				preferredContact === UNSET ? null : (preferredContact as PreferredContact);
			const chosenTransparency = transparency === UNSET ? null : (transparency as Transparency);
			const chosenStatus = status === UNSET ? null : (status as ContactStatus);

			if (isEdit && contact) {
				await client.mutation(api.contacts.mutations.updateContact, {
					contactId: contact._id,
					...fields,
					// null clears; undefined would leave a previously-set value alone.
					preferredContact: chosenPreferred,
					transparency: chosenTransparency,
					status: chosenStatus
				});
			} else {
				await client.mutation(api.contacts.mutations.createContact, {
					...fields,
					status: status === UNSET ? undefined : (status as ContactStatus)
				});
			}
			toast.success(m.contacts_saved());
			open = false;
		} catch (error) {
			errorMessage = error instanceof ConvexError ? String(error.data) : m.state_saveFailed();
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] md:max-w-2xl">
		<Dialog.Header>
			<Dialog.Title>{isEdit ? m.contacts_edit() : m.contacts_new()}</Dialog.Title>
		</Dialog.Header>
		<form class="flex flex-col gap-4" onsubmit={submit}>
			<h3 class="text-sm font-semibold">{m.contactDetail_section_name()}</h3>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-first">{m.field_firstName()}</Label>
					<Input id="contact-first" bind:value={firstName} required />
					<p class="text-muted-foreground text-xs">{m.contactDetail_firstNameHelp()}</p>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-last">{m.field_lastName()}</Label>
					<Input id="contact-last" bind:value={lastName} />
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-given">{m.contactDetail_givenName()}</Label>
					<Input id="contact-given" bind:value={givenName} />
					<p class="text-muted-foreground text-xs">{m.contactDetail_givenNameHelp()}</p>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-middle">{m.contactDetail_middleName()}</Label>
					<Input id="contact-middle" bind:value={middleName} />
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-prefix">{m.contactDetail_namePrefix()}</Label>
					<Input id="contact-prefix" bind:value={namePrefix} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-suffix">{m.contactDetail_nameSuffix()}</Label>
					<Input id="contact-suffix" bind:value={nameSuffix} />
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-nickname">{m.contactDetail_nickname()}</Label>
					<Input id="contact-nickname" bind:value={nickname} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-public-first">{m.contactDetail_publicFirstName()}</Label>
					<Input id="contact-public-first" bind:value={publicFirstName} />
					<p class="text-muted-foreground text-xs">{m.contactDetail_publicFirstNameHelp()}</p>
				</div>
			</div>

			<Separator />

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-email">{m.field_email()}</Label>
					<Input id="contact-email" type="email" bind:value={email} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-phone">{m.field_phone()}</Label>
					<Input id="contact-phone" bind:value={phone} />
				</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-org">{m.field_organization()}</Label>
				<Input id="contact-org" bind:value={organization} />
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="contact-address1">{m.contactDetail_addressLine1()}</Label>
				<Input id="contact-address1" bind:value={addressLine1} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-address2">{m.contactDetail_addressLine2()}</Label>
				<Input id="contact-address2" bind:value={addressLine2} />
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-city">{m.contactDetail_city()}</Label>
					<Input id="contact-city" bind:value={city} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-state">{m.contactDetail_state()}</Label>
					<Input id="contact-state" bind:value={stateRegion} />
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-postal">{m.contactDetail_postalCode()}</Label>
					<Input id="contact-postal" bind:value={postalCode} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-country">{m.contactDetail_country()}</Label>
					<Input id="contact-country" bind:value={country} />
				</div>
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label>{m.contactDetail_preferredContact()}</Label>
					<Select.Root
						collection={preferredCollection}
						value={[preferredContact]}
						onValueChange={(details: { value: string[] }): void => {
							preferredContact = details.value[0] ?? UNSET;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.settings_impactTag_none()} />
						<Select.Content>
							{#each preferredCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label>{m.contactDetail_transparency()}</Label>
					<Select.Root
						collection={transparencyCollection}
						value={[transparency]}
						onValueChange={(details: { value: string[] }): void => {
							transparency = details.value[0] ?? UNSET;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.settings_impactTag_none()} />
						<Select.Content>
							{#each transparencyCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>

			<Separator />

			<h3 class="text-sm font-semibold">{m.contactDetail_section_demographics()}</h3>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-birthdate">{m.contactDetail_birthdate()}</Label>
					<Input id="contact-birthdate" type="date" bind:value={birthdate} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-anniversary">{m.contactDetail_anniversary()}</Label>
					<Input id="contact-anniversary" type="date" bind:value={anniversary} />
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-gender">{m.contactDetail_gender()}</Label>
					<Input id="contact-gender" bind:value={gender} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label>{m.contactDetail_grade()}</Label>
					<Select.Root
						collection={gradeCollection}
						value={[grade]}
						onValueChange={(details: { value: string[] }): void => {
							grade = details.value[0] ?? UNSET;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.settings_impactTag_none()} />
						<Select.Content>
							{#each gradeCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-graduation-year">{m.contactDetail_graduationYear()}</Label>
					<Input id="contact-graduation-year" type="number" bind:value={graduationYear} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-school-type">{m.contactDetail_schoolType()}</Label>
					<Input id="contact-school-type" bind:value={schoolType} />
				</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-school-name">{m.contactDetail_schoolName()}</Label>
				<Input id="contact-school-name" bind:value={schoolName} />
			</div>
			<div class="flex flex-col gap-2">
				<Switch bind:checked={child}>{m.contactDetail_child()}</Switch>
				<p class="text-muted-foreground text-xs">{m.contactDetail_childHelp()}</p>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-medical-notes">{m.contactDetail_medicalNotes()}</Label>
				<Textarea id="contact-medical-notes" bind:value={medicalNotes} rows={3} />
			</div>

			<Separator />

			<h3 class="text-sm font-semibold">{m.contactDetail_section_membership()}</h3>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-marital-status">{m.contactDetail_maritalStatus()}</Label>
					<Input id="contact-marital-status" bind:value={maritalStatus} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-membership">{m.contactDetail_membership()}</Label>
					<Input id="contact-membership" bind:value={membership} />
				</div>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label>{m.field_status()}</Label>
					<Select.Root
						collection={statusCollection}
						value={[status]}
						onValueChange={(details: { value: string[] }): void => {
							status = details.value[0] ?? UNSET;
						}}
					>
						<Select.Trigger class="w-full" placeholder={m.settings_impactTag_none()} />
						<Select.Content>
							{#each statusCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-campus">{m.contactDetail_campus()}</Label>
					<Input id="contact-campus" bind:value={campus} />
				</div>
			</div>
			{#if status === 'inactive'}
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<Label for="contact-inactive-reason">{m.contactDetail_inactiveReason()}</Label>
						<Input id="contact-inactive-reason" bind:value={inactiveReason} />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="contact-inactivated-on">{m.contactDetail_inactivatedOn()}</Label>
						<Input id="contact-inactivated-on" type="date" bind:value={inactivatedOn} />
					</div>
				</div>
			{/if}

			<Separator />

			<h3 class="text-sm font-semibold">{m.contactDetail_section_other()}</h3>
			<div class="flex flex-col gap-1.5">
				<Label for="contact-barcodes">{m.contactDetail_barcodes()}</Label>
				<Textarea id="contact-barcodes" bind:value={barcodesText} rows={3} />
				<p class="text-muted-foreground text-xs">{m.contactDetail_barcodesHelp()}</p>
			</div>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="contact-remote-id">{m.contactDetail_remoteId()}</Label>
					<Input id="contact-remote-id" bind:value={remoteId} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="contact-avatar-url">{m.contactDetail_avatarUrl()}</Label>
					<Input id="contact-avatar-url" type="url" bind:value={avatarUrl} />
				</div>
			</div>

			<Separator />

			<div class="flex flex-col gap-1.5">
				<Label for="contact-notes">{m.field_notes()}</Label>
				<Textarea id="contact-notes" bind:value={notes} rows={3} />
			</div>

			{#if errorMessage}
				<p class="text-destructive text-sm">{errorMessage}</p>
			{/if}

			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={saving}>
					{isEdit ? m.action_saveChanges() : m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
