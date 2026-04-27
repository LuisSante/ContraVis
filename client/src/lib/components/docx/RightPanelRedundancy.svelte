<script lang="ts">
	import type { Node as ParagraphNode } from '$lib/types/document';
	import * as Card from '$lib/components/ui/card/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';

	export let selectedParagraph: ParagraphNode | null = null;
</script>

<section class="flex min-h-0 flex-1 flex-col">
	<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
		<p class="text-[11px] text-gray-500">
			Inspect repetitive statements and overlapping ideas in the selected paragraph.
		</p>
	</header>
	<ScrollArea class="min-h-0 flex-1">
		<div class="p-3">
			{#if !selectedParagraph}
				<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
					<p class="text-[10px] font-medium">Select a paragraph to analyze redundancies</p>
				</div>
			{:else}
				<Card.Root size="sm" class="border-gray-200 bg-gray-50 py-0 text-[11px]">
					<Card.Content class="px-3 py-2 text-gray-600">
						Redundancy analysis UI is ready. Backend processing will be connected in a future
						step.
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	</ScrollArea>
</section>
