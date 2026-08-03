<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	import { Portal } from '@ark-ui/svelte';
	import * as Menu from '$lib/primitives/ui/menu';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Avatar from '$lib/primitives/ui/avatar';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { cn } from '$lib/primitives/utils';
	import * as m from '$lib/i18n/messages';

	import { MODES, THEMES, type Mode, type Theme } from '$lib/theme/config';
	import { themeState } from '$lib/theme/state.svelte';

	import CreateOrganization from '$lib/organizations/ui/CreateOrganization.svelte';
	import { useRoles } from '$lib/organizations/api/roles.svelte';
	import { DIALOG_KEY as USER_DIALOG_KEY } from '$lib/users/utils/user.constants';
	import { DIALOG_KEY as ORG_DIALOG_KEY } from '$lib/organizations/utils/organization.constants';

	import { useConvexClient, useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import Building2Icon from '@lucide/svelte/icons/building-2';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import PaletteIcon from '@lucide/svelte/icons/palette';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import SunIcon from '@lucide/svelte/icons/sun';
	import UserRoundIcon from '@lucide/svelte/icons/user-round';

	import type { Pathname } from '$app/types';
	import type {
		GetActiveOrganizationType,
		GetActiveUserType,
		ListOrganizationsType,
		Role
	} from '$lib/auth/types';

	let {
		class: className,
		collapsed = false,
		initialData
	}: {
		class?: string;
		/** On the icon rail only the avatar survives; the label and chevron fade out. */
		collapsed?: boolean;
		initialData?: {
			activeUser?: GetActiveUserType;
			organizationList?: ListOrganizationsType;
			activeOrganization?: GetActiveOrganizationType;
			role?: Role;
		};
	} = $props();

	const { api, authClient, authConstants } = getAuthContext();
	const client = useConvexClient();
	const auth = useAuth();

	const orgsEnabled = authConstants.organizations;

	// Queries — the backend authenticates; `initialData` keeps the footer from
	// flashing empty while the client session syncs.
	const activeUserResponse = useQuery(
		api.users.queries.getActiveUser,
		() => (auth.isAuthenticated ? {} : 'skip'),
		() => ({ initialData: initialData?.activeUser })
	);
	const activeUser = $derived(activeUserResponse?.data);

	const organizationListResponse = useQuery(
		api.organizations.queries.listOrganizations,
		() => (auth.isAuthenticated && orgsEnabled ? {} : 'skip'),
		() => ({ initialData: initialData?.organizationList })
	);
	const activeOrganizationResponse = useQuery(
		api.organizations.queries.getActiveOrganization,
		() => (auth.isAuthenticated && orgsEnabled ? {} : 'skip'),
		() => ({ initialData: initialData?.activeOrganization })
	);
	const organizationList = $derived(organizationListResponse?.data);
	const activeOrganization = $derived(activeOrganizationResponse?.data);

	const roles = useRoles({}, () => ({ initialData: initialData?.role }));
	const isOwnerOrAdmin = $derived(roles.hasOwnerOrAdminRole);

	const displayName = $derived(activeUser?.name ?? '');
	const email = $derived(activeUser?.email ?? '');

	const modeIcons = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };
	const modeLabels = $derived<Record<Mode, string>>({
		light: m.theme_mode_light(),
		dark: m.theme_mode_dark(),
		system: m.theme_mode_system()
	});

	let createOrganizationOpen = $state(false);

	/**
	 * Both profile editors are hosted in the `/app` layout and keyed off
	 * `?dialog=`. They used to sit in the ROOT layout, which put an account
	 * dialog — linked accounts, API keys, delete account — into the DOM of every
	 * public donor page. A donor's identity here is their contact row; the Better
	 * Auth account is credentials, and not something to hand them a panel for.
	 *
	 * A host only has to be mounted on the same page as its opener, since the
	 * search param is the whole channel. Every opener is under `/app`, so nothing
	 * was stranded by the move.
	 */
	function openHostedDialog(key: string): void {
		const url = new URL(page.url);
		if (url.searchParams.get('dialog') === key) return;
		url.searchParams.set('dialog', key);
		void goto(resolve(`${url.pathname}${url.search}${url.hash}` as Pathname), {
			replaceState: false,
			noScroll: true,
			keepFocus: true
		});
	}

	/**
	 * Sets the active organization, then re-runs the current load so every query
	 * scoped to the organization refetches.
	 */
	async function selectOrganization(organizationId?: string): Promise<void> {
		try {
			await client.mutation(api.organizations.mutations.setActiveOrganization, { organizationId });
			await goto(resolve((page.url.pathname + page.url.search) as Pathname), {
				replaceState: true
			});
		} catch (err) {
			console.error('Error updating active organization:', err);
		}
	}

	async function signOut(): Promise<void> {
		const result = await authClient.signOut();
		if (result.data?.success) void invalidateAll();
	}

	// Someone who belongs to an organization but has none active would otherwise
	// see an empty workspace, so the first one is adopted automatically.
	$effect(() => {
		if (orgsEnabled && organizationList && organizationList.length > 0 && !activeOrganization) {
			void selectOrganization();
		}
	});
