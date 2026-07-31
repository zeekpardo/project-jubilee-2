<script lang="ts">
	// Svelte
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	// Primitives
	import * as Popover from '$lib/primitives/ui/popover';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Avatar from '$lib/primitives/ui/avatar';
	import { buttonVariants } from '$lib/primitives/ui/button';
	// Icons
	import Building2Icon from '@lucide/svelte/icons/building-2';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	// Components
	import CreateOrganization from '$lib/organizations/ui/CreateOrganization.svelte';

	import LeaveOrganization from '$lib/organizations/ui/LeaveOrganization.svelte';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { useRoles } from '$lib/organizations/api/roles.svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	const { api, authConstants } = getAuthContext();
	const client = useConvexClient();

	// Constants
	import { DIALOG_KEY } from '$lib/organizations/utils/organization.constants';

	// Types
	import type { PopoverRootProps } from '@ark-ui/svelte';
	import type { Pathname } from '$app/types';
	import type {
		GetActiveOrganizationType,
		ListOrganizationsType,
		GetActiveUserType,
		ListInvitationsType,
		Role
	} from '$lib/auth/types';

	// Props
	const {
		popoverPlacement = 'bottom-end',
		initialData
	}: {
		/** Placement of the popover relative to the trigger */
		popoverPlacement?: NonNullable<PopoverRootProps['positioning']>['placement'];
		initialData?: {
			activeUser?: GetActiveUserType;
			organizationList?: ListOrganizationsType;
			activeOrganization?: GetActiveOrganizationType;
			invitationList?: ListInvitationsType;
			role?: Role;
		};
	} = $props();

	if (!authConstants.organizations) {
		console.error(
			'Organizations are disabled, but OrganizationSwitcher is being used. Please turn them on in auth.constants.ts'
		);
	}

	// Auth
	const auth = useAuth();
	const isLoading = $derived(auth.isLoading);
	const isAuthenticated = $derived(auth.isAuthenticated);

	// Queries - backend handles authentication, initialData prevents empty state during auth sync
	const organizationListResponse = useQuery(
		api.organizations.queries.listOrganizations,
		() => (auth.isAuthenticated ? {} : 'skip'),
		() => ({
			initialData: initialData?.organizationList
		})
	);
	const activeOrganizationResponse = useQuery(
		api.organizations.queries.getActiveOrganization,
		() => (auth.isAuthenticated ? {} : 'skip'),
		() => ({
			initialData: initialData?.activeOrganization
		})
	);
	const organizationList = $derived(organizationListResponse?.data);
	const activeOrganization = $derived(activeOrganizationResponse?.data);
	const roles = useRoles({}, () => ({
		initialData: initialData?.role
	}));
	const isOwnerOrAdmin = $derived(roles.hasOwnerOrAdminRole);

	// Component state
	let switcherPopoverOpen: boolean = $state(false);
	let createOrganizationDialogOpen: boolean = $state(false);

	// iOS back-swipe handling
	let isIOS: boolean = $state(false);

	// Back-swipe guard
	let guardTimer: ReturnType<typeof setTimeout> | null = null;
	let prevShouldBeOpen = false;

	// Handler functions

	function closeCreateOrganization(): void {
		createOrganizationDialogOpen = false;
	}
	function openCreateOrgModal(): void {
		createOrganizationDialogOpen = true;
		switcherPopoverOpen = false;
	}

	// 3: Open via button — push history entry + open immediately for snappy UX
	function openProfileModal() {
		switcherPopoverOpen = false;
		const url = new URL(page.url);
		if (url.searchParams.get('dialog') !== DIALOG_KEY) {
			url.searchParams.set('dialog', DIALOG_KEY);
			void goto(resolve(`${url.pathname}${url.search}${url.hash}` as Pathname), {
				replaceState: false,
				noScroll: true,
				keepFocus: true
			});
		}
	}

	// iOS Safari back-swipe guard only: do not mutate state here, only arm guard
	onMount(() => {
		// Detect iOS/iPadOS (including iPadOS 13+ which reports as Macintosh)
		const ua = navigator.userAgent;
		isIOS =
			/iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);

		const initialSlug = activeOrganization?.slug;
		if (initialSlug) {
			const pathname = page.url.pathname;
			if (/(?:^|\/)\b(active-organization|active-org)\b(?=\/|$)/.test(pathname)) {
				const newPathname = pathname.replace(
					/\/(active-organization|active-org)(?=\/|$)/g,
					`/${initialSlug}`
				);
				void goto(resolve(`${newPathname}${page.url.search}${page.url.hash}` as Pathname), {
					replaceState: true,
					noScroll: true,
					keepFocus: true
				});
			}
		}

		const onPopState = () => {
			if (!isIOS) return;
			// Only arm guard when the dialog is actually closing via history (not when switching tabs)
			const url = new URL(window.location.href);
			const shouldBeOpen = url.searchParams.get('dialog') === DIALOG_KEY;
			const closingCandidate = prevShouldBeOpen && !shouldBeOpen;
			if (closingCandidate) {
				if (guardTimer) clearTimeout(guardTimer);
				guardTimer = setTimeout(() => {
					guardTimer = null;
				}, 650);
			}
		};
		window.addEventListener('popstate', onPopState);
		return () => window.removeEventListener('popstate', onPopState);
	});

	$effect(() => {
		const slug = activeOrganization?.slug;
		const { pathname, search, hash } = page.url;
		if (slug && /(?:^|\/)(active-organization|active-org)(?=\/|$)/.test(pathname)) {
			const newPathname = pathname.replace(
				/\/(active-organization|active-org)(?=\/|$)/g,
				`/${slug}`
			);
			void goto(resolve(`${newPathname}${search}${hash}` as Pathname), {
				replaceState: true,
				noScroll: true,
				keepFocus: true
			});
		}
	});

	/**
	 * Updates the active organization and replaces URL slug if needed
	 */
	async function updateActiveOrg(organizationId?: string): Promise<void> {
		try {
			// Get current active organization slug before mutation
			const currentActiveOrgSlug = activeOrganization?.slug;
			const currentPathname = page.url.pathname;

			// Check if current URL contains the active organization slug
			const urlContainsCurrentSlug =
				currentActiveOrgSlug &&
				(currentPathname.includes(`/${currentActiveOrgSlug}/`) ||
					currentPathname.includes(`/${currentActiveOrgSlug}`));

			// Execute the mutation to set new active organization
			await client.mutation(api.organizations.mutations.setActiveOrganization, { organizationId });

			// Get the new active organization data
			const newActiveOrgSlug = activeOrganization?.slug;

			// If URL contained old slug and we have a new slug, replace it
			if (
				urlContainsCurrentSlug &&
				currentActiveOrgSlug &&
				newActiveOrgSlug &&
				currentActiveOrgSlug !== newActiveOrgSlug
			) {
				// Replace the old slug with the new slug in the URL
				const newPathname = currentPathname.replace(
					new RegExp(`/${currentActiveOrgSlug}(?=/|$)`, 'g'),
					`/${newActiveOrgSlug}`
				);

				// Navigate to the new URL
				await goto(resolve(newPathname as Pathname), { replaceState: true });
			} else {
				// No slug replacement needed, just refresh current page
				await goto(resolve((page.url.pathname + page.url.search) as Pathname), {
					replaceState: true
				});
			}

			// Close popover
			switcherPopoverOpen = false;
		} catch (err) {
			console.error('Error updating active organization:', err);
		}
	}

	// Check on mount if there is an active organization and if not, use the first organization from listOrganizations and call setActiveOrg (We use effect instead of useMount as organizations and activeOrganization are loaded async)
	$effect(() => {
		if (organizationList && organizationList.length > 0 && !activeOrganization) {
			updateActiveOrg();
		}
	});
