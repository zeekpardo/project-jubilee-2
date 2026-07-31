<script lang="ts">
	import Cropper from 'svelte-easy-crop';
	import { useImageCropperCropper } from './image-cropper.svelte.js';
	import type { ImageCropperCropperProps } from './types.js';

	let {
		cropShape = 'round',
		aspect = 1,
		showGrid = false,
		...rest
	}: ImageCropperCropperProps = $props();

	const cropperState = useImageCropperCropper();
</script>

<!-- This needs to be relative https://github.com/ValentinH/svelte-easy-crop#basic-usage -->
<div class="flex min-h-0 w-full flex-1 items-center justify-center">
	<div
		class="ring-border bg-muted relative aspect-square w-full max-w-md overflow-hidden rounded-lg ring-1"
	>
		<Cropper
			{...rest}
			{cropShape}
			{aspect}
			{showGrid}
			image={cropperState.rootState.tempUrl}
			oncropcomplete={cropperState.onCropComplete}
		/>
	</div>
</div>
