<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import type {
		AssistantChatMessage,
		ContradictionTaxonomyType,
		ContradictionParagraphResult,
		Node as ParagraphNode
	} from '$lib/types/document';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import ContractChatAssistantIcon from '$lib/icons/ContractChatAssistantIcon.svelte';

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
	export let onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void = () => {};
	export let assistantInput = '';
	export let assistantMessages: AssistantChatMessage[] = [];
	export let assistantLoading = false;
	export let assistantError: string | null = null;
	export let assistantThread: HTMLElement | null = null;
	export let contradictionQuickActionFreeLabel = 'Why is it a contradiction? (Free)';
	export let contradictionQuickActionAiLabel = 'Why is it a contradiction? (AI cost)';
	export let onSuggestContradictionFix: () => void | Promise<void> = () => {};
	export let onRunContradictionQuickAction: (prompt: string) => void | Promise<void> = () => {};
	export let onSubmitAssistantQuestion: () => void | Promise<void> = () => {};
	export let onHandleAssistantInputKeydown: (event: KeyboardEvent) => void = () => {};
	export let contradictionTaxonomyLabels: Record<ContradictionTaxonomyType, string> = {
		temporal: 'Temporal',
		numerical: 'Numerical',
		authority: 'Authority',
		process: 'Process',
		policy_reversal: 'Policy Reversal',
		specificity: 'Specificity',
		other: 'Other'
	};
	export let contradictionTaxonomyColors: Record<ContradictionTaxonomyType, string> = {
		temporal: '#8b5cf6',
		numerical: '#14b8a6',
		authority: '#f97316',
		process: '#0ea5e9',
		policy_reversal: '#ef4444',
		specificity: '#84cc16',
		other: '#9ca3af'
	};

	let processingTick = 0;
	let processingTimer: ReturnType<typeof setInterval> | null = null;
	let isResizingChatPanel = false;
	const CHAT_PANEL_COLLAPSED_HEIGHT = 46;
	const CHAT_PANEL_OPEN_DEFAULT_HEIGHT = 250;
	const CHAT_PANEL_OPEN_THRESHOLD = 47;
	let chatPanelHeight = CHAT_PANEL_COLLAPSED_HEIGHT;
	let resizeStartY = 0;
	let resizeStartHeight = 250;
	let isChatOpen = false;
	$: activeProcessingStepIndex =
		revisionProcessingSteps.length > 0 ? Math.floor(processingTick / 3) % revisionProcessingSteps.length : 0;
	$: activeDotCount = (processingTick % 3) + 1;
	$: isChatOpen = chatPanelHeight > CHAT_PANEL_OPEN_THRESHOLD;

	function clampChatPanelHeight(next: number): number {
		return Math.max(CHAT_PANEL_COLLAPSED_HEIGHT, Math.round(next));
	}

	function handleChatPanelResizeMove(event: MouseEvent) {
		if (!isResizingChatPanel) return;
		const delta = resizeStartY - event.clientY;
		chatPanelHeight = clampChatPanelHeight(resizeStartHeight + delta);
	}

	function stopChatPanelResize() {
		if (!isResizingChatPanel) return;
		isResizingChatPanel = false;
		if (typeof window === 'undefined') return;
		window.removeEventListener('mousemove', handleChatPanelResizeMove);
		window.removeEventListener('mouseup', stopChatPanelResize);
	}

	function startChatPanelResize(event: MouseEvent) {
		if (typeof window === 'undefined') return;
		event.preventDefault();
		isResizingChatPanel = true;
		resizeStartY = event.clientY;
		resizeStartHeight = chatPanelHeight;
		window.addEventListener('mousemove', handleChatPanelResizeMove);
		window.addEventListener('mouseup', stopChatPanelResize);
	}

	function openChatPanel() {
		chatPanelHeight = resolveHalfOpenHeight();
	}

	function resolveHalfOpenHeight() {
		if (typeof window === 'undefined') {
			return CHAT_PANEL_OPEN_DEFAULT_HEIGHT;
		}
		return Math.max(CHAT_PANEL_OPEN_THRESHOLD + 1, Math.round(window.innerHeight * 0.5));
	}

	function closeChatPanel() {
		stopChatPanelResize();
		chatPanelHeight = CHAT_PANEL_COLLAPSED_HEIGHT;
	}

	function toggleChatPanel() {
		chatPanelHeight =
			chatPanelHeight > CHAT_PANEL_OPEN_THRESHOLD
				? CHAT_PANEL_COLLAPSED_HEIGHT
				: resolveHalfOpenHeight();
	}

	async function handleSuggestContradictionFix() {
		openChatPanel();
		await onSuggestContradictionFix();
	}

	async function handleRunContradictionQuickAction(prompt: string) {
		openChatPanel();
		await onRunContradictionQuickAction(prompt);
	}

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
		stopChatPanelResize();
	});
