<script lang="ts">
	// Svelte
	import { SvelteDate } from 'svelte/reactivity';

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import * as Menu from '$lib/primitives/ui/menu';
	import * as Table from '$lib/primitives/ui/table';
	import { Button, buttonVariants } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Toggle } from '@ark-ui/svelte/toggle';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	// Icons
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	// Types
	import { Portal } from '@ark-ui/svelte';
	import type { ListApiKeysType } from '$lib/auth/types';
	type ListApiKeysResponse = NonNullable<ListApiKeysType>;
	type ApiKeyType = ListApiKeysResponse['apiKeys'][number];

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { api, authClient } = getAuthContext();

	let { initialData }: { initialData?: { apiKeys?: ListApiKeysType } } = $props();

	const auth = useAuth();
	const apiKeysResponse = useQuery(
		api.users.queries.listApiKeys,
		() => (auth.isAuthenticated ? {} : 'skip'),
		() => ({
			initialData: initialData?.apiKeys
		})
	);

	const apiKeysData = $derived(apiKeysResponse?.data);
	const apiKeys = $derived(apiKeysData?.apiKeys ?? []);

	// Form state
	let dialogOpen = $state(false);
	let name = $state('');
	let expirationOption = $state<'7' | '30' | '60' | '90' | 'custom' | 'never'>('30');
	let customDate = $state('');
	let mode = $state<'create' | 'update'>('create');
	let editKeyId: string | null = $state(null);

	let confirmDeleteOpen = $state(false);
	let toDeleteId: string | null = $state(null);
	let toDeleteName: string = $state('');

	let showSecretOpen = $state(false);
	let newKey: string = $state('');

	// Copy toggle state
	let copied: boolean = $state(false);
	let copyResetTimer: ReturnType<typeof setTimeout> | null = $state(null);

	const handleCopyClick = async (): Promise<void> => {
		await copySecret();
		copied = true;
		if (copyResetTimer) clearTimeout(copyResetTimer);
		copyResetTimer = setTimeout(() => {
			copied = false;
			copyResetTimer = null;
		}, 1200);
	};

	// Loading states
	let isSubmitting: boolean = $state(false);
	let isDeleting: boolean = $state(false);

	// Calculate expiration dates
	const getExpirationDate = (days: number): Date => {
		const date = new SvelteDate();
		date.setDate(date.getDate() + days);
		return date;
	};

	const formatDate = (date: Date): string => {
		return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
	};

	const toInputDate = (date: Date): string => {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, '0');
		const d = String(date.getDate()).padStart(2, '0');
		return `${y}-${m}-${d}`;
	};

	const copySecret = async (): Promise<void> => {
		if (!newKey) return;
		await navigator.clipboard.writeText(newKey);
	};

	const expirationCollection = $derived(
		createListCollection({
			items: [
				{ value: '7', label: `7 days (${formatDate(getExpirationDate(7))})` },
				{ value: '30', label: `30 days (${formatDate(getExpirationDate(30))})` },
				{ value: '60', label: `60 days (${formatDate(getExpirationDate(60))})` },
				{ value: '90', label: `90 days (${formatDate(getExpirationDate(90))})` },
				{ value: 'custom', label: 'Custom' },
				{ value: 'never', label: 'No expiration' }
			]
		})
	);

	const createApiKey = async (name: string, expiresIn?: number) => {
		const res = await authClient.apiKey.create({ name, expiresIn });
		if (res.error) {
			toast.error(`${res.error.status} ${res.error.statusText} ${res.error.message}`);
		} else {
			toast.success('API Key created successfully');
			newKey = res.data?.key ?? '';
			showSecretOpen = newKey.length > 0;
		}
	};

	const deleteApiKey = async (keyId: string) => {
		const res = await authClient.apiKey.delete({ keyId });
		if (res.error) {
			toast.error(`${res.error.status} ${res.error.statusText} ${res.error.message}`);
		} else {
			toast.success('API Key deleted successfully');
		}
	};

	const updateApiKey = async (keyId: string, name: string, expiresIn?: number) => {
		const res = await authClient.apiKey.update({ keyId, name, expiresIn });
		if (res.error) {
			toast.error(`${res.error.status} ${res.error.statusText} ${res.error.message}`);
		} else {
			toast.success('API Key updated successfully');
		}
	};

	const openCreate = () => {
		mode = 'create';
		editKeyId = null;
		name = '';
		expirationOption = '30';
		customDate = '';
		dialogOpen = true;
	};

	const openUpdate = (apiKey: ApiKeyType) => {
		mode = 'update';
		editKeyId = apiKey.id;
		name = apiKey.name ?? '';
		if (!apiKey.expiresAt) {
			expirationOption = 'never';
			customDate = '';
		} else {
			const exp = new Date(apiKey.expiresAt);
			const now = new Date();
			const days = Math.round((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
			if (days === 7 || days === 30 || days === 60 || days === 90) {
				expirationOption = String(days) as typeof expirationOption;
				customDate = '';
			} else {
				expirationOption = 'custom';
				customDate = toInputDate(exp);
			}
		}
		dialogOpen = true;
	};

	const openConfirmDelete = (apiKey: { id: string; name: string }) => {
		toDeleteId = apiKey.id;
		toDeleteName = apiKey.name;
		confirmDeleteOpen = true;
	};

	const handleConfirmDelete = async (): Promise<void> => {
		if (!toDeleteId) return;
		isDeleting = true;
		try {
			await deleteApiKey(toDeleteId);
		} finally {
			isDeleting = false;
		}
		toDeleteId = null;
		toDeleteName = '';
		confirmDeleteOpen = false;
	};

	const handleSubmit = async (): Promise<void> => {
		if (!name.trim()) {
			toast.error('Please enter a name for the API key');
			return;
		}

		let expiresIn: number | undefined;

		if (expirationOption === 'never') {
			expiresIn = undefined;
		} else if (expirationOption === 'custom') {
			if (!customDate) {
				toast.error('Please select a custom date');
				return;
			}
			const selectedDate = new Date(customDate);
			const now = new Date();
			const diffMs = selectedDate.getTime() - now.getTime();
			expiresIn = Math.floor(diffMs / 1000); // Convert to seconds
		} else {
			const days = parseInt(expirationOption);
			expiresIn = days * 24 * 60 * 60; // Convert days to seconds
		}

		isSubmitting = true;
		try {
			if (mode === 'create') {
				await createApiKey(name, expiresIn);
			} else if (mode === 'update' && editKeyId) {
				await updateApiKey(editKeyId, name, expiresIn);
			}
		} finally {
			isSubmitting = false;
		}

		// Reset form
		name = '';
		expirationOption = '30';
		customDate = '';
		dialogOpen = false;
		mode = 'create';
		editKeyId = null;
	};
</script>

<div class="flex w-full flex-col gap-3 pb-6">
	<span class="text-muted-foreground text-xs">API Keys</span>
	<!-- List api keys with name, creation data, expiry data -->
	{#if apiKeysData}
		{#if apiKeys.length > 0}
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head>Created At</Table.Head>
						<Table.Head>Expires At</Table.Head>
						<Table.Head></Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each apiKeys as apiKey (apiKey.id)}
						<Table.Row>
							<Table.Cell>{apiKey.name}</Table.Cell>
							<Table.Cell>{new Date(apiKey.createdAt).toLocaleDateString()}</Table.Cell>
							<Table.Cell>
								{apiKey.expiresAt ? new Date(apiKey.expiresAt).toLocaleDateString() : 'Never'}
							</Table.Cell>
							<Table.Cell class="text-right">
								<Menu.Root>
									<Menu.Trigger class={buttonVariants({ variant: 'ghost', size: 'icon' })}>
										<EllipsisVerticalIcon class="size-4" />
									</Menu.Trigger>
									<Portal>
										<Menu.Content>
											<Menu.Item value="update" onclick={() => openUpdate(apiKey)}>Update</Menu.Item
											>
											<Menu.Item
												value="delete"
												variant="destructive"
												onclick={() =>
													openConfirmDelete({ id: apiKey.id, name: apiKey.name ?? '' })}
												>Delete</Menu.Item
											>
										</Menu.Content>
									</Portal>
								</Menu.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}

		<!-- Create / Update dialog -->
		<Dialog.Root bind:open={dialogOpen}>
			<div>
				<Dialog.Trigger
					class={buttonVariants({ variant: 'secondary', size: 'sm' })}
					onclick={openCreate}>Create API Key</Dialog.Trigger
				>
			</div>
			<Dialog.Content class="sm:w-md">
				<Dialog.Header>
					<Dialog.Title>{mode === 'create' ? 'Create API Key' : 'Update API Key'}</Dialog.Title>
				</Dialog.Header>

				<div class="mt-4 flex flex-col gap-4">
					<!-- Name input -->
					<div class="flex flex-col gap-1.5">
						<Label for="api-key-name">Name</Label>
						<Input
							id="api-key-name"
							type="text"
							bind:value={name}
							placeholder="Enter API key name"
							disabled={isSubmitting}
						/>
					</div>

					<!-- Expiration selector -->
					<div class="flex flex-col gap-1.5">
						<Label for="expiration">Expiration</Label>
						<Select.Root
							collection={expirationCollection}
							value={[expirationOption]}
							onValueChange={(v: { value: string[] }): void => {
								expirationOption = v.value[0] as typeof expirationOption;
							}}
							class="w-56"
						>
							<Select.Trigger
								placeholder="Select expiration"
								class="w-full"
								disabled={isSubmitting}
							/>
							<Select.Content>
								{#each expirationCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<!-- Custom date picker (only shown when Custom is selected) -->
					{#if expirationOption === 'custom'}
						<div class="flex flex-col gap-1.5">
							<Label for="custom-date">Select date *</Label>
							<Input id="custom-date" type="date" bind:value={customDate} disabled={isSubmitting} />
						</div>
					{/if}
				</div>

				<div class="mt-6 flex w-full items-center justify-end gap-2">
					<Dialog.Close class={buttonVariants({ variant: 'secondary' })}>Cancel</Dialog.Close>
					<Button onclick={handleSubmit} loading={isSubmitting}>
						{#if isSubmitting}
							{mode === 'create' ? 'Creating...' : 'Saving...'}
						{:else}
							{mode === 'create' ? 'Create' : 'Save'}
						{/if}
					</Button>
				</div>
				<Dialog.CloseX />
			</Dialog.Content>
		</Dialog.Root>

		<!-- Delete confirmation dialog -->
		<Dialog.Root bind:open={confirmDeleteOpen}>
			<Dialog.Content class="sm:w-sm">
				<Dialog.Header>
					<Dialog.Title>Delete API Key</Dialog.Title>
				</Dialog.Header>
				<p class="text-sm">
					Are you sure you want to delete '{toDeleteName}'? This action cannot be undone.
				</p>
				<div class="mt-4 flex w-full items-center justify-end gap-2">
					<Dialog.Close class={buttonVariants({ variant: 'secondary', size: 'sm' })}
						>Cancel</Dialog.Close
					>
					<Button
						variant="destructive"
						size="sm"
						onclick={handleConfirmDelete}
						loading={isDeleting}
					>
						{#if isDeleting}Deleting...{:else}Delete{/if}
					</Button>
				</div>
				<Dialog.CloseX />
			</Dialog.Content>
		</Dialog.Root>

		<!-- New key modal (one-time display) -->
		<Dialog.Root bind:open={showSecretOpen}>
			<Dialog.Content class="sm:w-md">
				<Dialog.Header>
					<Dialog.Title>Your new API key</Dialog.Title>
				</Dialog.Header>
				<p class="text-sm">Copy and store this key now. You won’t be able to see it again.</p>
				<div class="mt-4 flex items-center gap-2">
					<Input readonly value={newKey} class="font-mono" />
					<Toggle.Root
						bind:pressed={copied}
						onclick={handleCopyClick}
						class={buttonVariants({ variant: 'secondary', size: 'icon' }) + ' shrink-0'}
						aria-label="Copy API key"
					>
						{#if copied}
							<CheckIcon class="size-4" />
						{:else}
							<CopyIcon class="size-4" />
						{/if}
					</Toggle.Root>
				</div>
				<div class="mt-4 flex w-full items-center justify-end gap-2">
					<Dialog.Close class={buttonVariants({ variant: 'secondary', size: 'sm' })}
						>Close</Dialog.Close
					>
				</div>
				<Dialog.CloseX />
			</Dialog.Content>
		</Dialog.Root>
	{/if}
</div>
