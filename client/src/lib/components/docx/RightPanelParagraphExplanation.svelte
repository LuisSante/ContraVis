<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import type {
		Node as ParagraphNode,
		SimplifyResultState
	} from '$lib/types/document';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import ParagraphRewriteResult from './ParagraphRewriteResult.svelte';

	type ProcessingStep = {
		label: string;
		active: boolean;
	};
	type ReferenceTextSegment = {
		text: string;
		isReference: boolean;
	};

	export let selectedParagraph: ParagraphNode | null = null;
	export let loading = false;
	export let error: string | null = null;
	export let explanation = '';
	export let simplifyResult: SimplifyResultState | null = null;
	export let simplifyError: string | null = null;
	export let rewriteSource: 'simplify' | 'fix' | null = null;
	export let rewriteBusy = false;
	export let onReplaceRewrite: () => void = () => {};
	export let onCopyRewrite: () => void | Promise<void> = () => {};
	export let onRejectRewrite: () => void = () => {};
	export let onFocusParagraph: (paragraphId: string) => void = () => {};

	const explanationProcessingSteps: ProcessingStep[] = [
		{ label: 'Reading selected paragraph', active: false },
		{ label: 'Analyzing related context', active: false },
		{ label: 'Drafting plain-language explanation', active: false }
	];
	const PARAGRAPH_REFERENCE_PATTERN = /\S+-p-\d+(?=$|[\s.,;:!?\)\]])/g;

	let processingTick = 0;
	let processingTimer: ReturnType<typeof setInterval> | null = null;
	$: activeProcessingStepIndex =
		explanationProcessingSteps.length > 0
			? Math.floor(processingTick / 3) % explanationProcessingSteps.length
			: 0;
	$: activeDotCount = (processingTick % 3) + 1;

	function splitReferenceText(value: string): ReferenceTextSegment[] {
		if (!value) return [];
		const segments: ReferenceTextSegment[] = [];
		let lastIndex = 0;
		for (const match of value.matchAll(PARAGRAPH_REFERENCE_PATTERN)) {
			const start = match.index ?? 0;
			const matchedText = match[0] ?? '';
			if (!matchedText) continue;
			if (start > lastIndex) {
				segments.push({ text: value.slice(lastIndex, start), isReference: false });
			}
			segments.push({ text: matchedText, isReference: true });
			lastIndex = start + matchedText.length;
		}
		if (lastIndex < value.length) {
			segments.push({ text: value.slice(lastIndex), isReference: false });
		}
		if (segments.length === 0) {
			segments.push({ text: value, isReference: false });
		}
		return segments;
	}

	$: {
		if (browser && loading && processingTimer == null) {
			processingTimer = setInterval(() => {
				processingTick += 1;
			}, 260);
		}
		if (!loading && processingTimer != null) {
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
		<p class="text-[11px] text-gray-500">Detailed explanation for the selected paragraph.</p>
	</header>

	<!-- <div class="border-b border-gray-100 bg-white px-3 py-2.5">
		{#if selectedParagraph}
			<p class="text-[10px] text-gray-500">
				Selected: {selectedParagraph.id} &middot; Page {selectedParagraph.page}
			</p>
		{/if}
	</div> -->

	<ScrollArea class="min-h-0 flex-1 bg-gray-50/30">
		<div class="space-y-2 p-3">
			{#if !selectedParagraph}
				<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
					<p class="text-[10px] font-medium">Select a paragraph on the left.</p>
				</div>
			{:else}
				{#if loading}
					<div class="rounded-xl border border-gray-200 bg-gray-50/90 p-3 text-[11px] text-gray-700">
						<p class="mb-2 text-[10px] font-semibold text-gray-500">Processing panel</p>
						<ul class="space-y-1.5 text-[12px] text-gray-600">
							{#each explanationProcessingSteps as step, index}
								<li
									class={`relative flex items-center gap-2 transition-opacity duration-300 ${
										index === activeProcessingStepIndex ? 'opacity-100' : 'opacity-40'
									}`}
								>
									{#if index < explanationProcessingSteps.length - 1}
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
				{#if error}
					<div class="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{error}</div>
				{/if}
				{#if simplifyResult || simplifyError}
					<ParagraphRewriteResult
						simplifyResult={simplifyResult}
						rewriteSource={rewriteSource}
						simplifyError={simplifyError}
						rewriteBusy={rewriteBusy}
						selectedParagraphId={selectedParagraph?.id ?? null}
						applyLabel="Accept"
						rejectLabel="Reject"
						minimal={true}
						showCopyAction={false}
						onReplace={onReplaceRewrite}
						onCopy={onCopyRewrite}
						onReject={onRejectRewrite}
						onFocusParagraph={onFocusParagraph}
					/>
				{/if}
				{#if explanation}
					<div class="rounded border border-gray-200 bg-white px-3 py-2">
						<div class="mb-1">
							<Badge
								variant="outline"
								class="h-4 border-blue-100 bg-blue-50 px-1.5 text-[9px] font-semibold text-blue-600"
							>
								Explain
							</Badge>
						</div>
						<p class="whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700">
							{#each splitReferenceText(explanation) as segment, segmentIndex (`explanation-ref-${segmentIndex}`)}
								{#if segment.isReference}
									<span class="docx-reference-chip align-middle">{segment.text}</span>
								{:else}
									<span>{segment.text}</span>
								{/if}
							{/each}
						</p>
					</div>
				{/if}
			{/if}
		</div>
	</ScrollArea>
</section>
