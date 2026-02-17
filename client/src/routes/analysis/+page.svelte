<script lang="ts">
	import { paragraphs, selectedParagraph, currentDocument } from '$lib/stores/document';
	import type { Paragraph } from '$lib/types/document';
	import { api } from '$lib/api/client';

	const PAGE_WIDTH = 595;
	const PAGE_HEIGHT = 842;
</script>

<div class="flex h-screen w-full flex-row gap-4 p-4">
	<div class="w-1/2 overflow-auto">
		<h3 class="mb-2 font-bold">Texto Formateado (Literal):</h3>
		<div class="flex flex-col gap-2">
			{#each $paragraphs as paragraph}
				<div class="border-b bg-white p-2 last:border-none">
					<small class="text-gray-400">ID: {paragraph.id}</small>
					<div
						class="rounded border bg-gray-50 p-2 font-mono text-sm break-words whitespace-pre-wrap"
					>
						{paragraph.text}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<div class="w-1/2 overflow-auto">
		<h3 class="mb-2 font-bold">JSON Raw:</h3>
		<div class="rounded border bg-gray-50 p-4 font-mono text-xs">
			<pre>{JSON.stringify($paragraphs, null, 2)}</pre>
		</div>
	</div>
</div>
