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
import Globe from '@lucide/svelte/icons/globe';
import ListChecks from '@lucide/svelte/icons/list-checks';

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

/**
 * Two separate menus rather than two sections of one. Admin is a mode you
 * enter from the campaign switcher, so the campaign workspace stays free of
 * org-wide entries and vice versa.
 */
export const CAMPAIGN_NAV: NavItem[] = [
	{ key: 'dashboard', href: '/app', icon: LayoutDashboard, capability: 'projects:read' },
	{
		key: 'projects',
		href: '/app/projects',
		icon: Users,
		capability: 'projects:read',
		usesObjectLabel: true
	},
	{ key: 'tasks', href: '/app/tasks', icon: ListChecks, capability: 'projects:read' },
	{ key: 'campaignContacts', href: '/app/contacts', icon: Contact, capability: 'contacts:read' },
	{ key: 'budget', href: '/app/budget', icon: Wallet, capability: 'money:read' },
	// Campaign settings, so campaign:edit rather than settings:manage — a
	// campaign manager configures their own campaign without being let near the
	// org's custom fields, which the page hides behind settings:manage.
	{ key: 'settings', href: '/app/settings', icon: Settings, capability: 'campaign:edit' }
];

export const ADMIN_NAV: NavItem[] = [
	{
		key: 'campaigns',
		href: '/app/admin/campaigns',
		icon: Megaphone,
		capability: 'campaign:create'
	},
	{ key: 'adminTasks', href: '/app/admin/tasks', icon: ListChecks, capability: 'projects:read' },
	{ key: 'members', href: '/app/admin/members', icon: UserCog, capability: 'members:manage' },
	{ key: 'contacts', href: '/app/admin/contacts', icon: Contact, capability: 'contacts:read' },
	{ key: 'households', href: '/app/admin/households', icon: Home, capability: 'contacts:read' },
	{
		key: 'organization',
		href: '/app/admin/organization',
		icon: Building2,
		capability: 'org:manage'
	},
	{
		key: 'publicSite',
		href: '/app/admin/public-site',
		icon: Globe,
		capability: 'org:manage'
	}
];

export const ADMIN_ROOT = '/app/admin';

export function isAdminPath(pathname: string): boolean {
	return pathname === ADMIN_ROOT || pathname.startsWith(`${ADMIN_ROOT}/`);
}
