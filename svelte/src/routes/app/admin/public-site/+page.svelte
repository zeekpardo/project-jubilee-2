<script lang="ts">
	// Shell
	import PageContainer from '$lib/shell/PageContainer.svelte';
	// Access
	import { getAccessContext } from '$lib/access';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	// Feature
	import PublicIdentityCard from '$lib/features/public-site-admin/PublicIdentityCard.svelte';
	import SiteAddressCard from '$lib/features/public-site-admin/SiteAddressCard.svelte';
	import ThemeCard from '$lib/features/public-site-admin/ThemeCard.svelte';
	import StatSectionsCard from '$lib/features/public-site-admin/StatSectionsCard.svelte';
	import PrivacyPolicyCard from '$lib/features/public-site-admin/PrivacyPolicyCard.svelte';
	import CustomDomainsCard from '$lib/features/public-site-admin/CustomDomainsCard.svelte';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	// org:manage is owner-only, matching the /app/admin/organization gate this
	// screen's nav entry sits beside.
	const allowed = $derived(access.can('org:manage'));

	const settingsResponse = useQuery(api.orgSettings.queries.getOrgSettings, () =>
		auth.isAuthenticated && allowed ? {} : 'skip'
	);
	const settings = $derived(settingsResponse.data ?? null);
</script>

<PageContainer
	title={m.publicSiteSettings_title()}
	description={m.publicSiteSettings_subtitle()}
	access={allowed}
	loading={settingsResponse.isLoading}
>
	<PublicIdentityCard {settings} canWrite={allowed} />
	<SiteAddressCard {settings} canWrite={allowed} />
	<ThemeCard {settings} canWrite={allowed} />
	<StatSectionsCard {settings} canWrite={allowed} />
	<PrivacyPolicyCard {settings} canWrite={allowed} />
	<CustomDomainsCard />
</PageContainer>