</script>

{#if !authConstants.organizations}
	<!-- Gate 1: Organizations feature is disabled -->
	<div class="text-destructive">
		Organizations are disabled, but OrganizationSwitcher is being used. Please turn them on in
		auth.constants.ts
	</div>
{:else if !isAuthenticated}
	<!-- Gate 2: Not authenticated - don't show anything -->
	<!-- Return null by not rendering anything -->
{:else if (isLoading || (organizationListResponse?.isLoading ?? false) || (activeOrganizationResponse?.isLoading ?? false)) && !organizationList && !activeOrganization}
	<!-- Gate 3: Loading state - only show if queries are loading AND no data is available yet -->
	<div class="bg-muted h-8 w-40 animate-pulse rounded-md"></div>
{:else if organizationList && organizationList.length === 0}
	<!-- Gate 4: No organizations - show create organization modal -->
	<Dialog.Root bind:open={createOrganizationDialogOpen}>
		<Dialog.Trigger class={buttonVariants({ variant: 'secondary' }) + ' items-center gap-2'}>
			<PlusIcon class="size-4" />
			<span>Create Organization</span>
		</Dialog.Trigger>
		<Dialog.Content class="max-w-md">
			<CreateOrganization onSuccessfulCreate={closeCreateOrganization} />
			<Dialog.CloseX />
		</Dialog.Content>
	</Dialog.Root>
{:else if organizationList}
	<!-- Gate 5: Has organizations - show the switcher -->
	<Popover.Root bind:open={switcherPopoverOpen} positioning={{ placement: popoverPlacement }}>
		<Popover.Trigger
			class="border-border flex w-full flex-row items-center justify-between rounded-xl border p-1 pr-2 duration-200 ease-in-out"
		>
			<div class="flex w-full max-w-64 items-center gap-2 overflow-hidden sm:gap-3">
				<Avatar.Root class="size-8 shrink-0 rounded-xl">
					<Avatar.Image
						src={activeOrganization?.logo}
						alt={activeOrganization?.name}
						class="rounded-xl"
					/>
					<Avatar.Fallback class="rounded-xl">
						<Building2Icon class="size-5" />
					</Avatar.Fallback>
				</Avatar.Root>
				<span class="text-muted-foreground truncate text-sm">
					{activeOrganization?.name}
				</span>
			</div>
			<ChevronsUpDownIcon class="size-4 opacity-40" />
		</Popover.Trigger>
		<Popover.Content>
			<div class="flex flex-col gap-1">
				<div role="list" class="bg-card flex flex-col overflow-hidden rounded-xl">
					{#if isOwnerOrAdmin}
						<button
							onclick={openProfileModal}
							class="hover:bg-muted/50 text-muted-foreground flex h-14 w-full max-w-80 items-center gap-3 p-3 pr-5 text-left text-sm/6"
						>
							<Avatar.Root class="size-8 shrink-0 rounded-xl">
								<Avatar.Image
									src={activeOrganization?.logo}
									alt={activeOrganization?.name}
									class="rounded-xl"
								/>
								<Avatar.Fallback class="rounded-xl">
									<Building2Icon class="size-4" />
								</Avatar.Fallback>
							</Avatar.Root>
							<span class="text-muted-foreground w-full truncate text-sm font-medium">
								{activeOrganization?.name}
							</span>
							<SettingsIcon class="size-6" />
						</button>
					{:else}
						<div
							class="text-muted-foreground border-border flex max-w-80 items-center gap-3 border-t p-3 text-sm/6"
						>
							<Avatar.Root class="size-8 shrink-0 rounded-xl">
								<Avatar.Image
									src={activeOrganization?.logo}
									alt={activeOrganization?.name}
									class="rounded-xl"
								/>
								<Avatar.Fallback class="rounded-xl">
									<Building2Icon class="size-4" />
								</Avatar.Fallback>
							</Avatar.Root>
							<span class="text-muted-foreground w-full truncate font-medium">
								{activeOrganization?.name}
							</span>
							<LeaveOrganization variant="inline" />
						</div>
					{/if}

					{#each organizationList.filter((org) => org && org.id !== activeOrganization?.id) as org (org?.id)}
						<div>
							<button
								onclick={() => updateActiveOrg(org.id)}
								class="group hover:bg-muted/50 border-border flex w-full max-w-80 items-center gap-3 border-t p-3"
							>
								<Avatar.Root class="size-8 shrink-0 rounded-xl">
									<Avatar.Image src={org.logo} alt={org.name} class="rounded-xl" />
									<Avatar.Fallback class="rounded-xl">
										<Building2Icon class="size-4" />
									</Avatar.Fallback>
								</Avatar.Root>
								<span class="text-muted-foreground truncate text-sm">
									{org.name}
								</span>
							</button>
						</div>
					{/each}
				</div>
				<button
					onclick={openCreateOrgModal}
					class="hover:bg-accent flex h-12 w-full items-center justify-start gap-3 bg-transparent p-3"
				>
					<div
						class="bg-muted border-border flex size-8 shrink-0 items-center justify-center rounded-md border border-dashed"
					>
						<PlusIcon class="size-4" />
					</div>
					<span class="text-muted-foreground text-sm">Create Organization</span>
				</button>
			</div>
		</Popover.Content>
	</Popover.Root>

	<!-- Create Organization Modal -->
	<Dialog.Root bind:open={createOrganizationDialogOpen}>
		<Dialog.Content class="max-w-md">
			<Dialog.Header>
				<Dialog.Title>Create Organization</Dialog.Title>
			</Dialog.Header>
			<CreateOrganization onSuccessfulCreate={closeCreateOrganization} />
			<Dialog.CloseX />
		</Dialog.Content>
	</Dialog.Root>
{/if}
