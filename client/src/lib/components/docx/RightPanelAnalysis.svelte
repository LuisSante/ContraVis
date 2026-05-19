<script lang="ts">
	import { onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { cubicOut } from 'svelte/easing';
	import { slide } from 'svelte/transition';
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
	import ChatIcon from '$lib/icons/ChatIcon.svelte';
	import ContractChatAssistantIcon from '$lib/icons/ContractChatAssistantIcon.svelte';
	import UserIcon from '$lib/icons/UserIcon.svelte';
	import ContradictionActionMessageCard from './ContradictionActionMessageCard.svelte';

type ProcessingStep = {
		label: string;
		active: boolean;
	};
	type ContradictionSummaryItem = {
		paragraphId: string;
		label: string;
	};
	type ReferenceTextSegment = {
		text: string;
		isReference: boolean;
		isEntity?: boolean;
		entityKey?: string;
		entityColor?: string;
		entitySoftColor?: string;
	};
	type StructuredChatSection = { label: string | null; body: string };

	export let selectedParagraph: ParagraphNode | null = null;
	export let contradictionLoading = false;
	export let hasTriggeredContradictionCheck = false;
	export let contradictionError: string | null = null;
	export let contradictionCount = 0;
	export let contradictionSummaryItems: ContradictionSummaryItem[] = [];
	export let backendGraphLoading = false;
	export let relatedProcessingSteps: ProcessingStep[] = [];
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
	export let contradictionQuickActionRiskLabel = 'What are the risks of this contradiction?';
	export let onSuggestContradictionFix: () => void | Promise<void> = () => {};
	export let onAcceptFixSuggestion: (messageId: string) => void | Promise<void> = () => {};
	export let onRunContradictionQuickAction: (prompt: string) => void | Promise<void> = () => {};
	export let onSubmitAssistantQuestion: () => void | Promise<void> = () => {};
	export let onHandleAssistantInputKeydown: (event: KeyboardEvent) => void = () => {};
	export let rewriteBusy = false;
	export let entityHighlightsEnabled = true;
	export let onToggleEntityHighlights: () => void = () => {};
	export let contradictionTaxonomyLabels: Record<ContradictionTaxonomyType, string> = {
		temporal: 'Temporal',
		numerical: 'Numerical',
		authority: 'Authority',
		process: 'Process',
		policy_reversal: 'Policy Reversal',
		specificity: 'Specificity'
	};
	export let contradictionTaxonomyColors: Record<ContradictionTaxonomyType, string> = {
		temporal: '#8b5cf6',
		numerical: '#14b8a6',
		authority: '#f97316',
		process: '#0ea5e9',
		policy_reversal: '#ef4444',
		specificity: '#84cc16'
	};
	export let contradictionTaxonomyOrder: readonly ContradictionTaxonomyType[] = [
		'temporal',
		'numerical',
		'authority',
		'process',
		'policy_reversal',
		'specificity'
	];
	export let contradictionClaimSideColors: Record<'a' | 'b', string> = {
		a: '#1d4ed8',
		b: '#7c3aed'
	};

	let processingTick = 0;
	let processingTimer: ReturnType<typeof setInterval> | null = null;
	let isResizingChatPanel = false;
	const CHAT_PANEL_COLLAPSED_HEIGHT = 46;
	const CHAT_PANEL_OPEN_DEFAULT_HEIGHT = 250;
	const CHAT_PANEL_OPEN_THRESHOLD = 47;
	const PARAGRAPH_REFERENCE_PATTERN = /\S+-p-\d+(?=$|[\s.,;:!?\)\]])/g;
	let chatPanelHeight = CHAT_PANEL_COLLAPSED_HEIGHT;
	let resizeStartY = 0;
	let resizeStartHeight = 250;
	let isChatOpen = false;
	$: activeProcessingStepIndex =
		revisionProcessingSteps.length > 0
			? Math.floor(processingTick / 3) % revisionProcessingSteps.length
			: 0;
	$: activeDotCount = (processingTick % 3) + 1;
	$: isChatOpen = chatPanelHeight > CHAT_PANEL_OPEN_THRESHOLD;

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

	function escapeRegex(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function normalizeEntityKey(value: string): string {
		return value
			.toLocaleLowerCase()
			.normalize('NFKD')
			.replace(/[^\w\s-]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	function splitReferenceAndEntityText(
		value: string,
		entities: NonNullable<AssistantChatMessage['entityHighlights']>
	): ReferenceTextSegment[] {
		const baseSegments = splitReferenceText(value);
		if (!entities.length) return baseSegments;
		const labels = entities
			.map((entity) => entity.label.trim())
			.filter((label) => label.length >= 2)
			.sort((a, b) => b.length - a.length);
		if (!labels.length) return baseSegments;
		const entityMap = new Map(entities.map((entity) => [normalizeEntityKey(entity.label), entity]));
		const pattern = new RegExp(labels.map((label) => escapeRegex(label)).join('|'), 'gi');

		const merged: ReferenceTextSegment[] = [];
		for (const segment of baseSegments) {
			if (segment.isReference) {
				merged.push(segment);
				continue;
			}
			let cursor = 0;
			const text = segment.text;
			for (const match of text.matchAll(pattern)) {
				const found = match[0] ?? '';
				const index = match.index ?? 0;
				if (!found) continue;
				if (index > cursor) merged.push({ text: text.slice(cursor, index), isReference: false });
				const entity = entityMap.get(normalizeEntityKey(found));
				merged.push({
					text: found,
					isReference: false,
					isEntity: true,
					entityKey: entity?.key ?? normalizeEntityKey(found),
					entityColor: entity?.color,
					entitySoftColor: entity?.softColor
				});
				cursor = index + found.length;
			}
			if (cursor < text.length) merged.push({ text: text.slice(cursor), isReference: false });
		}
		return merged;
	}

	function parseStructuredRiskSections(content: string): StructuredChatSection[] | null {
		const text = (content || '').trim();
		if (!text) return null;
		const tryParseAnswerObject = (raw: string): string | null => {
			const cleaned = raw
				.replace(/^```(?:json)?\s*/i, '')
				.replace(/\s*```$/i, '')
				.trim();
			try {
				const parsed = JSON.parse(cleaned) as unknown;
				if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
				const record = parsed as Record<string, unknown>;
				const answerNode =
					record.answer && typeof record.answer === 'object' && !Array.isArray(record.answer)
						? (record.answer as Record<string, unknown>)
						: null;
				if (!answerNode) return null;
				const labels = ['Context', 'Contradiction', 'Risks', 'Affected', 'Consequences'];
				const lines = labels
					.map((label) => {
						const value = answerNode[label];
						return typeof value === 'string' && value.trim() ? `${label}: ${value.trim()}` : '';
					})
					.filter(Boolean);
				return lines.length > 0 ? lines.join('\n\n') : null;
			} catch {
				return null;
			}
		};
		const normalizedText = tryParseAnswerObject(text) ?? text;
		const knownLabels = new Set([
			'context',
			'contradiction',
			'risks',
			'affected',
			'affected party',
			'consequences'
		]);
		const labelPattern = /(Context|Contradiction|Risks|Affected|Affected Party|Consequences)\s*:/gi;
		const matches = Array.from(normalizedText.matchAll(labelPattern));
		const blocks =
			matches.length >= 2
				? matches.map((match, idx) => {
						const start = match.index ?? 0;
						const end =
							idx + 1 < matches.length
								? (matches[idx + 1].index ?? normalizedText.length)
								: normalizedText.length;
						return normalizedText.slice(start, end).trim();
					})
				: normalizedText.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
		const sections: StructuredChatSection[] = [];
		let recognized = 0;
		for (const block of blocks) {
			const match = block.match(/^([^:\n]{2,30}):\s*([\s\S]*)$/);
			if (!match) {
				sections.push({ label: null, body: block });
				continue;
			}
			const label = match[1].trim();
			const body = match[2].trim();
			if (knownLabels.has(label.toLowerCase())) {
				recognized += 1;
				sections.push({ label, body });
			} else {
				sections.push({ label: null, body: block });
			}
		}
		return recognized >= 2 ? sections : null;
	}

	function resolveContradictionTypeForSelected(): ContradictionTaxonomyType {
		const nextType = selectedContradictionResult?.contradiction_type;
		if (!nextType) return 'specificity';
		return nextType;
	}

	function hexToRgba(hex: string, alpha: number): string {
		const normalized = (hex || '').replace('#', '').trim();
		if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(132, 204, 22, ${alpha})`;
		const r = Number.parseInt(normalized.slice(0, 2), 16);
		const g = Number.parseInt(normalized.slice(2, 4), 16);
		const b = Number.parseInt(normalized.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function resolveSnippetBStyle() {
		const contradictionType = resolveContradictionTypeForSelected();
		const color =
			contradictionTaxonomyColors[contradictionType] ?? contradictionTaxonomyColors.specificity;
		return {
			color,
			border: color,
			background: hexToRgba(color, 0.14),
			badgeBorder: color,
			badgeText: color,
			label: contradictionTaxonomyLabels[contradictionType] ?? contradictionTaxonomyLabels.specificity
		};
	}

	function resolveEvidenceScopeLabel(
		evidence: ContradictionParagraphResult['evidence']
	): string {
		const sourceA = (evidence?.source_a || '').trim().toLowerCase();
		const sourceB = (evidence?.source_b || '').trim().toLowerCase();
		if (sourceA === 'paragraph' && sourceB === 'paragraph') return 'intra paragraph';
		if (sourceA === 'context' || sourceB === 'context') return 'inter paragraph';
		// Fallback to keep the tag always visible when legacy payloads return unknown sources.
		return sourceA === 'paragraph' || sourceB === 'paragraph' ? 'intra paragraph' : 'inter paragraph';
	}

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
		if (browser && (contradictionLoading || backendGraphLoading) && processingTimer == null) {
			processingTimer = setInterval(() => {
				processingTick += 1;
			}, 260);
		}
		if (!contradictionLoading && !backendGraphLoading && processingTimer != null) {
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

	<!-- <div class="border-b border-gray-100 bg-white px-3 py-2.5">
		{#if selectedParagraph}
			<p class="text-[10px] text-gray-500">
				Selected: {selectedParagraph.id} &middot; Page {selectedParagraph.page}
			</p>
		{/if}
	</div> -->

	<ScrollArea class="min-h-0 flex-1">
		<div class="flex min-h-full flex-col gap-1 p-3">
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
										index === activeProcessingStepIndex ? 'animate-pulse opacity-95' : 'opacity-30'
									}`}
									aria-hidden="true"
								></span>
								<span class="text-gray-600">
									{step.label}
									<span class="ml-px inline-flex min-w-[14px] text-gray-500" aria-hidden="true">
										{#if index === activeProcessingStepIndex}
											{activeDotCount >= 1 ? '.' : ''}{activeDotCount >= 2
												? '.'
												: ''}{activeDotCount >= 3 ? '.' : ''}
										{/if}
									</span>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
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
										index === activeProcessingStepIndex ? 'animate-pulse opacity-95' : 'opacity-30'
									}`}
									aria-hidden="true"
								></span>
								<span class="text-gray-600">
									{step.label}
									<span class="ml-px inline-flex min-w-[14px] text-gray-500" aria-hidden="true">
										{#if index === activeProcessingStepIndex}
											{activeDotCount >= 1 ? '.' : ''}{activeDotCount >= 2
												? '.'
												: ''}{activeDotCount >= 3 ? '.' : ''}
										{/if}
									</span>
								</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if hasTriggeredContradictionCheck}
				{#if contradictionError}
					<p class="text-[11px] text-red-700">{contradictionError}</p>
				{:else}
					<div class="flex flex-col gap-1">
						<p class="text-[11px] text-red-700">
							{contradictionCount} paragraph(s) with highlighted contradiction(s)
						</p>
						<div class="flex flex-wrap items-center gap-1.5">
							{#each contradictionTaxonomyOrder as category}
								<span
									class="inline-flex items-center gap-1 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[9px] text-gray-600"
									title={contradictionTaxonomyLabels[category]}
								>
									<span
										class="inline-block h-1.5 w-1.5 rounded-full"
										style={`background: ${contradictionTaxonomyColors[category]};`}
									></span>
									{contradictionTaxonomyLabels[category]}
								</span>
							{/each}
						</div>
					</div>
				{/if}
			{/if}

			{#if contradictionSummaryItems.length > 0}
				<div class="mt-1 mb-2 flex flex-col gap-1.5">
					{#each contradictionSummaryItems as item, index (item.paragraphId)}
						<div
							class={`overflow-hidden rounded-md border bg-white transition-[border-color,box-shadow,background-color] duration-200 ${
								selectedParagraph?.id === item.paragraphId
									? 'border-red-300 shadow-[0_0_0_1px_rgba(239,68,68,0.15)]'
									: 'border-gray-300 hover:border-gray-400 hover:bg-gray-50/40 hover:shadow-[0_1px_6px_rgba(15,23,42,0.08)]'
							}`}
						>
							<button
								type="button"
								class={`w-full px-3 py-1.5 text-left text-[11px] transition ${
									selectedParagraph?.id === item.paragraphId
										? 'bg-red-100/60 text-red-800 font-semibold'
										: 'cursor-pointer text-gray-600 hover:bg-gray-100 hover:text-gray-700'
								}`}
								onclick={() => onFocusNodeFromPanel(item.paragraphId, true)}
							>
								Contradiction {index + 1} <!-- : {item.label} -->
							</button>

							{#if selectedParagraph?.id === item.paragraphId && selectedContradictionResult?.contradiction}
								<div
									class="border-t border-gray-200 p-1.5 text-[11px]"
									transition:slide={{ duration: 200, easing: cubicOut }}
								>
									<div class="mb-1 flex items-center justify-between px-0.5">
										<p class="text-[9px] font-semibold text-red-700">Contradiction evidence</p>
										{#if selectedContradictionEvidence}
											<Badge
												variant="outline"
												class="h-4 border-red-300 bg-white px-1.5 text-[8px] font-semibold text-red-700"
											>
												{resolveEvidenceScopeLabel(selectedContradictionEvidence)}
											</Badge>
										{/if}
									</div>
									<div class="px-0.5">
										<p class="text-[9px] font-semibold text-gray-700">Assessment</p>
										<p class="text-[10px] leading-relaxed">
											{selectedContradictionResult.brief_reason}
										</p>
									</div>

									{#if selectedContradictionEvidence?.snippet_a?.trim() && selectedContradictionEvidence?.snippet_b?.trim()}
										{@const snippetBStyle = resolveSnippetBStyle()}
										<div class="mt-1 rounded border border-red-300 bg-red-100/80 px-2.5 py-2">
											<div class="mb-1 flex items-center justify-between">
												<span class="text-[9px] font-semibold text-red-800">Snippet A</span>
											</div>
											<Button
												variant="ghost"
												class="h-auto w-full min-w-0 items-start justify-start px-0 py-0 text-left text-[11px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-normal text-gray-700 hover:bg-transparent hover:text-red-900"
												onclick={() =>
													selectedContradictionResult &&
													onFocusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'a')}
											>
												{selectedContradictionEvidence.snippet_a}
											</Button>
										</div>

										<div
											class="mt-1 rounded border px-2.5 py-2"
											style={`border-color: ${snippetBStyle.border}; background: ${snippetBStyle.background};`}
										>
											<div class="mb-1 flex items-center justify-between">
												<div class="flex items-center gap-1.5">
													<span class="text-[9px] font-semibold" style={`color: ${snippetBStyle.color};`}
														>Snippet B</span
													>
													<Badge
														variant="outline"
														class="h-4 bg-white px-1.5 text-[8px] font-semibold"
														style={`border-color: ${snippetBStyle.badgeBorder}; color: ${snippetBStyle.badgeText};`}
													>
														{snippetBStyle.label}
													</Badge>
												</div>
											</div>
											<Button
												variant="ghost"
												class="h-auto w-full min-w-0 items-start justify-start px-0 py-0 text-left text-[11px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-normal text-gray-700 hover:bg-transparent hover:text-gray-800"
												onclick={() =>
													selectedContradictionResult &&
													onFocusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'b')}
											>
												{selectedContradictionEvidence.snippet_b}
											</Button>
										</div>
									{:else}
										<Card.Root size="sm" class="mt-1 border-gray-200 bg-gray-50 py-0 text-[11px]">
											<Card.Content class="px-3 py-2 text-gray-600">
												Evidence snippets are unavailable for this contradiction.
											</Card.Content>
										</Card.Root>
									{/if}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else if hasTriggeredContradictionCheck && !contradictionLoading && !contradictionError}
				<div class="flex flex-col items-center justify-center py-2 text-gray-400">
					<p class="text-[10px] italic">No contradictions found.</p>
				</div>
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
				isResizingChatPanel
					? 'border-blue-300 bg-blue-50'
					: 'hover:border-gray-300 hover:bg-gray-50'
			}`}
			aria-label="Resize contradiction chat"
			title="Drag to resize chat area"
			onmousedown={startChatPanelResize}
		></button>
		<div class={`flex items-center gap-1.5 ${isChatOpen ? 'mb-2' : ''}`}>
			<span
				class="inline-flex h-6 w-6 shrink-0 items-center justify-center text-gray-500"
				aria-hidden="true"
			>
				<ChatIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
			</span>

			<Button
				variant="outline"
				size="sm"
				class="h-6 border-gray-200 bg-gray-50 px-2 text-[10px] text-gray-700 hover:border-gray-300 hover:bg-gray-100"
				onclick={() => void handleRunContradictionQuickAction(contradictionQuickActionAiLabel)}
			>
				Why is it a contradiction?
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-6 border-gray-200 bg-gray-50 px-2 text-[10px] text-gray-700 hover:border-gray-300 hover:bg-gray-100"
				onclick={() => void handleRunContradictionQuickAction(contradictionQuickActionRiskLabel)}
			>
				What are the risks of this contradiction?
			</Button>
			<Button
				variant="outline"
				size="sm"
				class="h-6 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
				disabled={rewriteBusy || assistantLoading}
				onclick={() => void handleSuggestContradictionFix()}
			>
				{rewriteBusy ? 'Preparing fix...' : 'Suggest contradiction fix'}
			</Button>

			<button
				type="button"
				class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[10px] border border-gray-200 bg-white text-gray-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
				onclick={toggleChatPanel}
				aria-label={isChatOpen ? 'Minimize contradiction chat' : 'Maximize contradiction chat'}
				title={isChatOpen ? 'Minimize contradiction chat' : 'Maximize contradiction chat'}
			>
				{#if isChatOpen}
					<svg viewBox="0 0 20 20" fill="none" class="h-3.5 w-3.5" aria-hidden="true">
						<path
							d="M5 10H15"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				{:else}
					<svg viewBox="0 0 20 20" fill="none" class="h-3.5 w-3.5" aria-hidden="true">
						<rect
							x="4.5"
							y="4.5"
							width="11"
							height="11"
							rx="1.5"
							stroke="currentColor"
							stroke-width="1.4"
						/>
					</svg>
				{/if}
			</button>
		</div>

		{#if isChatOpen}
			<ScrollArea
				class="min-h-0 flex-1 rounded border border-gray-200 bg-gray-50/70 px-2 py-1.5"
				bind:viewportRef={assistantThread}
			>
				<div class="space-y-1.5">
					<div class="rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1 text-[10px] text-blue-800">
						Tip: click an assistant message to toggle entity highlights.
					</div>
					<div class="rounded-md border border-indigo-100 bg-indigo-50/60 px-2 py-1 text-[10px] text-indigo-800">
						Tip: hold <span class="font-semibold">Shift + Scroll</span> to bring evidence B closer to A.
					</div>
					{#if assistantMessages.length === 0}
						<p class="text-[10px] text-gray-500">
							Ask contradiction-focused questions about the selected paragraph.
						</p>
					{:else}
						{#each assistantMessages as message (message.id)}
							{#if message.fixContradictionSuggestion}
								<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
									<ContradictionActionMessageCard
										{message}
										{rewriteBusy}
										compact={true}
										{onFocusNodeFromPanel}
										{onAcceptFixSuggestion}
									/>
								</div>
							{:else}
								<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
									<div class="inline-flex max-w-[92%] items-start gap-1.5">
										{#if message.role === 'assistant'}
											<span class="mt-1 inline-flex shrink-0 items-center justify-center text-gray-500">
												<ContractChatAssistantIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
												<span class="sr-only">Assistant</span>
											</span>
										{/if}
										<div
											class={`rounded border px-2 py-1 text-[10px] leading-relaxed ${
												message.role === 'user'
													? 'border-blue-200 bg-blue-50 text-blue-800'
													: 'border-gray-200 bg-white text-gray-700'
											}`}
											onclick={() => {
												if (message.role === 'assistant' && (message.entityHighlights?.length ?? 0) > 0) {
													onToggleEntityHighlights();
												}
											}}
										>
											{#if message.role === 'assistant' && parseStructuredRiskSections(message.content)}
												<div class="space-y-6">
													{#each parseStructuredRiskSections(message.content) ?? [] as section, sectionIndex (`${message.id}-section-${sectionIndex}`)}
														<p class="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">
															{#if section.label}
																<span class="font-bold text-red-800">{section.label}:</span>{' '}
															{/if}
															{#each (entityHighlightsEnabled ? splitReferenceAndEntityText(section.body, message.entityHighlights ?? []) : splitReferenceText(section.body)) as segment, segmentIndex (`${message.id}-content-${sectionIndex}-${segmentIndex}`)}
																{#if segment.isReference}
																	<span class="docx-reference-chip align-middle">{segment.text}</span>
																{:else if segment.isEntity}
																	<span
																		class="docx-paragraph-explanation-entity-token"
																		data-entity-key={segment.entityKey}
																		style={`--entity-color:${segment.entityColor ?? '#2563eb'}; --entity-color-soft:${segment.entitySoftColor ?? 'rgba(37,99,235,0.16)'};`}
																	>
																		{segment.text}
																	</span>
																{:else}
																	<span>{segment.text}</span>
																{/if}
															{/each}
														</p>
													{/each}
												</div>
											{:else}
												<p class="[overflow-wrap:anywhere] break-words whitespace-pre-wrap">
													{#each (entityHighlightsEnabled ? splitReferenceAndEntityText(message.content, message.entityHighlights ?? []) : splitReferenceText(message.content)) as segment, segmentIndex (`${message.id}-content-${segmentIndex}`)}
														{#if segment.isReference}
															<span class="docx-reference-chip align-middle">{segment.text}</span>
														{:else if segment.isEntity}
															<span
																class="docx-paragraph-explanation-entity-token"
																data-entity-key={segment.entityKey}
																style={`--entity-color:${segment.entityColor ?? '#2563eb'}; --entity-color-soft:${segment.entitySoftColor ?? 'rgba(37,99,235,0.16)'};`}
															>
																{segment.text}
															</span>
														{:else}
															<span>{segment.text}</span>
														{/if}
													{/each}
												</p>
											{/if}
											<!-- {#if message.citations && message.citations.length > 0}
											<div class="mt-1.5 flex flex-wrap gap-1">
												{#each message.citations as citation}
													<button
														type="button"
														class="docx-reference-chip"
														onclick={() => onFocusNodeFromPanel(citation.id, true)}
													>
														{citation.id}
													</button>
												{/each}
											</div>
											{/if} -->
										</div>
										{#if message.role === 'user'}
											<span class="mt-1 inline-flex shrink-0 items-center justify-center text-blue-600">
												<UserIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
												<span class="sr-only">You</span>
											</span>
										{/if}
									</div>
								</div>
							{/if}
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
					class="h-7 w-7 border-gray-200 bg-white px-0 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
					onclick={() => void onSubmitAssistantQuestion()}
					disabled={assistantLoading}
					aria-label="Send contradiction chat message"
					title="Send"
				>
					<svg viewBox="0 0 20 20" fill="none" class="h-3.5 w-3.5" aria-hidden="true">
						<path
							d="M3 10L17 3L10 17L8.2 11.8L3 10Z"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
						<path
							d="M17 3L8.2 11.8"
							stroke="currentColor"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				</Button>
			</div>
		{/if}
	</div>
</section>
