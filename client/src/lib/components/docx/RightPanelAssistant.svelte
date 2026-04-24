<script lang="ts">
	import type {
		AssistantChatMessage,
		ChatHighlightSegment,
		ChatPreviewHoverState,
		ContradictionTaxonomyType,
		StructuredContradictionAnalysis
	} from '$lib/types/document';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	type ChatPreviewTab = 'contradiction' | 'claims';
	type ChatHighlightTooltip = {
		kind: 'claim' | 'highlight';
		badgeText: string;
		badgeStyle: string;
		description?: string;
	} | null;

	const EMPTY_TAXONOMY_LOOKUP: Record<ContradictionTaxonomyType, string> = {
		temporal: '',
		numerical: '',
		authority: '',
		process: '',
		policy_reversal: '',
		specificity: '',
		other: ''
	};
	const CONTRADICTION_TAXONOMY_DESCRIPTIONS: Readonly<Record<ContradictionTaxonomyType, string>> = {
		temporal: 'The claims conflict on timing, dates, or sequence of events.',
		numerical: 'The claims conflict on numbers, amounts, percentages, or quantities.',
		authority: 'The claims conflict on who has authority or who issues the statement.',
		process: 'The claims conflict on operational steps, method, or procedure.',
		policy_reversal:
			'One claim allows or affirms something and the other directly prohibits or negates it.',
		specificity: 'One claim is broader while the other is narrower in scope.',
		other: 'The claims conflict, but not under the main taxonomy categories.'
	};

	let chatPreviewHover: ChatPreviewHoverState | null = null;
	let chatPreviewTabByMessageId: Record<string, ChatPreviewTab> = {};

	export let assistantInput = '';
	export let assistantMessages: AssistantChatMessage[] = [];
	export let assistantLoading = false;
	export let assistantError: string | null = null;
	export let assistantThread: HTMLElement | null = null;

	export let quickActionSuggestions: readonly string[] = [];

	export let contradictionTaxonomyOrder: readonly ContradictionTaxonomyType[] = [];
	export let contradictionTaxonomyLabels: Record<ContradictionTaxonomyType, string> = {
		...EMPTY_TAXONOMY_LOOKUP
	};
	export let contradictionTaxonomyColors: Record<ContradictionTaxonomyType, string> = {
		...EMPTY_TAXONOMY_LOOKUP
	};
	export let contradictionClaimSideColors: Record<'a' | 'b', string> = {
		a: '#1d4ed8',
		b: '#7c3aed'
	};

	export let onSuggestedQuestionClick: (question: string) => void = () => {};
	export let onQuickActionSuggestionClick: (question: string) => void = () => {};
	export let onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void = () => {};
	export let onSubmitAssistantQuestion: () => void | Promise<void> = () => {};
	export let onHandleAssistantInputKeydown: (event: KeyboardEvent) => void = () => {};

	function toNonEmptyString(raw: unknown): string {
		if (typeof raw === 'string') return raw.trim();
		if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw).trim();
		return '';
	}

	function normalizeChatPreviewText(value: string): string {
		return value
			.replace(/\u00a0/g, ' ')
			.replace(/\r\n?/g, '\n')
			.replace(/[ \t]*\n+[ \t]*/g, ' ')
			.replace(/[ \t]{2,}/g, ' ')
			.trim();
	}

	function buildChatHighlightSegments(
		analysis: StructuredContradictionAnalysis | undefined
	): ChatHighlightSegment[] {
		if (!analysis) return [];

		const sourceText = normalizeChatPreviewText(analysis.highlight_source_text || '');
		if (!sourceText) return [];

		const textLower = sourceText.toLowerCase();
		const contradictionById = new Map<
			string,
			StructuredContradictionAnalysis['contradictions'][number]
		>();
		for (const contradiction of analysis.contradictions) {
			const key = toNonEmptyString(contradiction.id).toLowerCase();
			if (!key) continue;
			contradictionById.set(key, contradiction);
		}
		const singleContradiction =
			analysis.contradictions.length === 1 ? analysis.contradictions[0] : null;
		const singleContradictionId = singleContradiction
			? toNonEmptyString(singleContradiction.id) || null
			: null;

		type HighlightSpan = {
			start: number;
			end: number;
			length: number;
			category: ContradictionTaxonomyType;
			claimId?: string;
			claimSide?: 'a' | 'b';
			contradictionType?: ContradictionTaxonomyType;
			contradictionWhy?: string;
		};
		type SegmentMeta = Omit<ChatHighlightSegment, 'text'>;

		function findPhraseRanges(
			phrase: string,
			maxMatches: number
		): Array<{ start: number; end: number }> {
			if (!phrase) return [];
			const ranges: Array<{ start: number; end: number }> = [];
			const phraseLower = phrase.toLowerCase();
			let fromIndex = 0;
			while (fromIndex < textLower.length && ranges.length < maxMatches) {
				const start = textLower.indexOf(phraseLower, fromIndex);
				if (start < 0) break;
				ranges.push({ start, end: start + phrase.length });
				fromIndex = start + Math.max(1, phrase.length);
			}
			return ranges;
		}

		const claimIdByChar = new Array<string | null>(sourceText.length).fill(null);
		const claimSideByChar = new Array<'a' | 'b' | null>(sourceText.length).fill(null);
		const highlightCategoryByChar = new Array<ContradictionTaxonomyType | null>(
			sourceText.length
		).fill(null);
		const highlightTypeByChar = new Array<ContradictionTaxonomyType | null>(sourceText.length).fill(
			null
		);
		const highlightWhyByChar = new Array<string | null>(sourceText.length).fill(null);
		const highlightSpanLengthByChar = new Array<number>(sourceText.length).fill(
			Number.POSITIVE_INFINITY
		);
		const highlightClaimIdByChar = new Array<string | null>(sourceText.length).fill(null);
		const highlightClaimSideByChar = new Array<'a' | 'b' | null>(sourceText.length).fill(null);

		const assignClaimRange = (
			start: number,
			end: number,
			claimId: string,
			claimSide: 'a' | 'b'
		) => {
			const safeStart = Math.max(0, Math.min(sourceText.length, start));
			const safeEnd = Math.max(0, Math.min(sourceText.length, end));
			for (let index = safeStart; index < safeEnd; index += 1) {
				if (!claimIdByChar[index]) claimIdByChar[index] = claimId;
				if (!claimSideByChar[index]) claimSideByChar[index] = claimSide;
			}
		};

		const assignHighlightRange = (span: HighlightSpan) => {
			const safeStart = Math.max(0, Math.min(sourceText.length, span.start));
			const safeEnd = Math.max(0, Math.min(sourceText.length, span.end));
			for (let index = safeStart; index < safeEnd; index += 1) {
				const currentSpanLength = highlightSpanLengthByChar[index];
				const shouldReplace = span.length < currentSpanLength;
				if (shouldReplace) {
					highlightCategoryByChar[index] = span.category;
					highlightTypeByChar[index] = span.contradictionType || null;
					highlightWhyByChar[index] = span.contradictionWhy || null;
					highlightClaimIdByChar[index] = span.claimId || null;
					highlightClaimSideByChar[index] = span.claimSide || null;
					highlightSpanLengthByChar[index] = span.length;
				}
				if (span.claimId && !claimIdByChar[index]) claimIdByChar[index] = span.claimId;
				if (span.claimSide && !claimSideByChar[index]) claimSideByChar[index] = span.claimSide;
			}
		};

		const claimTextToRanges = (rawClaimText: string): Array<{ start: number; end: number }> => {
			const phrase = normalizeChatPreviewText(rawClaimText);
			if (phrase.length < 6) return [];
			const exact = findPhraseRanges(phrase, 2);
			if (exact.length > 0) return exact;

			const fragments = phrase
				.split(/[,:;()]/)
				.map((part) => part.trim())
				.filter((part) => part.length >= Math.max(12, Math.floor(phrase.length * 0.35)))
				.sort((left, right) => right.length - left.length);
			for (const fragment of fragments.slice(0, 3)) {
				const fragmentHits = findPhraseRanges(fragment, 2);
				if (fragmentHits.length > 0) return fragmentHits;
			}
			return [];
		};

		for (const contradiction of analysis.contradictions) {
			const claimId = toNonEmptyString(contradiction.id);
			if (!claimId) continue;
			for (const range of claimTextToRanges(contradiction.claim_a.text || '')) {
				assignClaimRange(range.start, range.end, claimId, 'a');
			}
			for (const range of claimTextToRanges(contradiction.claim_b.text || '')) {
				assignClaimRange(range.start, range.end, claimId, 'b');
			}
		}

		for (const highlight of analysis.highlights) {
			const phrase = normalizeChatPreviewText(highlight.phrase);
			if (phrase.length < 2) continue;
			const rawClaimId = toNonEmptyString(highlight.claim_id);
			const mappedContradiction = rawClaimId
				? contradictionById.get(rawClaimId.toLowerCase())
				: singleContradiction;
			const claimId = mappedContradiction?.id || rawClaimId || undefined;
			const claimSide =
				highlight.claim_side === 'a' || highlight.claim_side === 'b'
					? highlight.claim_side
					: undefined;
			const contradictionType = mappedContradiction?.contradiction_type;
			const contradictionWhy = mappedContradiction?.why;
			const phraseRanges = findPhraseRanges(phrase, 4);
			for (const range of phraseRanges) {
				assignHighlightRange({
					start: range.start,
					end: range.end,
					length: range.end - range.start,
					category: highlight.category,
					claimId,
					claimSide,
					contradictionType,
					contradictionWhy
				});
			}
		}

		for (let index = 0; index < sourceText.length; index += 1) {
			if (!claimIdByChar[index]) {
				if (claimSideByChar[index] && singleContradictionId) {
					claimIdByChar[index] = singleContradictionId;
				} else if (highlightClaimIdByChar[index]) {
					claimIdByChar[index] = highlightClaimIdByChar[index];
				} else if (highlightCategoryByChar[index] && singleContradictionId) {
					claimIdByChar[index] = singleContradictionId;
				}
			}
			if (!claimSideByChar[index] && highlightClaimSideByChar[index]) {
				claimSideByChar[index] = highlightClaimSideByChar[index];
			}
		}

		const hasMetadata = claimIdByChar.some(Boolean) || highlightCategoryByChar.some(Boolean);
		if (!hasMetadata) {
			return [{ text: sourceText, category: null, interactive: false }];
		}

		const getMetaForCharIndex = (index: number): SegmentMeta => {
			const claimId = claimIdByChar[index] || undefined;
			const claimSide = claimSideByChar[index] || undefined;
			const category = highlightCategoryByChar[index];
			const contradiction = claimId ? contradictionById.get(claimId.toLowerCase()) : undefined;
			const contradictionType =
				contradiction?.contradiction_type || highlightTypeByChar[index] || undefined;
			const contradictionWhy = contradiction?.why || highlightWhyByChar[index] || undefined;
			const interactive = Boolean(category || claimId || claimSide);
			return {
				category,
				claimId,
				claimSide,
				contradictionType,
				contradictionWhy,
				interactive
			};
		};

		const metaEquals = (left: SegmentMeta, right: SegmentMeta): boolean =>
			left.category === right.category &&
			left.claimId === right.claimId &&
			left.claimSide === right.claimSide &&
			left.contradictionType === right.contradictionType &&
			left.contradictionWhy === right.contradictionWhy &&
			left.interactive === right.interactive;

		const segments: ChatHighlightSegment[] = [];
		let segmentStart = 0;
		let segmentMeta = getMetaForCharIndex(0);
		for (let index = 1; index < sourceText.length; index += 1) {
			const nextMeta = getMetaForCharIndex(index);
			if (metaEquals(segmentMeta, nextMeta)) continue;
			segments.push({
				text: sourceText.slice(segmentStart, index),
				...segmentMeta
			});
			segmentStart = index;
			segmentMeta = nextMeta;
		}
		segments.push({
			text: sourceText.slice(segmentStart),
			...segmentMeta
		});

		return segments;
	}

	function getChatPreviewTab(messageId: string): ChatPreviewTab {
		return chatPreviewTabByMessageId[messageId] ?? 'contradiction';
	}

	function setChatPreviewTab(messageId: string, value: string) {
		const nextTab: ChatPreviewTab = value === 'claims' ? 'claims' : 'contradiction';
		if (getChatPreviewTab(messageId) === nextTab) return;
		chatPreviewTabByMessageId = {
			...chatPreviewTabByMessageId,
			[messageId]: nextTab
		};
		if (nextTab !== 'contradiction') clearChatPreviewHover(messageId);
	}

	function getChatPreviewHover(messageId: string): ChatPreviewHoverState | null {
		if (!chatPreviewHover) return null;
		return chatPreviewHover.messageId === messageId ? chatPreviewHover : null;
	}

	function clearChatPreviewHover(messageId?: string) {
		if (!chatPreviewHover) return;
		if (messageId && chatPreviewHover.messageId !== messageId) return;
		chatPreviewHover = null;
	}

	function handleChatPreviewSegmentMouseEnter(
		messageId: string,
		segment: ChatHighlightSegment,
		segmentKey: string
	) {
		const contradictionId = toNonEmptyString(segment.claimId);
		if (!contradictionId) {
			clearChatPreviewHover(messageId);
			return;
		}

		if (segment.claimSide) {
			chatPreviewHover = {
				messageId,
				segmentKey,
				contradictionId,
				claimSide: segment.claimSide,
				kind: 'claim'
			};
			return;
		}

		if (segment.category) {
			chatPreviewHover = {
				messageId,
				segmentKey,
				contradictionId,
				claimSide: segment.claimSide ?? null,
				kind: 'highlight'
			};
			return;
		}
	}

	function isChatPreviewTooltipOpen(messageId: string, segmentKey: string): boolean {
		const hover = getChatPreviewHover(messageId);
		if (!hover) return false;
		return hover.segmentKey === segmentKey;
	}

	function isHoveringContradiction(messageId: string, contradictionId?: string): boolean {
		const hover = getChatPreviewHover(messageId);
		if (!hover || !contradictionId) return false;
		return hover.contradictionId.toLowerCase() === contradictionId.toLowerCase();
	}

	function resolveChatHighlightSegmentStyle(
		segment: ChatHighlightSegment,
		messageId: string
	): string {
		const hover = getChatPreviewHover(messageId);
		const hoverMatchesContradiction = isHoveringContradiction(messageId, segment.claimId);

		if (hover?.kind === 'claim' && hover.claimSide) {
			const claimColor = contradictionClaimSideColors[hover.claimSide];

			if (segment.claimSide === hover.claimSide) {
				return [
					`background: ${claimColor}3a;`,
					`border-bottom: 2px solid ${claimColor};`,
					`box-shadow: 0 0 0 1px ${claimColor}70, 0 0 10px ${claimColor}3d;`
				].join(' ');
			}

			if (!segment.claimSide && hoverMatchesContradiction) {
				return [
					`background: ${claimColor}36;`,
					`border-bottom: 2px solid ${claimColor};`,
					`box-shadow: inset 0 0 0 1px ${claimColor}55;`
				].join(' ');
			}

			if (segment.category) {
				return 'background: transparent; border-bottom: 1.5px solid transparent; box-shadow: none;';
			}

			return '';
		}

		if (hover?.kind === 'highlight' && hoverMatchesContradiction && segment.category) {
			const contradictionType = segment.contradictionType || segment.category;
			const color = contradictionTaxonomyColors[contradictionType];
			return [
				`background: ${color}3a;`,
				`border-bottom: 2px solid ${color};`,
				`box-shadow: 0 0 0 1px ${color}70, 0 0 12px ${color}55;`
			].join(' ');
		}

		if (segment.category) {
			const color = contradictionTaxonomyColors[segment.category];
			return `background: ${color}22; border-bottom: 1.5px solid ${color};`;
		}

		return '';
	}

	function resolveChatClaimSegmentStyle(segment: ChatHighlightSegment): string {
		if (!segment.claimSide) return '';
		const color = contradictionClaimSideColors[segment.claimSide];
		return [
			`background: ${color}26;`,
			`border-bottom: 1.5px solid ${color};`,
			`box-shadow: inset 0 0 0 1px ${color}45;`
		].join(' ');
	}

	function resolveChatHighlightSegmentTooltip(
		segment: ChatHighlightSegment
	): ChatHighlightTooltip | null {
		if (segment.category) {
			const contradictionType = segment.contradictionType || segment.category;
			const color = contradictionTaxonomyColors[contradictionType];
			const typeLabel = contradictionTaxonomyLabels[contradictionType];
			return {
				kind: 'highlight',
				badgeText: typeLabel,
				badgeStyle: `border-color: ${color}55; background: ${color}1f; color: ${color};`,
				description:
					segment.contradictionWhy || CONTRADICTION_TAXONOMY_DESCRIPTIONS[contradictionType]
			};
		}

		if (segment.claimSide) {
			const claimLabel = segment.claimSide === 'a' ? 'Snippet A' : 'Snippet B';
			const color = contradictionClaimSideColors[segment.claimSide];
			return {
				kind: 'claim',
				badgeText: claimLabel,
				badgeStyle: `border-color: ${color}55; background: ${color}1f; color: ${color};`
			};
		}

		return null;
	}
