<script lang="ts">
	let { text }: { text: string } = $props();

	// Story text is admin-entered plain text, not markdown, so paragraphs
	// are just blank-line-separated blocks — no markdown renderer needed.
	const paragraphs = $derived(
		text
			.split(/\n{2,}/)
			.map((paragraph) => paragraph.trim())
			.filter((paragraph) => paragraph.length > 0)
	);
</script>

<div class="ps-serif text-foreground/90 space-y-4 text-lg leading-relaxed">
	{#each paragraphs as paragraph, index (index)}
		<p>{paragraph}</p>
	{/each}
</div>