</script>

{#snippet identity(size: string)}
	<Avatar.Root class={cn('shrink-0 rounded-lg', size)}>
		<Avatar.Image src={activeUser?.image} alt={displayName} class="rounded-lg" />
		<Avatar.Fallback class="rounded-lg">
			<Avatar.Marble name={displayName} />
		</Avatar.Fallback>
	</Avatar.Root>
{/snippet}

{#if activeUser}
	<!-- Opens upward: the trigger is pinned to the bottom of the sidebar, so the
	     menu stacks directly above it rather than beside it. -->
	<Menu.Root positioning={{ placement: 'top-start', gutter: 4 }}>
		<Menu.Trigger
			class={cn(
				'ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground flex h-12 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden focus-visible:ring-2',
				collapsed && 'justify-center gap-0 p-0',
				className
			)}
			aria-label={displayName}
		>
			{@render identity('size-8')}
			<span
				class={cn(
					'grid flex-1 text-left text-sm leading-tight transition-all duration-200 ease-in-out',
					collapsed
						? 'invisible max-w-0 overflow-hidden opacity-0'
						: 'visible max-w-full opacity-100'
				)}
			>
				<span class="truncate font-medium">{displayName}</span>
				<span class="text-muted-foreground truncate text-xs">{email}</span>
			</span>
			<ChevronsUpDownIcon
				class={cn(
					'ml-auto size-4 shrink-0 transition-all duration-200 ease-in-out',
					collapsed
						? 'invisible max-w-0 overflow-hidden opacity-0'
						: 'visible max-w-full opacity-100'
				)}
			/>
		</Menu.Trigger>

		<Portal>
			<Menu.Content class="w-(--reference-width) min-w-56 rounded-lg">
				<Menu.Label class="p-0 font-normal">
					<div class="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
						{@render identity('size-8')}
						<div class="grid flex-1 text-left text-sm leading-tight">
							<span class="truncate font-medium">{displayName}</span>
							<span class="text-muted-foreground truncate text-xs">{email}</span>
						</div>
					</div>
				</Menu.Label>

				<Menu.Separator />

				{#if orgsEnabled}
					<Menu.Root positioning={{ placement: 'right-start', gutter: 4 }}>
						<Menu.TriggerItem>
							<Building2Icon />
							<span class="truncate">
								{activeOrganization?.name ?? m.nav_organization()}
							</span>
						</Menu.TriggerItem>
						<Menu.Content class="min-w-56 rounded-lg">
							<Menu.ItemGroup>
								{#each organizationList ?? [] as organization (organization.id)}
									<Menu.Item
										value={organization.id}
										class="gap-2"
										onSelect={() => {
											if (organization.id !== activeOrganization?.id) {
												void selectOrganization(organization.id);
											}
										}}
									>
										<Building2Icon />
										<span class="flex-1 truncate">{organization.name}</span>
										{#if organization.id === activeOrganization?.id}
											<CheckIcon class="ml-auto size-4" />
										{/if}
									</Menu.Item>
								{/each}
							</Menu.ItemGroup>

							<Menu.Separator />

							{#if isOwnerOrAdmin && activeOrganization}
								<Menu.Item
									value="__organization-settings"
									class="gap-2"
									onSelect={() => openHostedDialog(ORG_DIALOG_KEY)}
								>
									<SettingsIcon />
									<span>{m.shell_organizationSettings()}</span>
								</Menu.Item>
							{/if}
							<Menu.Item
								value="__organization-create"
								class="gap-2"
								onSelect={() => (createOrganizationOpen = true)}
							>
								<PlusIcon />
								<span>{m.shell_createOrganization()}</span>
							</Menu.Item>
						</Menu.Content>
					</Menu.Root>

					<Menu.Separator />
				{/if}

				<Menu.Root positioning={{ placement: 'right-start', gutter: 4 }}>
					<Menu.TriggerItem>
						<PaletteIcon />
						<span>{m.theme_label()}</span>
					</Menu.TriggerItem>
					<Menu.Content class="min-w-40 rounded-lg">
						<Menu.RadioGroup
							value={themeState.theme}
							onValueChange={(details: { value: string }) =>
								themeState.setTheme(details.value as Theme)}
						>
							{#each THEMES as option (option.value)}
								<Menu.RadioItem value={option.value} class="gap-2 pl-2">
									<span class="flex-1 truncate">{option.label}</span>
									{#if themeState.theme === option.value}
										<CheckIcon class="ml-auto size-4" />
									{/if}
								</Menu.RadioItem>
							{/each}
						</Menu.RadioGroup>
					</Menu.Content>
				</Menu.Root>

				<Menu.Root positioning={{ placement: 'right-start', gutter: 4 }}>
					<Menu.TriggerItem>
						<SunIcon />
						<span>{m.theme_modeLabel()}</span>
					</Menu.TriggerItem>
					<Menu.Content class="min-w-40 rounded-lg">
						<Menu.RadioGroup
							value={themeState.mode}
							onValueChange={(details: { value: string }) =>
								themeState.setMode(details.value as Mode)}
						>
							{#each MODES as value (value)}
								{@const Icon = modeIcons[value]}
								<Menu.RadioItem {value} class="gap-2 pl-2">
									<Icon />
									<span class="flex-1 truncate">{modeLabels[value]}</span>
									{#if themeState.mode === value}
										<CheckIcon class="ml-auto size-4" />
									{/if}
								</Menu.RadioItem>
							{/each}
						</Menu.RadioGroup>
					</Menu.Content>
				</Menu.Root>

				<Menu.Separator />

				<Menu.Item
					value="__account"
					class="gap-2"
					onSelect={() => openHostedDialog(USER_DIALOG_KEY)}
				>
					<UserRoundIcon />
					<span>{m.shell_account()}</span>
				</Menu.Item>
				<Menu.Item value="__sign-out" class="gap-2" onSelect={() => void signOut()}>
					<LogOutIcon />
					<span>{m.shell_signOut()}</span>
				</Menu.Item>
			</Menu.Content>
		</Portal>
	</Menu.Root>

	{#if orgsEnabled}
		<Dialog.Root bind:open={createOrganizationOpen}>
			<Dialog.Content class="max-w-md">
				<Dialog.Header>
					<Dialog.Title>{m.shell_createOrganization()}</Dialog.Title>
				</Dialog.Header>
				<CreateOrganization onSuccessfulCreate={() => (createOrganizationOpen = false)} />
				<Dialog.CloseX />
			</Dialog.Content>
		</Dialog.Root>
	{/if}
{:else}
	<div class={cn('flex h-12 w-full items-center gap-2 p-2', collapsed && 'justify-center p-0')}>
		<Skeleton class="size-8 shrink-0 rounded-lg" />
		{#if !collapsed}
			<Skeleton class="h-4 flex-1" />
		{/if}
	</div>
{/if}