</script>

<section class="flex min-h-0 flex-1 flex-col">
	<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
		<p class="text-[11px] text-gray-500">
			Inspect contradictions, confidence, and evidence for the selected paragraph.
		</p>
	</header>

	<div class="border-b border-gray-100 bg-white px-3 py-2.5">
		{#if selectedParagraph}
			<p class="text-[10px] text-gray-500">
				Selected: {selectedParagraph.id} &middot; Page {selectedParagraph.page}
			</p>
		{/if}
	</div>

	<ScrollArea class="min-h-0 flex-1">
		<div class="space-y-1 p-3">
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
						<div class="space-y-1 p-1.5">
							<div class="px-0.5">
								<p class="text-[9px] font-semibold text-red-800">Assessment</p>
								<p class="text-[10px] leading-relaxed text-red-800">
									Confidence: {selectedContradictionResult.confidence}% &middot; {selectedContradictionResult.brief_reason}
								</p>
							</div>
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

							<div class="rounded border border-yellow-300 bg-yellow-100/75 px-2.5 py-2">
								<div class="mb-1 flex items-center justify-between">
									<span class="text-[9px] font-semibold text-yellow-800">Snippet B</span>
									<Badge
										variant="outline"
										class="h-4 border-yellow-300 bg-white px-1.5 text-[8px] font-semibold text-yellow-800"
									>
										{selectedContradictionEvidence.source_b}
									</Badge>
								</div>
								<Button
									variant="ghost"
									class="h-auto w-full min-w-0 items-start justify-start whitespace-normal break-words [overflow-wrap:anywhere] px-0 py-0 text-left text-[11px] leading-relaxed text-yellow-900 hover:bg-transparent hover:text-yellow-950"
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
						<div class="space-y-1 p-1.5">
							<div class="px-0.5">
								<p class="text-[9px] font-semibold text-red-800">Assessment</p>
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

	<div
		class={`relative flex shrink-0 flex-col border-t border-gray-200 bg-white px-3 py-2 ${
			isResizingChatPanel ? '' : 'transition-[height] duration-200 ease-out'
		}`}
		style={`height: ${chatPanelHeight}px; min-height: ${CHAT_PANEL_COLLAPSED_HEIGHT}px;`}
	>
		<button
			type="button"
			class={`absolute top-0 left-1/2 h-2 w-16 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-full border border-gray-200 bg-white transition ${
				isResizingChatPanel ? 'border-blue-300 bg-blue-50' : 'hover:border-gray-300 hover:bg-gray-50'
			}`}
			aria-label="Resize contradiction chat"
			title="Drag to resize chat area"
			onmousedown={startChatPanelResize}
		></button>
		<div class={`flex flex-nowrap items-center gap-1.5 overflow-x-auto ${isChatOpen ? 'mb-2' : ''}`}>
			<Button
				variant="outline"
				size="sm"
				class="h-6 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
				onclick={() => void handleSuggestContradictionFix()}
			>
				Suggest contradiction fix
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-6 border-gray-200 bg-gray-50 px-2 text-[10px] text-gray-700 hover:border-gray-300 hover:bg-gray-100"
				onclick={() => void handleRunContradictionQuickAction(contradictionQuickActionFreeLabel)}
			>
				Why is it a contradiction? Free
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-6 border-gray-200 bg-gray-50 px-2 text-[10px] text-gray-700 hover:border-gray-300 hover:bg-gray-100"
				onclick={() => void handleRunContradictionQuickAction(contradictionQuickActionAiLabel)}
			>
				Why is it a contradiction? AI cost
			</Button>
			<button
				type="button"
				class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[10px] border border-gray-200 bg-white text-gray-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
				onclick={toggleChatPanel}
				aria-label={isChatOpen ? 'Close contradiction chat' : 'Open contradiction chat'}
				title={isChatOpen ? 'Close contradiction chat' : 'Open contradiction chat'}
			>
				<ContractChatAssistantIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
			</button>
		</div>

		{#if isChatOpen}
			<ScrollArea
				class="min-h-0 flex-1 rounded border border-gray-200 bg-gray-50/70 px-2 py-1.5"
				bind:viewportRef={assistantThread}
			>
				<div class="space-y-1.5">
					{#if assistantMessages.length === 0}
						<p class="text-[10px] text-gray-500">
							Ask contradiction-focused questions about the selected paragraph.
						</p>
					{:else}
						{#each assistantMessages as message (message.id)}
							<div
								class={`rounded px-2 py-1 text-[10px] leading-relaxed ${
									message.role === 'user'
										? 'ml-6 border border-blue-200 bg-blue-50 text-blue-800'
										: 'mr-6 border border-gray-200 bg-white text-gray-700'
								}`}
							>
								<p class="mb-0.5 text-[9px] font-semibold opacity-70">
									{message.role === 'user' ? 'You' : 'Assistant'}
								</p>
								<p class="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</p>

								{#if message.citations && message.citations.length > 0}
									<div class="mt-1.5 flex flex-wrap gap-1">
										{#each message.citations as citation}
											<button
												type="button"
												class="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[9px] text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
												onclick={() => onFocusNodeFromPanel(citation.id, true)}
											>
												{citation.id}
											</button>
										{/each}
									</div>
								{/if}

								{#if message.structuredContradiction}
									{@const structuredContradiction = message.structuredContradiction}
									<div class="mt-1.5 rounded border border-red-200 bg-red-50/70 px-1.5 py-1">
										<div class="mb-1 flex flex-wrap items-center gap-1">
											<Badge variant="outline" class="h-4 border-red-300 bg-white px-1 text-[8px] text-red-700">
												Contradictions: {structuredContradiction.contradiction_count}
											</Badge>
											{#if structuredContradiction.paragraph_id}
												<button
													type="button"
													class="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[8px] text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
													onclick={() => onFocusNodeFromPanel(structuredContradiction.paragraph_id, true)}
												>
													{structuredContradiction.paragraph_id}
												</button>
											{/if}
										</div>
										<div class="space-y-1">
											{#each structuredContradiction.contradictions.slice(0, 3) as item}
												<div class="rounded border border-red-200/80 bg-white/70 px-1.5 py-1">
													<div class="mb-0.5 flex items-center gap-1">
														<Badge
															variant="outline"
															class="h-4 px-1 text-[8px] font-semibold"
															style={`border-color:${contradictionTaxonomyColors[item.contradiction_type]}; color:${contradictionTaxonomyColors[item.contradiction_type]}; background:#fff;`}
														>
															{contradictionTaxonomyLabels[item.contradiction_type]}
														</Badge>
														<span class="text-[8px] text-gray-500">{Math.round(item.confidence)}%</span>
													</div>
													<p class="max-h-10 overflow-hidden text-[9px] text-gray-700">{item.why}</p>
												</div>
											{/each}
										</div>
									</div>
								{/if}
							</div>
						{/each}
					{/if}
					{#if assistantLoading}
						<p class="text-[10px] text-gray-500">Analyzing contradiction...</p>
					{/if}
				</div>
			</ScrollArea>

			{#if assistantError}
				<p class="mt-1 text-[10px] text-red-600">{assistantError}</p>
			{/if}

			<div class="mt-2 flex items-end gap-1.5">
				<Textarea
					rows={2}
					placeholder="Ask about this contradiction..."
					class="min-h-[50px] border-gray-200 bg-white text-[10px] text-gray-700"
					bind:value={assistantInput}
					onkeydown={onHandleAssistantInputKeydown}
					disabled={assistantLoading}
				/>
				<Button
					variant="outline"
					size="sm"
					class="h-7 border-gray-200 bg-white px-2 text-[10px] text-gray-700 hover:border-gray-300 hover:bg-gray-100"
					onclick={() => void onSubmitAssistantQuestion()}
					disabled={assistantLoading}
				>
					Send
				</Button>
			</div>
		{/if}
	</div>
</section>
