import { useQuery } from '@mmailaender/convex-svelte';
import { getAuthContext } from '$lib/auth/context.svelte';
import type { Id } from '$convex/_generated/dataModel';
import { targetCentsFor } from './format';

/**
 * Raised and target for one project. Both live on the server — the component
 * never adds cents together itself.
 */
export function useProjectMoney(getProjectId: () => Id<'projects'> | null) {
	const { api } = getAuthContext();

	const budgetResponse = useQuery(api.budgets.queries.getBudgetForProject, () => {
		const projectId = getProjectId();
		return projectId ? { projectId } : 'skip';
	});

	const raisedResponse = useQuery(api.allocations.queries.getRaisedForProject, () => {
		const projectId = getProjectId();
		return projectId ? { projectId } : 'skip';
	});

	return {
		get isLoading() {
			return budgetResponse.isLoading || raisedResponse.isLoading;
		},
		get budget() {
			return budgetResponse.data ?? null;
		},
		get targetCents() {
			return targetCentsFor(budgetResponse.data ?? null);
		},
		get raisedCents() {
			return raisedResponse.data ?? 0;
		}
	};
}
