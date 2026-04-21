<script lang="ts">
	import type { Node as ParagraphNode, AssistantCitation } from '$lib/types/document';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';

	type ModelOption = {
		value: string;
		label: string;
	};

	export let selectedParagraph: ParagraphNode | null = null;
	export let model = 'gpt-5-mini';
	export let modelOptions: ReadonlyArray<ModelOption> = [];
	export let loading = false;
	export let error: string | null = null;
	export let explanation = '';
	export let citations: AssistantCitation[] = [];
	export let onRunExplanation: () => void | Promise<void> = () => {};
	export let onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void = () => {};
</script>

<section class="flex min-h-0 flex-1 flex-col">
	<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
		<p class="text-[11px] text-gray-500">
			Get a detailed and plain-language explanation of the selected paragraph and its related context.
		</p>
	</header>

	<div class="border-b border-gray-100 bg-white px-3 py-2.5">
		<div class="flex items-center gap-2">
			<Select.Root type="single" bind:value={model} disabled={loading}>
				<Select.Trigger
					size="sm"
					class="h-7 w-[150px] border-gray-200 bg-white px-1.5 text-[10px] text-gray-600"
					title="Paragraph explanation model"
				>
					{modelOptions.find((option) => option.value === model)?.label ?? model}
				</Select.Trigger>
				<Select.Content>
					{#each modelOptions as option}
						<Select.Item value={option.value} label={option.label} class="text-[10px]">
							{option.label}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Button
				variant="outline"
				size="sm"
				class="h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
				disabled={!selectedParagraph || loading}
				onclick={() => void onRunExplanation()}
			>
				Explain paragraph
			</Button>
		</div>
		{#if selectedParagraph}
			<p class="mt-1.5 text-[10px] text-gray-500">
				Selected: {selectedParagraph.id} · Page {selectedParagraph.page}
			</p>
		{:else}
			<p class="mt-1.5 text-[10px] text-gray-400">Select a paragraph in the document.</p>
		{/if}
	</div>

	<ScrollArea class="min-h-0 flex-1 bg-gray-50/30">
		<div class="space-y-2 p-3">
			{#if loading}
				<div class="rounded border border-blue-200 bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
					Generating paragraph explanation...
				</div>
			{/if}
			{#if error}
				<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</div>
			{/if}
			{#if explanation}
				<div class="rounded border border-gray-200 bg-white px-3 py-2">
					<p class="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700">{explanation}</p>
				</div>
			{/if}
			{#if citations.length > 0}
				<div class="rounded border border-gray-200 bg-white px-3 py-2">
					<p class="mb-1 text-[10px] font-semibold text-gray-600">Citations</p>
					<div class="flex flex-wrap gap-1">
						{#each citations as citation}
							<button
								type="button"
								class="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[9px] text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
								onclick={() => onFocusNodeFromPanel(citation.id, true)}
							>
								{citation.id}
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</ScrollArea>
</section>
