import { Tooltip as TooltipPrimitive } from '@ark-ui/svelte/tooltip';

import Root from './tooltip-root.svelte';
import Trigger from './tooltip-trigger.svelte';
import Content from './tooltip-content.svelte';

const Positioner = TooltipPrimitive.Positioner;
const Arrow = TooltipPrimitive.Arrow;
const ArrowTip = TooltipPrimitive.ArrowTip;

export {
	Root,
	Trigger,
	Content,
	Positioner,
	Arrow,
	ArrowTip,
	//
	Root as Tooltip,
	Trigger as TooltipTrigger,
	Content as TooltipContent,
	Positioner as TooltipPositioner,
	Arrow as TooltipArrow,
	ArrowTip as TooltipArrowTip
};
