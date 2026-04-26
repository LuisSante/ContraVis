<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import type {
		Node as ParagraphNode,
		ParagraphEditState,
		RelatedParagraph
	} from '$lib/types/document';
	import { formatReferenceSummary, getNodeCurrentText, truncateText } from '$lib/utils/edit';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';

	type ProcessingStep = {
		label: string;
		active: boolean;
	};

	export let selectedParagraph: ParagraphNode | null = null;
	export let backendGraphLoading = false;
	export let relatedProcessingSteps: ProcessingStep[] = [];
	export let selectedRelatedParagraphs: RelatedParagraph[] = [];
	export let nodeEditStateById: Map<string, ParagraphEditState> = new Map();
	export let onFocusNodeFromPanel: (nodeId: string) => void = () => {};

	let processingTick = 0;
	let processingTimer: ReturnType<typeof setInterval> | null = null;
	$: activeProcessingStepIndex =
		relatedProcessingSteps.length > 0 ? Math.floor(processingTick / 3) % relatedProcessingSteps.length : 0;
	$: activeDotCount = (processingTick % 3) + 1;

	$: {
		if (browser && backendGraphLoading && processingTimer == null) {
			processingTimer = setInterval(() => {
				processingTick += 1;
			}, 260);
		}
		if (!backendGraphLoading && processingTimer != null) {
			clearInterval(processingTimer);
			processingTimer = null;
			processingTick = 0;
		}
	}

	onDestroy(() => {
		if (processingTimer != null) {
			clearInterval(processingTimer);
			processingTimer = null;
		}
	});

	function hasSemanticRelation(related: RelatedParagraph): boolean {
		return (
			related.relationTypes.includes('semantic_similarity') ||
			related.relationTypes.includes('similarity' as never) ||
			typeof related.semanticScore === 'number'
		);
	}

	function hasReferenceRelation(related: RelatedParagraph): boolean {
		return (
			related.relationTypes.includes('reference') ||
			related.relationTypes.some((relationType) =>
				String(relationType).toLowerCase().includes('reference')
			) ||
			related.references.length > 0
		);
	}
</script>

<section class="flex min-h-0 flex-1 flex-col">
	<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
		<p class="text-[11px] text-gray-500">
			View linked paragraphs, relation types, and semantic similarity context.
		</p>
	</header>

	<ScrollArea class="min-h-0 flex-1 bg-gray-50/30">
		<div class="flex min-h-full flex-col space-y-2 p-2">
			<!-- {#if selectedParagraph}
				<p class="px-1 text-[10px] text-gray-500">
					Selected: {selectedParagraph.id} &middot; Page {selectedParagraph.page}
				</p>
			{/if} -->

			{#if backendGraphLoading}
				<div class="rounded-xl border border-gray-200 bg-gray-50/90 p-3 text-[11px] text-gray-700">
					<p class="mb-2 text-[10px] font-semibold text-gray-500">Processing panel</p>
					<ul class="space-y-1.5 text-[12px] text-gray-600">
						{#each relatedProcessingSteps as step, index}
							<li
								class={`relative flex items-center gap-2 transition-opacity duration-300 ${
									index === activeProcessingStepIndex ? 'opacity-100' : 'opacity-40'
								}`}
							>
								{#if index < relatedProcessingSteps.length - 1}
									<span
										class="absolute top-[13px] left-[3px] h-[18px] w-px bg-gray-300/80"
										aria-hidden="true"
									></span>
								{/if}
								<span
									class={`h-1.5 w-1.5 rounded-full bg-gray-500 transition-opacity duration-300 ${
										index === activeProcessingStepIndex
											? 'animate-pulse opacity-95'
											: 'opacity-30'
									}`}
									aria-hidden="true"
								></span>
								<span class="text-gray-600">
									{step.label}
									<span class="ml-px inline-flex min-w-[14px] text-gray-500" aria-hidden="true">
										{#if index === activeProcessingStepIndex}
											{activeDotCount >= 1 ? '.' : ''}{activeDotCount >= 2 ? '.' : ''}{activeDotCount >= 3 ? '.' : ''}
										{/if}
									</span>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{:else if !selectedParagraph}
				<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
					<p class="text-[10px] font-medium">Select a paragraph to see its related paragraphs.</p>
					<p class="mt-1 text-[10px] text-gray-400">
						Choose a paragraph in the document on the left.
					</p>
				</div>
			{:else if selectedRelatedParagraphs.length === 0}
				<div class="flex flex-1 flex-col items-center justify-center py-12 text-gray-300">
					<p class="text-[10px] italic">No relations found for this element</p>
				</div>
			{:else}
				{#each selectedRelatedParagraphs as related}
					<button
						type="button"
						class="group rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
						on:click={() => onFocusNodeFromPanel(related.node.id)}
					>
						<div class="mb-2 flex items-center justify-between">
							<div class="flex flex-wrap items-center gap-1.5">
								{#if hasSemanticRelation(related)}
									<Badge
										variant="outline"
										class="h-4 border-green-100 bg-green-50 px-2 text-[9px] font-semibold text-green-600"
									>
										Similarity
									</Badge>
								{/if}
								{#if hasReferenceRelation(related)}
									<Badge
										variant="outline"
										class="h-4 border-blue-100 bg-blue-50 px-1.5 text-[9px] font-semibold text-blue-600"
									>
										Reference
									</Badge>
								{/if}
								{#if related.semanticScore != null}
									<span
										class={`text-[10px] font-semibold ${
											hasSemanticRelation(related) ? 'text-green-600' : 'text-gray-500'
										}`}
									>
										{(related.semanticScore * 100).toFixed(1)}%
									</span>
								{/if}
							</div>
							<span class="text-[9px] font-semibold tracking-tight text-gray-400">
								Page {related.node.page}
							</span>
						</div>

						<p class="text-[11px] leading-relaxed text-gray-600">
							{truncateText(getNodeCurrentText(nodeEditStateById, related.node))}
						</p>

						{#if related.references.length}
							<p class="mt-2 text-[10px] text-gray-500">
								Refs: {formatReferenceSummary(related.references)}
							</p>
						{/if}
					</button>
				{/each}
			{/if}
		</div>
	</ScrollArea>
</section>
