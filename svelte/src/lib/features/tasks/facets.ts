// ============================================================
// Turning facets into the options a filter offers
// ============================================================
// `listTaskFacets` answers "which values have rows behind them". Turning that
// into a dropdown is three rules, and they are here rather than inline in the
// bar because getting any of them wrong is silent:
//
//   1. Not answered yet is not the same as nothing. While the scan is in
//      flight every known value is offered — a control that emptied itself on
//      the way past would read as broken.
//   2. A SELECTED value never leaves its own dropdown, even with no rows behind
//      it. Otherwise the filter you have applied disappears from the control
//      that applied it, and you can neither see it nor clear it.
//   3. Anything left is a real, reachable choice — which is the whole point.
//
// PURE, like `filters.ts`: no Svelte, no Convex, no paraglide. Labels arrive as
// strings so the module can be unit-tested and so the same rules could serve a
// second surface without dragging the i18n runtime behind them.
// ============================================================

/** One entry in a Select. `value` is what the URL param will hold. */
export interface FilterOption {
	value: string;
	label: string;
}

/** The assignee half of `listTaskFacets`, structurally. */
export interface AssigneeFacets {
	users: { userId: string; name: string }[];
	contacts: { contactId: string; name: string }[];
	/** Whether anything in scope is on nobody, and whether anything is on the viewer. */
	unassigned: boolean;
	mine: boolean;
}

/** Everyone the org has, as `listAssignableMembers` returns them. */
export interface KnownMembers {
	users: { userId: string; name: string }[];
	contacts: { contactId: string; name: string; authUserId: string | null }[];
}

export interface AssigneeLabels {
	anyone: string;
	me: string;
	unassigned: string;
	/** For a selected id nothing can name — a departed member, a contact past the cap. */
	unknown: string;
}

/**
 * The values that occur, in the order they were given, plus the selected one if
 * it is not among them.
 *
 * `occurring` being undefined means the facet scan has not answered yet, so
 * nothing is narrowed. `all` is used only to NAME a rescued selection — never
 * as a source of options — which is what keeps a filter's list short while the
 * create-and-edit controls that share these lists stay complete.
 */
export function withSelected<T>(
	occurring: readonly T[] | undefined,
	all: readonly T[],
	key: (item: T) => string,
	selected: string | undefined
): readonly T[] {
	if (!occurring) return all;
	if (!selected || occurring.some((item) => key(item) === selected)) return occurring;
	const rescued = all.find((item) => key(item) === selected);
	return rescued ? [...occurring, rescued] : occurring;
}

/**
 * The assignee FILTER's options — deliberately not the assignee PICKER's.
 *
 * The picker has to offer everyone, because you cannot put a task on someone
 * who is not in the list. This one offers only people who currently have tasks
 * in scope, because every other name is a choice that selects into nothing.
 * `members` is here for rule 2 alone: naming a person the user has already
 * filtered on, not padding the list back out.
 */
export function assigneeFilterOptions(
	facets: AssigneeFacets | undefined,
	members: KnownMembers | undefined,
	selected: string,
	labels: AssigneeLabels
): FilterOption[] {
	const options: FilterOption[] = [{ value: '', label: labels.anyone }];

	if (!facets) {
		// Not answered yet: everyone, which is where this bar started.
		options.push({ value: 'me', label: labels.me });
		options.push({ value: 'unassigned', label: labels.unassigned });
		options.push(...memberOptions(members));
		return options;
	}

	// "Assigned to me" is a person like any other and is offered on the same
	// terms — with nothing of your own in scope it is a dead option.
	if (facets.mine || selected === 'me') options.push({ value: 'me', label: labels.me });
	if (facets.unassigned || selected === 'unassigned') {
		options.push({ value: 'unassigned', label: labels.unassigned });
	}

	for (const user of facets.users) options.push({ value: `user:${user.userId}`, label: user.name });
	for (const contact of facets.contacts) {
		options.push({ value: `contact:${contact.contactId}`, label: contact.name });
	}

	// Rule 2. A selected person with no rows left — their last task was closed,
	// or the status filter moved — keeps their place so the filter stays visible
	// and clearable. Unnameable ids get a word rather than a raw id.
	if (selected && !options.some((option) => option.value === selected)) {
		const known = memberOptions(members).find((option) => option.value === selected);
		options.push(known ?? { value: selected, label: labels.unknown });
	}

	return options;
}

/**
 * Everyone, as filter values. Contacts LINKED to a member are dropped: a linked
 * contact is the same person as that member, and offering both makes the choice
 * a coin flip about which id gets stored.
 */
function memberOptions(members: KnownMembers | undefined): FilterOption[] {
	return [
		...(members?.users ?? []).map((user) => ({
			value: `user:${user.userId}`,
			label: user.name
		})),
		...(members?.contacts ?? [])
			.filter((contact) => !contact.authUserId)
			.map((contact) => ({ value: `contact:${contact.contactId}`, label: contact.name }))
	];
}
