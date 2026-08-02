import Root from './pagination.svelte';

export { type PaginationProps } from './pagination.svelte';

// The maths is exported too, not just the control: an owner that slices its own
// rows has to agree with the pager about how many pages there are, and it can
// only do that by calling the same functions.
export { clampPage, countPages, pageRange, paginationItems, type PaginationItem } from './utils';

export {
	Root,
	//
	Root as Pagination
};
