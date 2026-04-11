<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import type { ContradictionParagraphResult, Node as ParagraphNode } from '$lib/types/document';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';

	type ProcessingStep = {
		label: string;
		active: boolean;
	};

	export let selectedParagraph: ParagraphNode | null = null;
	export let contradictionLoading = false;
	export let revisionProcessingSteps: ProcessingStep[] = [];
	export let selectedContradictionResult: ContradictionParagraphResult | null = null;
	export let selectedContradictionEvidence: ContradictionParagraphResult['evidence'] = null;
	export let onFocusEvidenceSnippet: (paragraphId: string, role: 'a' | 'b') => void = () => {};

	let processingTick = 0;
	let processingTimer: ReturnType<typeof setInterval> | null = null;
	$: activeProcessingStepIndex =
		revisionProcessingSteps.length > 0 ? Math.floor(processingTick / 3) % revisionProcessingSteps.length : 0;
	$: activeDotCount = (processingTick % 3) + 1;

	$: {
		if (browser && contradictionLoading && processingTimer == null) {
			processingTimer = setInterval(() => {
				processingTick += 1;
			}, 260);
		}
		if (!contradictionLoading && processingTimer != null) {
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
</script>

<section class="flex min-h-0 flex-1 flex-col">
	<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
		<p class="text-[11px] text-gray-500">
			Inspect contradictions, confidence, and evidence for the selected paragraph.
		</p>
	</header>

	<ScrollArea class="min-h-0 flex-1">
		<div class="space-y-2 p-3">
			{#if contradictionLoading}
				<div class="rounded-xl border border-gray-200 bg-gray-50/90 p-3 text-[11px] text-gray-700">
					<p class="mb-2 text-[10px] font-semibold text-gray-500">Processing panel</p>
					<ul class="space-y-1.5 text-[12px] text-gray-600">
						{#each revisionProcessingSteps as step, index}
							<li
								class={`relative flex items-center gap-2 transition-opacity duration-300 ${
									index === activeProcessingStepIndex ? 'opacity-100' : 'opacity-40'
								}`}
							>
								{#if index < revisionProcessingSteps.length - 1}
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
			{/if}

			{#if !selectedParagraph}
				<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
					<p class="text-[10px] font-medium">Select a paragraph to analyze contradictions</p>
					<p class="mt-1 text-[10px] text-gray-400">
						Choose a paragraph in the document on the left.
					</p>
				</div>
			{:else if !selectedContradictionResult}
				<Card.Root size="sm" class="border-gray-200 bg-gray-50 py-0 text-[11px]">
					<Card.Content class="px-3 py-2 text-gray-600">
						No contradiction result is available for this paragraph yet. Run "Search contradictions"
						first.
					</Card.Content>
				</Card.Root>
			{:else if !selectedContradictionResult.contradiction}
				<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
					<p class="text-[10px] italic">No contradiction found in this paragraph.</p>
				</div>
			{:else}
				{#if selectedContradictionEvidence?.snippet_a?.trim() && selectedContradictionEvidence?.snippet_b?.trim()}
					<div class="overflow-hidden rounded border border-red-200 bg-red-50/70 text-[11px]">
						<div class="border-b border-red-200 bg-red-100/70 px-3 py-1.5">
							<p class="text-[9px] font-semibold text-red-700">Contradiction evidence</p>
						</div>
						<div class="space-y-2 p-2.5">
							<div class="rounded border border-red-300 bg-red-100/80 px-2.5 py-2">
								<div class="mb-1 flex items-center justify-between">
									<span class="text-[9px] font-semibold text-red-800">Assessment</span>
								</div>
								<p class="text-[10px] leading-relaxed text-red-800">
									Confidence: {selectedContradictionResult.confidence}% &middot; {selectedContradictionResult.brief_reason}
								</p>
							</div>
							<div class="rounded border border-red-300 bg-red-100/80 px-2.5 py-2">
								<div class="mb-1 flex items-center justify-between">
									<span class="text-[9px] font-semibold text-red-800">Snippet A</span>
									<Badge
										variant="outline"
										class="h-4 border-red-300 bg-white px-1.5 text-[8px] font-semibold text-red-800"
									>
										{selectedContradictionEvidence.source_a}
									</Badge>
								</div>
								<Button
									variant="ghost"
									class="h-auto w-full min-w-0 items-start justify-start whitespace-normal break-words [overflow-wrap:anywhere] px-0 py-0 text-left text-[11px] leading-relaxed text-red-800 hover:bg-transparent hover:text-red-900"
									onclick={() =>
										selectedContradictionResult &&
										onFocusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'a')}
								>
									{selectedContradictionEvidence.snippet_a}
								</Button>
							</div>

							<div class="rounded border border-red-300 bg-red-100/80 px-2.5 py-2">
								<div class="mb-1 flex items-center justify-between">
									<span class="text-[9px] font-semibold text-red-800">Snippet B</span>
									<Badge
										variant="outline"
										class="h-4 border-red-300 bg-white px-1.5 text-[8px] font-semibold text-red-800"
									>
										{selectedContradictionEvidence.source_b}
									</Badge>
								</div>
								<Button
									variant="ghost"
									class="h-auto w-full min-w-0 items-start justify-start whitespace-normal break-words [overflow-wrap:anywhere] px-0 py-0 text-left text-[11px] leading-relaxed text-red-800 hover:bg-transparent hover:text-red-900"
									onclick={() =>
										selectedContradictionResult &&
										onFocusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'b')}
								>
									{selectedContradictionEvidence.snippet_b}
								</Button>
							</div>
						</div>
					</div>
				{:else}
					<div class="overflow-hidden rounded border border-red-200 bg-red-50/70 text-[11px]">
						<div class="border-b border-red-200 bg-red-100/70 px-3 py-1.5">
							<p class="text-[9px] font-semibold text-red-700">Contradiction evidence</p>
						</div>
						<div class="space-y-2 p-2.5">
							<div class="rounded border border-red-300 bg-red-100/80 px-2.5 py-2">
								<div class="mb-1 flex items-center justify-between">
									<span class="text-[9px] font-semibold text-red-800">Assessment</span>
								</div>
								<p class="text-[10px] leading-relaxed text-red-800">
									Confidence: {selectedContradictionResult.confidence}% &middot; {selectedContradictionResult.brief_reason}
								</p>
							</div>
							<Card.Root size="sm" class="border-gray-200 bg-gray-50 py-0 text-[11px]">
								<Card.Content class="px-3 py-2 text-gray-600">
									Evidence snippets are unavailable for this contradiction.
								</Card.Content>
							</Card.Root>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</ScrollArea>
</section>
