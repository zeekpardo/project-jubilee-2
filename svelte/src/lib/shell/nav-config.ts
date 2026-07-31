import type { Component } from 'svelte';
import type { Pathname } from '$app/types';
import type { Capability } from '$lib/domain/permissions';

import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import Users from '@lucide/svelte/icons/users';
import Contact from '@lucide/svelte/icons/contact';
import Home from '@lucide/svelte/icons/home';
import Wallet from '@lucide/svelte/icons/wallet';
import Megaphone from '@lucide/svelte/icons/megaphone';
import UserCog from '@lucide/svelte/icons/user-cog';
import Settings from '@lucide/svelte/icons/settings';
import Building2 from '@lucide/svelte/icons/building-2';

export type NavItem = {
	key: string;
	href: Pathname;
	icon: Component;
	/** The capability that reveals this item. */
	capability: Capability;
	/**
	 * Label comes from the active campaign's own vocabulary rather than the
	 * message catalogue, so a campaign calling its projects "Families" says so
	 * in the nav.
	 */
	usesObjectLabel?: boolean;
};

export type NavSection = {
	key: string;
	items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
	{
		key: 'overview',
		items: [
			{
				key: 'dashboard',
				href: '/app',
				icon: LayoutDashboard,
				capability: 'projects:read'
			},
			{
				key: 'projects',
				href: '/app/projects',
				icon: Users,
				capability: 'projects:read',
				usesObjectLabel: true
			},
			{
				key: 'money',
				href: '/app/money',
				icon: Wallet,
				capability: 'money:read'
			},
			{
				key: 'contacts',
				href: '/app/contacts',
				icon: Contact,
				capability: 'contacts:read'
			},
			{
				key: 'households',
				href: '/app/households',
				icon: Home,
				capability: 'contacts:read'
			}
		]
	},
	{
		key: 'admin',
		items: [
			{
				key: 'campaigns',
				href: '/app/campaigns',
				icon: Megaphone,
				capability: 'campaign:create'
			},
			{
				key: 'members',
				href: '/app/members',
				icon: UserCog,
				capability: 'members:manage'
			},
			{
				key: 'settings',
				href: '/app/settings',
				icon: Settings,
				capability: 'settings:manage'
			},
			{
				key: 'organization',
				href: '/app/organization',
				icon: Building2,
				capability: 'org:manage'
			}
		]
	}
];
