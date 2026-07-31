import { Checkbox as CheckboxPrimitive } from '@ark-ui/svelte/checkbox';

import Root from './checkbox.svelte';

const Group = CheckboxPrimitive.Group;

export type { CheckboxCheckedState, CheckboxCheckedChangeDetails } from '@ark-ui/svelte/checkbox';

export {
	Root,
	Group,
	//
	Root as Checkbox,
	Group as CheckboxGroup
};
