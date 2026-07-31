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
	{ key: 'campaignContacts', href: '/app/contacts', icon: Contact, capability: 'contacts:read' },
	{ key: 'budget', href: '/app/budget', icon: Wallet, capability: 'money:read' },
	{ key: 'settings', href: '/app/settings', icon: Settings, capability: 'settings:manage' }
];

export const ADMIN_NAV: NavItem[] = [
	{
		key: 'campaigns',
		href: '/app/admin/campaigns',
		icon: Megaphone,
		capability: 'campaign:create'
	},
	{ key: 'members', href: '/app/admin/members', icon: UserCog, capability: 'members:manage' },
	{ key: 'contacts', href: '/app/admin/contacts', icon: Contact, capability: 'contacts:read' },
	{ key: 'households', href: '/app/admin/households', icon: Home, capability: 'contacts:read' },
	{
		key: 'organization',
		href: '/app/admin/organization',
		icon: Building2,
		capability: 'org:manage'
	}
];

export const ADMIN_ROOT = '/app/admin';

export function isAdminPath(pathname: string): boolean {
	return pathname === ADMIN_ROOT || pathname.startsWith(`${ADMIN_ROOT}/`);
}
