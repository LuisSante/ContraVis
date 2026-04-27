<script lang="ts">
	import type {
		ChatHighlightSegment,
		ContradictionTaxonomyType,
		StructuredContradictionAnalysis
	} from '$lib/types/document';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Tabs from '$lib/components/ui/tabs/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	type ChatPreviewTab = 'contradiction' | 'claims';
	type ChatHighlightTooltip = {
		kind: 'claim' | 'highlight';
		badgeText: string;
		badgeStyle: string;
		description?: string;
	} | null;
	type ChatPreviewHoverState = {
		segmentKey: string;
		contradictionId: string;
		claimSide: 'a' | 'b' | null;
		kind: 'claim' | 'highlight';
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

	export let messageContent = '';
	export let structuredContradiction: StructuredContradictionAnalysis | null = null;
	export let contradictionTaxonomyOrder: readonly ContradictionTaxonomyType[] = [
		'temporal',
		'numerical',
		'authority',
		'process',
		'policy_reversal',
		'specificity',
		'other'
	];
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
	export let contradictionClaimSideColors: Record<'a' | 'b', string> = {
		a: '#1d4ed8',
		b: '#7c3aed'
	};

	let chatPreviewHover: ChatPreviewHoverState | null = null;
	let chatPreviewTab: ChatPreviewTab = 'contradiction';

	$: chatSegments = buildChatHighlightSegments(structuredContradiction);

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
		analysis: StructuredContradictionAnalysis | null | undefined
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

	function setChatPreviewTab(value: string) {
		const nextTab: ChatPreviewTab = value === 'claims' ? 'claims' : 'contradiction';
		if (chatPreviewTab === nextTab) return;
		chatPreviewTab = nextTab;
		if (nextTab !== 'contradiction') clearChatPreviewHover();
	}

	function clearChatPreviewHover() {
		chatPreviewHover = null;
	}

	function handleChatPreviewSegmentMouseEnter(segment: ChatHighlightSegment, segmentKey: string) {
		const contradictionId = toNonEmptyString(segment.claimId);
		if (!contradictionId) {
			clearChatPreviewHover();
			return;
		}

		if (segment.claimSide) {
			chatPreviewHover = {
				segmentKey,
				contradictionId,
				claimSide: segment.claimSide,
				kind: 'claim'
			};
			return;
		}

		if (segment.category) {
			chatPreviewHover = {
				segmentKey,
				contradictionId,
				claimSide: segment.claimSide ?? null,
				kind: 'highlight'
			};
		}
	}

	function isChatPreviewTooltipOpen(segmentKey: string): boolean {
		if (!chatPreviewHover) return false;
		return chatPreviewHover.segmentKey === segmentKey;
	}

	function isHoveringContradiction(contradictionId?: string): boolean {
		if (!chatPreviewHover || !contradictionId) return false;
		return chatPreviewHover.contradictionId.toLowerCase() === contradictionId.toLowerCase();
	}

	function resolveChatHighlightSegmentStyle(segment: ChatHighlightSegment): string {
		const hoverMatchesContradiction = isHoveringContradiction(segment.claimId);

		if (chatPreviewHover?.kind === 'claim' && chatPreviewHover.claimSide) {
			const claimColor = contradictionClaimSideColors[chatPreviewHover.claimSide];

			if (segment.claimSide === chatPreviewHover.claimSide) {
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

		if (chatPreviewHover?.kind === 'highlight' && hoverMatchesContradiction && segment.category) {
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

<div class="space-y-2">
	<p class="whitespace-pre-wrap">{messageContent}</p>

	{#if structuredContradiction?.highlight_source_text?.trim()}
		<div
			class="rounded-xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/65 to-sky-50/35 px-2.5 py-2.5 shadow-[0_10px_28px_-18px_rgba(15,23,42,0.45)]"
		>
			<Tabs.Root value={chatPreviewTab} onValueChange={setChatPreviewTab} class="gap-1.5">
				<Tabs.List class="h-6 w-full border border-gray-200 bg-white p-[2px]">
					<Tabs.Trigger value="contradiction" class="text-[9px] font-semibold">
						Contradiction
					</Tabs.Trigger>
					<Tabs.Trigger value="claims" class="text-[9px] font-semibold">Snippet</Tabs.Trigger>
				</Tabs.List>

				<Tabs.Content value="contradiction" class="text-[11px]">
					<p
						class="leading-relaxed break-words whitespace-normal text-gray-700"
						onmouseleave={clearChatPreviewHover}
					>
						{#each chatSegments as segment, segmentIndex}
							{#if segment.interactive}
								{@const tooltipData = resolveChatHighlightSegmentTooltip(segment)}
								{@const segmentKey = `segment:${segmentIndex}`}
								{#if tooltipData}
									<Tooltip.Root
										open={isChatPreviewTooltipOpen(segmentKey)}
										onOpenChange={(open) => {
											if (open) {
												handleChatPreviewSegmentMouseEnter(segment, segmentKey);
												return;
											}
											if (isChatPreviewTooltipOpen(segmentKey)) {
												clearChatPreviewHover();
											}
										}}
									>
										<Tooltip.Trigger>
											{#snippet child({ props })}
												<span
													{...props}
													class="inline bg-transparent p-0 text-left align-baseline leading-[inherit] whitespace-normal text-inherit transition-[background-color,border-color,box-shadow,color] duration-150 ease-out hover:cursor-help focus-visible:outline-none"
													onmouseenter={() => handleChatPreviewSegmentMouseEnter(segment, segmentKey)}
													onmouseleave={clearChatPreviewHover}
													onfocus={() => handleChatPreviewSegmentMouseEnter(segment, segmentKey)}
													onblur={clearChatPreviewHover}
												>
													<span
														class="inline rounded-[3px] px-[2px] py-[1px]"
														style={resolveChatHighlightSegmentStyle(segment)}
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
										style={resolveChatHighlightSegmentStyle(segment)}
										onmouseenter={() => handleChatPreviewSegmentMouseEnter(segment, segmentKey)}
										onmouseleave={clearChatPreviewHover}
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