</script>

<section class="flex min-h-0 flex-1 flex-col bg-white">
	<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
		<p class="text-[11px] text-gray-500">
			Ask questions and get contextual help grounded in the selected contract.
		</p>
	</header>

	<ScrollArea class="min-h-0 flex-1 bg-gray-50/30" bind:viewportRef={assistantThread}>
		<div class="flex min-h-full flex-col gap-2 p-2">
			{#if assistantMessages.length === 0 && !assistantLoading}
				<div class="flex flex-1 flex-col items-center justify-center text-gray-300">
					<p class="text-[10px] italic">Chat about this contract</p>
				</div>
			{/if}

			{#each assistantMessages as message (message.id)}
				<div class="flex {message.role === 'user' ? 'justify-end' : 'justify-start'}">
					<div
						class="max-w-[92%] rounded-lg border px-2.5 py-2 text-[11px] leading-relaxed shadow-sm {message.role ===
						'user'
							? 'border-blue-200 bg-blue-50 text-blue-900'
							: 'border-gray-200 bg-white text-gray-700'}"
					>
						{#if message.structuredContradiction}
							<div class="space-y-2">
								<p class="whitespace-pre-wrap">{message.content}</p>

								{#if message.structuredContradiction.highlight_source_text?.trim()}
									{@const chatSegments = buildChatHighlightSegments(
										message.structuredContradiction
									)}
									<div
										class="rounded-xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/65 to-sky-50/35 px-2.5 py-2.5 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.45)]"
									>
										<Tabs.Root
											value={getChatPreviewTab(message.id)}
											onValueChange={(value) => setChatPreviewTab(message.id, value)}
											class="gap-1.5"
										>
											<Tabs.List class="h-6 w-full border border-gray-200 bg-white p-[2px]">
												<Tabs.Trigger value="contradiction" class="text-[9px] font-semibold">
													Contradiction
												</Tabs.Trigger>
												<Tabs.Trigger value="claims" class="text-[9px] font-semibold">
													Snippet
												</Tabs.Trigger>
											</Tabs.List>

											<Tabs.Content value="contradiction" class="text-[11px]">
												<p
													class="leading-relaxed break-words whitespace-normal text-gray-700"
													on:mouseleave={() => clearChatPreviewHover(message.id)}
												>
													{#each chatSegments as segment, segmentIndex}
														{#if segment.interactive}
															{@const tooltipData = resolveChatHighlightSegmentTooltip(segment)}
															{@const segmentKey = `${message.id}:${segmentIndex}`}
															{#if tooltipData}
																<Tooltip.Root
																	open={isChatPreviewTooltipOpen(message.id, segmentKey)}
																	onOpenChange={(open) => {
																		if (open) {
																			handleChatPreviewSegmentMouseEnter(
																				message.id,
																				segment,
																				segmentKey
																			);
																			return;
																		}
																		if (isChatPreviewTooltipOpen(message.id, segmentKey)) {
																			clearChatPreviewHover(message.id);
																		}
																	}}
																>
																	<Tooltip.Trigger>
																		{#snippet child({ props })}
																			<span
																				{...props}
																				class="inline bg-transparent p-0 text-left align-baseline leading-[inherit] whitespace-normal text-inherit transition-[background-color,border-color,box-shadow,color] duration-150 ease-out hover:cursor-help focus-visible:outline-none"
																				on:mouseenter={() =>
																					handleChatPreviewSegmentMouseEnter(
																						message.id,
																						segment,
																						segmentKey
																					)}
																				on:mouseleave={() => clearChatPreviewHover(message.id)}
																				on:focus={() =>
																					handleChatPreviewSegmentMouseEnter(
																						message.id,
																						segment,
																						segmentKey
																					)}
																				on:blur={() => clearChatPreviewHover(message.id)}
																			>
																				<span
																					class="inline rounded-[3px] px-[2px] py-[1px]"
																					style={resolveChatHighlightSegmentStyle(
																						segment,
																						message.id
																					)}
																				>
																					{segment.text}
																				</span>
																			</span>
																		{/snippet}
																	</Tooltip.Trigger>
																	<Tooltip.Content
																		side="top"
																		sideOffset={6}
																		class="max-w-[290px] border border-gray-200 bg-white px-2 py-1.5 text-gray-700 shadow-md"
																	>
																		<div class="space-y-1">
																			<Badge
																				variant="outline"
																				class="h-4 px-1.5 text-[9px] font-semibold"
																				style={tooltipData.badgeStyle}
																			>
																				{tooltipData.badgeText}
																			</Badge>
																			{#if tooltipData.description}
																				<p class="text-[9px] leading-relaxed text-gray-600">
																					{tooltipData.description}
																				</p>
																			{/if}
																		</div>
																	</Tooltip.Content>
																</Tooltip.Root>
															{:else}
																<button
																	type="button"
																	class="inline appearance-none rounded-sm border-0 bg-transparent px-[2px] py-[1px] text-left align-baseline leading-[inherit] whitespace-normal text-inherit"
																	style={resolveChatHighlightSegmentStyle(segment, message.id)}
																	on:mouseenter={() =>
																		handleChatPreviewSegmentMouseEnter(
																			message.id,
																			segment,
																			segmentKey
																		)}
																	on:mouseleave={() => clearChatPreviewHover(message.id)}
																>
																	{segment.text}
																</button>
															{/if}
														{:else}
															<span>{segment.text}</span>
														{/if}
													{/each}
												</p>

												<div class="mt-2 flex flex-wrap gap-2">
													{#each contradictionTaxonomyOrder as category}
														<Badge
															variant="outline"
															class="h-4 items-center gap-1 border-gray-200 bg-white px-1.5 text-[9px] text-gray-600"
														>
															<span
																class="inline-flex h-2 w-2 rounded-full"
																style={`background: ${contradictionTaxonomyColors[category]};`}
															></span>
															{contradictionTaxonomyLabels[category]}
														</Badge>
													{/each}
												</div>
											</Tabs.Content>

											<Tabs.Content value="claims" class="text-[11px]">
												<p class="leading-relaxed break-words whitespace-normal text-gray-700">
													{#each chatSegments as segment}
														{#if segment.claimSide}
															<span
																class="inline rounded-[3px] px-[2px] py-[1px]"
																style={resolveChatClaimSegmentStyle(segment)}
															>
																{segment.text}
															</span>
														{:else}
															<span>{segment.text}</span>
														{/if}
													{/each}
												</p>

												<div class="mt-2 flex flex-wrap gap-1.5">
													<Badge
														variant="outline"
														class="h-4 items-center gap-1 px-1.5 text-[9px] font-semibold"
														style={`border-color: ${contradictionClaimSideColors.a}55; background: ${contradictionClaimSideColors.a}14; color: ${contradictionClaimSideColors.a};`}
													>
														<span
															class="inline-flex h-2 w-2 rounded-full"
															style={`background: ${contradictionClaimSideColors.a};`}
														></span>
														Snippet A
													</Badge>
													<Badge
														variant="outline"
														class="h-4 items-center gap-1 px-1.5 text-[9px] font-semibold"
														style={`border-color: ${contradictionClaimSideColors.b}55; background: ${contradictionClaimSideColors.b}14; color: ${contradictionClaimSideColors.b};`}
													>
														<span
															class="inline-flex h-2 w-2 rounded-full"
															style={`background: ${contradictionClaimSideColors.b};`}
														></span>
														Snippet B
													</Badge>
												</div>
											</Tabs.Content>
										</Tabs.Root>
									</div>
								{/if}
							</div>
						{:else}
							<p class="whitespace-pre-wrap">{message.content}</p>
						{/if}

						{#if message.suggestedQuestions?.length}
							<div class="mt-2">
								<p class="mb-1 text-[9px] font-semibold text-gray-500">Suggested questions</p>
								<div class="flex flex-wrap gap-1">
									{#each message.suggestedQuestions as suggestedQuestion}
										<Button
											variant="outline"
											size="xs"
											class="h-5 border-gray-200 bg-gray-50 px-1.5 text-[9px] text-gray-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
											onclick={() => onSuggestedQuestionClick(suggestedQuestion)}
										>
											{suggestedQuestion}
										</Button>
									{/each}
								</div>
							</div>
						{/if}

						{#if message.citations?.length}
							<div class="mt-2 flex flex-wrap gap-1">
								{#each message.citations as citation}
									<Button
										variant="outline"
										size="xs"
										class="h-5 border-amber-200 bg-amber-50 px-1.5 text-[9px] font-bold text-amber-700 hover:border-amber-300"
										title={citation.excerpt}
										onclick={() => onFocusNodeFromPanel(citation.id, true)}
									>
										{citation.id}
									</Button>
								{/each}
							</div>
						{/if}
					</div>
				</div>
			{/each}

			{#if assistantLoading}
				<div class="flex justify-start">
					<div class="w-[82%] max-w-[92%] rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
						<div class="space-y-2">
							<Skeleton class="h-3.5 w-28" />
							<Skeleton class="h-3 w-full" />
							<Skeleton class="h-3 w-[92%]" />
							<Skeleton class="h-3 w-[70%]" />
						</div>
					</div>
				</div>
			{/if}
		</div>
	</ScrollArea>

	{#if assistantError}
		<div class="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[10px] text-red-700">
			{assistantError}
		</div>
	{/if}

	<form
		class="border-t border-gray-200 bg-white p-2"
		on:submit|preventDefault={() => void onSubmitAssistantQuestion()}
	>
		{#if quickActionSuggestions.length}
			<div class="mb-2 flex flex-nowrap items-center gap-1.5 overflow-x-auto">
				{#each quickActionSuggestions as action}
					<Button
						variant="outline"
						size="sm"
						class="h-6 shrink-0 border-gray-200 bg-gray-50 px-2 text-[10px] text-gray-700 hover:border-gray-300 hover:bg-gray-100"
						onclick={() => onQuickActionSuggestionClick(action)}
					>
						{action}
					</Button>
				{/each}
			</div>
		{/if}

		<div class="mt-2 flex items-end gap-1.5">
			<Textarea
				rows={2}
				placeholder="Ask about this contract or paragraph..."
				class="min-h-[50px] border-gray-200 bg-white text-[10px] text-gray-700"
				bind:value={assistantInput}
				onkeydown={onHandleAssistantInputKeydown}
				disabled={assistantLoading}
			/>
			<Button
				type="submit"
				variant="outline"
				size="sm"
				disabled={assistantLoading}
				class="h-7 w-7 border-gray-200 bg-white px-0 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
				aria-label="Send chat message"
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
	</form>
</section>
