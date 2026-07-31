import Root from './alert.svelte';
import Title from './alert-title.svelte';
import Description from './alert-description.svelte';

export {
	alertVariants,
	type AlertProps,
	type AlertVariant,
	type AlertVariants
} from './alert.svelte';

export {
	Root,
	Title,
	Description,
	//
	Root as Alert,
	Title as AlertTitle,
	Description as AlertDescription
};
