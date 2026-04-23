<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import { api } from '$lib/api/client';
	import {
		currentDocument,
		error,
		loading,
		paragraphs,
		selectedParagraph
	} from '$lib/stores/document';
	import { getAxiosErrorMessage } from '$lib/utils/http-error';
	import { appendChildren, localName, normalizeEditableText } from '$lib/utils/paragraph';
	import { createRenderer } from '$lib/utils/docx/renderer';
	import { detectDocxNoiseNodeIds } from '$lib/utils/docx/noise';
	import type {
		AssistantChatMessage,
		AssistantChatRequest,
		AssistantMode,
		AssistantProvider,
		AssistantScope,
		ChangeLogState,
		ContradictionAnalysisRequest,
		ContradictionParagraphResult,
		Edge as GraphEdge,
		Node as ParagraphNode,
		ParagraphEditState,
		RelatedParagraph,
		XmlNode,
		SimplifyResultState,
		SimplifyAuditRecord,
		RightPanelTab,
		ContradictionScrollMarker
	} from '$lib/types/document';
	import {
		buildInspectorState,
		createEmptyInspectorState,
		focusNodeFromPanel as focusNodeFromInspectorPanel,
		toSelectedParagraphNode
	} from '$lib/utils/docx/inspector';
	import {
		fetchAssistantResponse,
		fetchBackendGraph,
		fetchContradictionAnalysis,
		fetchSavedContradictions,
		loadBrowserDocx4js,
		resolveDocumentMeta,
		updateRelationBadge
	} from '$lib/utils/docx-page';
	import {
		buildAssistantHistoryPayload,
		buildAssistantNodeSnapshot,
		buildAssistantRelatedContext,
		buildContradictionAiCostQuestion,
		parseStructuredContradictionFromAnswer,
		resolveAssistantSuggestedQuestions
	} from '$lib/utils/docx/assistant';
	import {
		ensureNodeEditState,
		getNodeCurrentText
	} from '$lib/utils/edit';
	import {
		COMMIT_SHORTCUT_HINT,
		COMMIT_SHORTCUT_LABEL,
		COMMIT_SHORTCUT_TOOLTIP,
		EDITABLE_PARAGRAPH_CLASSES,
		MAX_SIMPLIFY_AUDIT_TRAIL,
		CONTRADICTION_OPENAI_MODEL_OPTIONS,
		PARAGRAPH_EXPLANATION_MODEL_OPTIONS,
		CONTRADICTION_TAXONOMY_COLORS,
		CONTRADICTION_TAXONOMY_ORDER,
		CONTRADICTION_TAXONOMY_LABELS,
		CONTRADICTION_CLAIM_SIDE_COLORS,
		MODE_OPTIONS,
		PROVIDER_OPTIONS,
		QUICK_ACTIONS,
		QUICK_ACTION_WHY_CONTRADICTION_AI,
		QUICK_ACTION_WHY_CONTRADICTION_FREE,
		SCOPE_OPTIONS,
		RIGHT_DRAWER_DEFAULT_WIDTH,
		RIGHT_DRAWER_KEYBOARD_STEP,
		RIGHT_DRAWER_MIN_WIDTH,
		RIGHT_DRAWER_MAX_RATIO,
		RIGHT_PANEL_TOOLS,
		FIX_CONTRADICTION_TOP_RELATED
	} from '$lib/constants/docx-viewer';
	import {
		type SimplifyTarget
	} from '$lib/utils/docx/simplify-selection';
	import {
		applyRewriteToParagraph,
		copyRewriteSnippetToClipboard,
		executeFixContradictionRewrite,
		executeSimplifyRewrite,
		getRewriteToolbarPosition,
		resolveActiveRewriteTarget
	} from '$lib/utils/docx/rewrite';
	import AmbiguityAnalysisIcon from '$lib/icons/AmbiguityAnalysisIcon.svelte';
	import CloseIcon from '$lib/icons/CloseIcon.svelte';
	import ContractChatAssistantIcon from '$lib/icons/ContractChatAssistantIcon.svelte';
	import ContradictionAnalysisIcon from '$lib/icons/ContradictionAnalysisIcon.svelte';
	import ParagraphExplanationIcon from '$lib/icons/ParagraphExplanationIcon.svelte';
	import ParagraphRevisionsIcon from '$lib/icons/ParagraphRevisionsIcon.svelte';
	import RedundancyAnalysisIcon from '$lib/icons/RedundancyAnalysisIcon.svelte';
	import RelatedParagraphsIcon from '$lib/icons/RelatedParagraphsIcon.svelte';
	import SummarizeSimplifyIcon from '$lib/icons/SummarizeSimplifyIcon.svelte';
	import {
		RightPanelAmbiguity,
		RightPanelAnalysis,
		RightPanelAssistant,
		RightPanelParagraphExplanation,
		RightPanelRedundancy,
		RightPanelRelated,
		RightPanelRevisions,
		RightPanelSummarize
	} from '$lib/components/docx';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';

	const initialInspectorState = createEmptyInspectorState();
	const nodeEditStateById = new Map<string, ParagraphEditState>();
	const paragraphElementById = new Map<string, HTMLElement>();
const paragraphRelationHostById = new Map<string, HTMLElement>();
const relationsCountByNodeId = new Map<string, number>();
const simplifyAuditTrail: SimplifyAuditRecord[] = [];
const RIGHT_TOOLBAR_COLLAPSED_WIDTH = 42;
const RIGHT_TOOLBAR_EXPANDED_WIDTH = 162;
const TOOL_BRAND_SHORT_NAME = 'ContraGraph';
const MANUAL_SCROLL_DRAG_SPEED = 100;
const GLOBAL_ANALYSIS_MODEL_OPTIONS = Array.from(
	new Map(
		[...CONTRADICTION_OPENAI_MODEL_OPTIONS, ...PARAGRAPH_EXPLANATION_MODEL_OPTIONS].map(
			(option) => [option.value, option]
		)
	).values()
);
const GLOBAL_MODEL_FONT_SIZE_PX = 10;
const GLOBAL_MODEL_TRIGGER_EXTRA_PX = 30;
const GLOBAL_MODEL_ITEM_CHECK_EXTRA_PX = 34;
const GLOBAL_MODEL_MIN_WIDTH_PX = 92;

	let viewer: HTMLDivElement | null = null;
	let documentScrollHost: HTMLElement | null = null;
	let assistantThread: HTMLElement | null = null;
	let activeDocumentId: string | null = null;
	let activeDocumentName = '';
	let localError: string | null = null;
	let renderToken = 0;
	let releaseDoc: (() => void) | null = null;
	let selectedNodeId: string | null = initialInspectorState.selectedNodeId;
	let selectedChangeLog: ChangeLogState = initialInspectorState.selectedChangeLog;
	let selectedRelatedParagraphs: RelatedParagraph[] =
		initialInspectorState.selectedRelatedParagraphs;
	let backendEdges: GraphEdge[] = [];
	let backendGraphLoading = false;
	let graphComputationToken = 0;

	let assistantMode: AssistantMode = 'explain';
	let assistantScope: AssistantScope = 'selected';
	let assistantProvider: AssistantProvider = 'openai';
	let assistantInput = '';
	let assistantMessages: AssistantChatMessage[] = [];
	let assistantLoading = false;
	let assistantError: string | null = null;
	let assistantMessageCounter = 0;
	let selectedQuickAction = '';
	let simplifyToolbarVisible = false;
	let simplifyToolbarTop = 0;
	let simplifyToolbarLeft = 0;
	let simplifyTarget: SimplifyTarget | null = null;
	let simplifyResult: SimplifyResultState | null = null;
	let latestRewriteSource: 'simplify' | 'fix' | null = null;
	let simplifyLoading = false;
	let fixContradictionLoading = false;
	let simplifyError: string | null = null;

	let contradictionLoading = false;
	let contradictionError: string | null = null;
	let contradictionSource: string | null = null;
	let globalAnalysisModel = 'gpt-4.1';
	let globalModelSelectWidthPx = GLOBAL_MODEL_MIN_WIDTH_PX;
	let contradictionResultsByParagraphId = new Map<string, ContradictionParagraphResult>();
	let contradictionScrollMarkers: ContradictionScrollMarker[] = [];
	let selectedContradictionEvidenceLink:
		| {
				topPx: number;
				bottomPx: number;
				leftPx: number;
				showA: boolean;
				showB: boolean;
				aCenterPx: number;
				bCenterPx: number;
		  }
		| null = null;
	let contradictionMarkerFrame: number | null = null;
	let contradictionMarkerResizeObserver: ResizeObserver | null = null;
	let selectedContradictionResult: ContradictionParagraphResult | null = null;
	let selectedContradictionEvidence: ContradictionParagraphResult['evidence'] = null;
	let contradictionSummaryVisible = true;
	let paragraphExplanationLoading = false;
	let paragraphExplanationError: string | null = null;
	let paragraphExplanationAnswer = '';
	let paragraphExplanationCitations: Array<{
		id: string;
		excerpt: string;
		page?: number;
		paragraph_enum?: number;
	}> = [];
	let paragraphExplanationConnectors: Array<{
		topPx: number;
		bottomPx: number;
		leftPx: number;
		selectedCapTopPx: number;
		relatedCapTopPx: number;
		paragraphId: string;
	}> = [];
	let paragraphExplanationScrollMarkers: Array<{
		paragraphId: string;
		topPercent: number;
	}> = [];
	let paragraphExplanationFrame: number | null = null;
	let paragraphExplanationRelatedParagraphs: RelatedParagraph[] = [];
	let isManualScrollDragging = false;
	let manualScrollStartY = 0;
	let manualScrollStartTop = 0;
	let manualScrollMoved = false;
	let suppressMarkerClickUntil = 0;

	let activeRightPanelTab: RightPanelTab = 'related';
	let isRightDrawerOpen = true;
	let sidebarLabelsPinned = false;
	let isCompactLayout = false;
	let rightDrawerWidth = RIGHT_DRAWER_DEFAULT_WIDTH;
	let isResizingRightDrawer = false;
	$: shouldShowContradictionDecorations =
		activeRightPanelTab === 'analysis' && isRightDrawerOpen;
	$: shouldShowParagraphExplanationDecorations =
		activeRightPanelTab === 'paragraph_explanation' && isRightDrawerOpen;
	$: activeDrawerWidth = !isCompactLayout && isRightDrawerOpen ? rightDrawerWidth : 0;
	$: activeSidebarWidth = sidebarLabelsPinned
		? RIGHT_TOOLBAR_EXPANDED_WIDTH
		: RIGHT_TOOLBAR_COLLAPSED_WIDTH;

	$: contradictionCount = Array.from(contradictionResultsByParagraphId.values()).filter(
		(row) => row.contradiction
	).length;
	$: selectedContradictionResult = $selectedParagraph
		? (contradictionResultsByParagraphId.get($selectedParagraph.id) ?? null)
		: null;
	$: selectedContradictionEvidence =
		selectedContradictionResult?.contradiction && selectedContradictionResult.evidence
			? selectedContradictionResult.evidence
			: null;

	$: relatedProcessingSteps = [
		{
			label: 'Scanning document structure',
			active: backendGraphLoading
		},
		{
			label: 'Analyzing paragraph relations',
			active: backendGraphLoading
		},
		{
			label: 'Searching linked context',
			active: backendGraphLoading
		}
	];
	$: revisionProcessingSteps = [
		{
			label: 'Scanning selected paragraph',
			active: contradictionLoading
		},
		{
			label: 'Analyzing conflict candidates',
			active: contradictionLoading
		},
		{
			label: 'Searching contradiction evidence',
			active: contradictionLoading
		}
	];
	$: assistantProviderLabel =
		PROVIDER_OPTIONS.find((option) => option.value === assistantProvider)?.label ?? 'Provider';
	$: assistantModeLabel =
		MODE_OPTIONS.find((option) => option.value === assistantMode)?.label ?? 'Mode';
	$: assistantScopeLabel =
		SCOPE_OPTIONS.find((option) => option.value === assistantScope)?.label ?? 'Scope';
	$: quickActionLabel = selectedQuickAction || 'Quick action';
	$: paragraphExplanationRelatedParagraphs = [...selectedRelatedParagraphs]
		.sort((left, right) => {
			const leftReference = left.relationTypes.includes('reference') ? 1 : 0;
			const rightReference = right.relationTypes.includes('reference') ? 1 : 0;
			if (rightReference !== leftReference) return rightReference - leftReference;

			const leftSemantic = left.semanticScore ?? 0;
			const rightSemantic = right.semanticScore ?? 0;
			if (rightSemantic !== leftSemantic) return rightSemantic - leftSemantic;

			const leftReferences = left.references.length;
			const rightReferences = right.references.length;
			if (rightReferences !== leftReferences) return rightReferences - leftReferences;

			return left.node.paragraph_enum - right.node.paragraph_enum;
		})
		.slice(0, 5);
	$: {
		if (shouldShowContradictionDecorations) {
			applyContradictionHighlights();
		} else {
			clearContradictionHighlights();
			contradictionScrollMarkers = [];
			selectedContradictionEvidenceLink = null;
		}
	}
	$: {
		const selectedId = $selectedParagraph?.id ?? '';
		const relatedIds = paragraphExplanationRelatedParagraphs
			.map((related) => related.node.id)
			.join('|');
		void selectedId;
		void relatedIds;
		if (shouldShowParagraphExplanationDecorations) {
			applyParagraphExplanationHighlights();
			scheduleParagraphExplanationConnectorRefresh();
		} else {
			clearParagraphExplanationHighlights();
		}
	}
	$: {
		const selectedId = $selectedParagraph?.id ?? '';
		const tabId = activeRightPanelTab;
		const relatedIds = selectedRelatedParagraphs.map((related) => related.node.id).join('|');
		void selectedId;
		void tabId;
		void relatedIds;
		applyRelatedSelectionHighlight();
	}

	function toTitleCaseLabel(label: string): string {
		return label.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
	}

	function refreshInspector(selectedNode: ParagraphNode | null = get(selectedParagraph)) {
		const nextState = buildInspectorState({
			selectedNode,
			paragraphNodes: get(paragraphs),
			backendEdges,
			paragraphElementById,
			nodeEditStateById
		});
		selectedNodeId = nextState.selectedNodeId;
		selectedChangeLog = nextState.selectedChangeLog;
		selectedRelatedParagraphs = nextState.selectedRelatedParagraphs;
	}

	function setSelectedParagraphNode(selectedNode: ParagraphNode | null) {
		const nodeWithCurrent = toSelectedParagraphNode(selectedNode, nodeEditStateById);
		selectedParagraph.set(nodeWithCurrent);
		refreshInspector(nodeWithCurrent);
		void tick().then(() => {
			refreshSimplifyTarget();
			applyContradictionHighlights();
		});
	}

	function clearRelatedSelectionHighlight() {
		for (const element of paragraphElementById.values()) {
			element.classList.remove(
				'docx-related-selected',
				'docx-related-linked',
				'docx-related-context',
				'docx-related-context--with-sub',
				'docx-related-context--reference',
				'docx-related-context--similarity'
			);
			delete element.dataset.relatedLabel;
			delete element.dataset.relatedSub;
		}
		for (const host of paragraphRelationHostById.values()) {
			host.classList.remove(
				'docx-related-badge-emphasis',
				'docx-related-badge--reference',
				'docx-related-badge--similarity'
			);
		}
	}

	function resolveRelatedVisualMeta(related: RelatedParagraph): {
		kind: 'reference' | 'similarity';
		label: string;
		subLabel?: string;
	} {
		const hasSimilarityByType = related.relationTypes.some((relationType) =>
			String(relationType).toLowerCase().includes('semantic')
		);
		const hasSimilarityByScore =
			typeof related.semanticScore === 'number' && Number.isFinite(related.semanticScore);
		const hasSimilarity = hasSimilarityByType || hasSimilarityByScore;
		const isReference =
			related.relationTypes.some((relationType) =>
				String(relationType).toLowerCase().includes('reference')
			) || related.references.length > 0;
		const similarityScore = Math.round((related.semanticScore ?? 0) * 100);
		if (hasSimilarity && similarityScore > 0) {
			return {
				kind: 'similarity',
				label: 'Similarity',
				subLabel: `${similarityScore}%`
			};
		}
		if (hasSimilarity) {
			return { kind: 'similarity', label: 'Similarity' };
		}
		if (isReference) {
			return { kind: 'reference', label: 'Reference' };
		}
		return { kind: 'reference', label: 'Reference' };
	}

	function applyRelatedSelectionHighlight() {
		clearRelatedSelectionHighlight();
		if (activeRightPanelTab !== 'related') return;
		const selected = get(selectedParagraph);
		if (!selected?.id) return;
		const selectedElement = paragraphElementById.get(selected.id);
		selectedElement?.classList.add('docx-related-selected', 'docx-related-linked');
		paragraphRelationHostById.get(selected.id)?.classList.add('docx-related-badge-emphasis');
		for (const related of selectedRelatedParagraphs) {
			const relatedElement = paragraphElementById.get(related.node.id);
			if (!relatedElement) continue;
			const visualMeta = resolveRelatedVisualMeta(related);
			relatedElement.classList.add('docx-related-linked', 'docx-related-context');
			if (visualMeta.subLabel) {
				relatedElement.classList.add('docx-related-context--with-sub');
			}
			relatedElement.classList.add(
				visualMeta.kind === 'reference'
					? 'docx-related-context--reference'
					: 'docx-related-context--similarity'
			);
			relatedElement.dataset.relatedLabel = visualMeta.label;
			if (visualMeta.subLabel) {
				relatedElement.dataset.relatedSub = visualMeta.subLabel;
			}
			paragraphRelationHostById.get(related.node.id)?.classList.add(
				'docx-related-badge-emphasis',
				visualMeta.kind === 'reference'
					? 'docx-related-badge--reference'
					: 'docx-related-badge--similarity'
			);
		}
	}

	function flashCitationTarget(nodeId: string) {
		const element = paragraphElementById.get(nodeId);
		if (!element) return;

		element.classList.remove('docx-citation-flash');
		void element.offsetHeight;
		element.classList.add('docx-citation-flash');
		window.setTimeout(() => {
			element.classList.remove('docx-citation-flash');
		}, 1300);
	}

	function focusNodeFromPanel(nodeId: string, emphasize = false) {
		focusNodeFromInspectorPanel({
			nodeId,
			paragraphNodes: get(paragraphs),
			paragraphElementById,
			onFallbackFocus: setSelectedParagraphNode
		});
		if (emphasize) flashCitationTarget(nodeId);
	}

	function jumpToNodeWithoutSelecting(nodeId: string) {
		const element = paragraphElementById.get(nodeId);
		if (!element) return;
		element.scrollIntoView({ behavior: 'smooth', block: 'center' });
		flashCitationTarget(nodeId);
	}

	function resetInspectorState() {
		graphComputationToken += 1;
		backendEdges = [];
		backendGraphLoading = false;
		relationsCountByNodeId.clear();
		const resetState = buildInspectorState({
			selectedNode: null,
			paragraphNodes: [],
			backendEdges: [],
			paragraphElementById,
			nodeEditStateById
		});
		selectedNodeId = resetState.selectedNodeId;
		selectedChangeLog = resetState.selectedChangeLog;
		selectedRelatedParagraphs = resetState.selectedRelatedParagraphs;
		nodeEditStateById.clear();
		paragraphElementById.clear();
		paragraphRelationHostById.clear();
		resetSimplifyState();
	}

	function resetAssistantState() {
		assistantInput = '';
		assistantMessages = [];
		assistantLoading = false;
		assistantError = null;
	}

	function resetParagraphExplanationState() {
		paragraphExplanationError = null;
		paragraphExplanationAnswer = '';
		paragraphExplanationCitations = [];
		paragraphExplanationLoading = false;
	}

	function clearSnippetMarks(element: HTMLElement) {
		const marks = element.querySelectorAll('mark.docx-contradiction-snippet');
		for (const mark of marks) {
			const parent = mark.parentNode;
			if (!parent) continue;
			while (mark.firstChild) {
				parent.insertBefore(mark.firstChild, mark);
			}
			parent.removeChild(mark);
		}
	}

	function findTextNodePosition(
		segments: Array<{ node: Text; start: number; end: number }>,
		index: number
	): { node: Text; offset: number } | null {
		for (const segment of segments) {
			if (index >= segment.start && index <= segment.end) {
				return { node: segment.node, offset: index - segment.start };
			}
		}
		return null;
	}

	function highlightSnippetInElement(
		element: HTMLElement,
		rawSnippet: string,
		meta?: { ownerParagraphId?: string; role?: 'a' | 'b' }
	): boolean {
		const snippet = rawSnippet.trim();
		if (!snippet) return false;

		const textContent = element.textContent ?? '';
		if (!textContent) return false;

		const matchStart = textContent.toLocaleLowerCase().indexOf(snippet.toLocaleLowerCase());
		if (matchStart === -1) return false;
		const matchEnd = matchStart + snippet.length;

		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const segments: Array<{ node: Text; start: number; end: number }> = [];
		let cursor = 0;
		let current = walker.nextNode();
		while (current) {
			const textNode = current as Text;
			const length = textNode.nodeValue?.length ?? 0;
			if (length > 0) {
				segments.push({ node: textNode, start: cursor, end: cursor + length });
				cursor += length;
			}
			current = walker.nextNode();
		}

		const startPos = findTextNodePosition(segments, matchStart);
		const endPos = findTextNodePosition(segments, matchEnd);
		if (!startPos || !endPos) return false;

		const range = document.createRange();
		range.setStart(startPos.node, startPos.offset);
		range.setEnd(endPos.node, endPos.offset);
		if (range.collapsed) return false;

		const mark = document.createElement('mark');
		mark.className = 'docx-contradiction-snippet';
		if (meta?.ownerParagraphId) {
			mark.dataset.contradictionOwner = meta.ownerParagraphId;
		}
		if (meta?.role) {
			mark.dataset.contradictionRole = meta.role;
		}
		try {
			range.surroundContents(mark);
		} catch {
			const extracted = range.extractContents();
			mark.appendChild(extracted);
			range.insertNode(mark);
		}

		return true;
	}

	function highlightSnippetAcrossDocument(
		snippet: string,
		preferredElement?: HTMLElement,
		meta?: { ownerParagraphId?: string; role?: 'a' | 'b' }
	): boolean {
		if (!snippet.trim()) return false;

		if (preferredElement && highlightSnippetInElement(preferredElement, snippet, meta)) {
			return true;
		}

		for (const element of paragraphElementById.values()) {
			if (preferredElement && element === preferredElement) continue;
			if (highlightSnippetInElement(element, snippet, meta)) {
				return true;
			}
		}

		return false;
	}

	function updateActiveContradictionSnippetMarks() {
		const allMarks = document.querySelectorAll<HTMLElement>('mark.docx-contradiction-snippet');
		for (const mark of allMarks) {
			mark.classList.remove('docx-contradiction-snippet--active');
		}

		const selected = get(selectedParagraph);
		if (!selected?.id) return;
		if (!contradictionResultsByParagraphId.get(selected.id)?.contradiction) return;

		for (const mark of allMarks) {
			if (mark.dataset.contradictionOwner === selected.id) {
				mark.classList.add('docx-contradiction-snippet--active');
			}
		}
	}

	function focusEvidenceSnippet(paragraphId: string, role: 'a' | 'b') {
		let targetMark: HTMLElement | null = null;
		const allMarks = document.querySelectorAll<HTMLElement>('mark.docx-contradiction-snippet');
		for (const mark of allMarks) {
			if (
				mark.dataset.contradictionOwner === paragraphId &&
				mark.dataset.contradictionRole === role
			) {
				targetMark = mark;
				break;
			}
		}

		if (targetMark) {
			targetMark.scrollIntoView({ behavior: 'smooth', block: 'center' });
			targetMark.classList.add('docx-contradiction-snippet--active');
			window.setTimeout(() => {
				targetMark?.classList.remove('docx-citation-flash');
				targetMark?.classList.add('docx-citation-flash');
			}, 80);
			return;
		}

		focusNodeFromPanel(paragraphId, true);
	}

	function clearContradictionHighlights() {
		selectedContradictionEvidenceLink = null;
		for (const element of paragraphElementById.values()) {
			element.classList.remove('docx-contradiction-highlight', 'docx-contradiction-selected');
			clearSnippetMarks(element);
			delete element.dataset.contradictionConfidenceBand;
			delete element.dataset.contradictionConfidence;
			delete element.dataset.contradictionReason;
		}
	}

	function resolveContradictionConfidenceBand(
		confidence: number
	): ContradictionScrollMarker['confidenceBand'] {
		let confidenceBand: ContradictionScrollMarker['confidenceBand'] = 'low';
		if (confidence >= 80) confidenceBand = 'high';
		else if (confidence >= 50) confidenceBand = 'medium';
		return confidenceBand;
	}

	function refreshContradictionScrollMarkers() {
		if (!documentScrollHost || contradictionResultsByParagraphId.size === 0) {
			contradictionScrollMarkers = [];
			selectedContradictionEvidenceLink = null;
			return;
		}

		const hostRect = documentScrollHost.getBoundingClientRect();
		const hostScrollHeight = documentScrollHost.scrollHeight;
		if (!Number.isFinite(hostScrollHeight) || hostScrollHeight <= 0) {
			contradictionScrollMarkers = [];
			selectedContradictionEvidenceLink = null;
			return;
		}

		const nextMarkers: ContradictionScrollMarker[] = [];

		for (const [paragraphId, result] of contradictionResultsByParagraphId.entries()) {
			if (!result.contradiction) continue;
			const element = paragraphElementById.get(paragraphId);
			if (!element) continue;

			const confidenceBand = resolveContradictionConfidenceBand(result.confidence);
			const centerOffset = element.offsetTop + element.offsetHeight / 2;
			const rawTopPercent = (centerOffset / hostScrollHeight) * 100;
			const topPercent = Math.min(99.6, Math.max(0.4, rawTopPercent));

			nextMarkers.push({
				paragraphId,
				topPercent,
				confidenceBand
			});
		}

		nextMarkers.sort((left, right) => left.topPercent - right.topPercent);
		contradictionScrollMarkers = nextMarkers;

		const selected = get(selectedParagraph);
		if (!selected?.id || !contradictionResultsByParagraphId.get(selected.id)?.contradiction) {
			selectedContradictionEvidenceLink = null;
			return;
		}

		let markA: HTMLElement | null = null;
		let markB: HTMLElement | null = null;
		const allMarks = document.querySelectorAll<HTMLElement>('mark.docx-contradiction-snippet');
		for (const mark of allMarks) {
			if (mark.dataset.contradictionOwner !== selected.id) continue;
			if (!markA && mark.dataset.contradictionRole === 'a') {
				markA = mark;
			}
			if (!markB && mark.dataset.contradictionRole === 'b') {
				markB = mark;
			}
			if (markA && markB) break;
		}

		if (!markA || !markB) {
			selectedContradictionEvidenceLink = null;
			return;
		}

		const markARect = markA.getBoundingClientRect();
		const markBRect = markB.getBoundingClientRect();
		const aCenterPx = markARect.top - hostRect.top + markARect.height / 2;
		const bCenterPx = markBRect.top - hostRect.top + markBRect.height / 2;
		const showA = aCenterPx >= 0 && aCenterPx <= hostRect.height;
		const showB = bCenterPx >= 0 && bCenterPx <= hostRect.height;
		const clampedACenterPx = Math.max(0, Math.min(hostRect.height, aCenterPx));
		const clampedBCenterPx = Math.max(0, Math.min(hostRect.height, bCenterPx));
		const topPx = Math.min(clampedACenterPx, clampedBCenterPx);
		const bottomPx = Math.max(clampedACenterPx, clampedBCenterPx);
		if (bottomPx - topPx < 2) {
			selectedContradictionEvidenceLink = null;
			return;
		}
		const rightEdge = Math.max(markARect.right, markBRect.right);
		const leftPx = Math.max(8, rightEdge - hostRect.left + 16);
		selectedContradictionEvidenceLink = {
			topPx,
			bottomPx,
			leftPx,
			showA,
			showB,
			aCenterPx,
			bCenterPx
		};
	}

	function scheduleContradictionScrollMarkerRefresh() {
		if (typeof window === 'undefined') return;
		if (contradictionMarkerFrame != null) {
			window.cancelAnimationFrame(contradictionMarkerFrame);
		}
		contradictionMarkerFrame = window.requestAnimationFrame(() => {
			contradictionMarkerFrame = null;
			refreshContradictionScrollMarkers();
		});
	}

	function jumpToContradictionParagraph(paragraphId: string) {
		if (Date.now() < suppressMarkerClickUntil) return;
		focusNodeFromPanel(paragraphId, true);
	}

	function applyContradictionHighlights() {
		clearContradictionHighlights();

		for (const [paragraphId, result] of contradictionResultsByParagraphId.entries()) {
			if (!result.contradiction) continue;
			const element = paragraphElementById.get(paragraphId);
			if (!element) continue;

			const confidenceBand = resolveContradictionConfidenceBand(result.confidence);

			element.classList.add('docx-contradiction-highlight');
			element.dataset.contradictionConfidenceBand = confidenceBand;
			element.dataset.contradictionConfidence = String(result.confidence);
			element.dataset.contradictionReason = result.brief_reason ?? '';

			const evidence = result.evidence;
			if (evidence?.snippet_a?.trim()) {
				if (evidence.source_a === 'context') {
					highlightSnippetAcrossDocument(evidence.snippet_a, element, {
						ownerParagraphId: paragraphId,
						role: 'a'
					});
				} else {
					highlightSnippetInElement(element, evidence.snippet_a, {
						ownerParagraphId: paragraphId,
						role: 'a'
					}) ||
						highlightSnippetAcrossDocument(evidence.snippet_a, element, {
							ownerParagraphId: paragraphId,
							role: 'a'
						});
				}
			}
			if (evidence?.snippet_b?.trim()) {
				if (evidence.source_b === 'context') {
					highlightSnippetAcrossDocument(evidence.snippet_b, element, {
						ownerParagraphId: paragraphId,
						role: 'b'
					});
				} else {
					highlightSnippetInElement(element, evidence.snippet_b, {
						ownerParagraphId: paragraphId,
						role: 'b'
					}) ||
						highlightSnippetAcrossDocument(evidence.snippet_b, element, {
							ownerParagraphId: paragraphId,
							role: 'b'
						});
				}
			}
		}

		const selected = get(selectedParagraph);
		if (selected?.id && contradictionResultsByParagraphId.get(selected.id)?.contradiction) {
			paragraphElementById.get(selected.id)?.classList.add('docx-contradiction-selected');
		}
		updateActiveContradictionSnippetMarks();

		scheduleContradictionScrollMarkerRefresh();
	}

	function clearParagraphExplanationHighlights() {
		paragraphExplanationConnectors = [];
		paragraphExplanationScrollMarkers = [];
		for (const element of paragraphElementById.values()) {
			element.classList.remove(
				'docx-paragraph-explanation-selected',
				'docx-paragraph-explanation-related'
			);
		}
	}

	function applyParagraphExplanationHighlights() {
		clearParagraphExplanationHighlights();
		if (!shouldShowParagraphExplanationDecorations) return;

		const selected = get(selectedParagraph);
		if (!selected?.id) return;
		paragraphElementById.get(selected.id)?.classList.add('docx-paragraph-explanation-selected');
		for (const related of paragraphExplanationRelatedParagraphs) {
			paragraphElementById
				.get(related.node.id)
				?.classList.add('docx-paragraph-explanation-related');
		}
	}

	function refreshParagraphExplanationConnectorPaths() {
		if (!documentScrollHost || !shouldShowParagraphExplanationDecorations) {
			paragraphExplanationConnectors = [];
			paragraphExplanationScrollMarkers = [];
			return;
		}

		const selected = get(selectedParagraph);
		if (!selected?.id) {
			paragraphExplanationConnectors = [];
			paragraphExplanationScrollMarkers = [];
			return;
		}

		const selectedElement = paragraphElementById.get(selected.id);
		if (!selectedElement) {
			paragraphExplanationConnectors = [];
			paragraphExplanationScrollMarkers = [];
			return;
		}

		const hostRect = documentScrollHost.getBoundingClientRect();
		const selectedRect = selectedElement.getBoundingClientRect();
		const selectedY = selectedRect.top - hostRect.top + selectedRect.height / 2;
		const baseLeft = Math.max(12, selectedRect.right - hostRect.left + 16);

		const anchors: Array<{ y: number; paragraphId: string }> = [];
		for (const related of paragraphExplanationRelatedParagraphs) {
			const relatedElement = paragraphElementById.get(related.node.id);
			if (!relatedElement) continue;
			const relatedRect = relatedElement.getBoundingClientRect();
			const relatedY = relatedRect.top - hostRect.top + relatedRect.height / 2;
			anchors.push({ y: relatedY, paragraphId: related.node.id });
		}

		if (anchors.length === 0) {
			paragraphExplanationConnectors = [];
			paragraphExplanationScrollMarkers = [];
			return;
		}

		const sortedAnchors = [...anchors].sort(
			(left, right) =>
				Math.abs(left.y - selectedY) - Math.abs(right.y - selectedY) ||
				left.y - right.y
		);
		let laneCounter = 0;
		const nextConnectors: Array<{
			topPx: number;
			bottomPx: number;
			leftPx: number;
			selectedCapTopPx: number;
			relatedCapTopPx: number;
			paragraphId: string;
		}> = [];
		for (const anchor of sortedAnchors) {
			// Keep connector anchors tied to real paragraph positions.
			// We intentionally avoid clamping to viewport edges so the line does not "snap"
			// when one paragraph goes out of view.
			const selectedCenter = selectedY;
			const relatedCenter = anchor.y;
			const topPx = Math.min(selectedCenter, relatedCenter);
			const bottomPx = Math.max(selectedCenter, relatedCenter);
			if (bottomPx - topPx < 2) continue;
			const leftPx = baseLeft + laneCounter * 8;
			laneCounter += 1;
			nextConnectors.push({
				topPx,
				bottomPx,
				leftPx,
				selectedCapTopPx: selectedCenter,
				relatedCapTopPx: relatedCenter,
				paragraphId: anchor.paragraphId
			});
		}

		paragraphExplanationConnectors = nextConnectors;

		const hostScrollHeight = documentScrollHost.scrollHeight;
		if (!Number.isFinite(hostScrollHeight) || hostScrollHeight <= 0) {
			paragraphExplanationScrollMarkers = [];
			return;
		}
		const nextScrollMarkers: Array<{ paragraphId: string; topPercent: number }> = [];
		for (const related of paragraphExplanationRelatedParagraphs) {
			const relatedElement = paragraphElementById.get(related.node.id);
			if (!relatedElement) continue;
			const relatedRect = relatedElement.getBoundingClientRect();
			const centerOffset =
				relatedRect.top - hostRect.top + documentScrollHost.scrollTop + relatedRect.height / 2;
			const rawTopPercent = (centerOffset / hostScrollHeight) * 100;
			const topPercent = Math.min(99.6, Math.max(0.4, rawTopPercent));
			nextScrollMarkers.push({ paragraphId: related.node.id, topPercent });
		}
		nextScrollMarkers.sort((left, right) => left.topPercent - right.topPercent);
		paragraphExplanationScrollMarkers = nextScrollMarkers;
	}

	function scheduleParagraphExplanationConnectorRefresh() {
		if (typeof window === 'undefined') return;
		if (paragraphExplanationFrame != null) return;
		paragraphExplanationFrame = window.requestAnimationFrame(() => {
			paragraphExplanationFrame = null;
			refreshParagraphExplanationConnectorPaths();
		});
	}

	function jumpToRelatedParagraphMarker(paragraphId: string) {
		if (Date.now() < suppressMarkerClickUntil) return;
		const element = paragraphElementById.get(paragraphId);
		if (!element) return;
		element.scrollIntoView({ behavior: 'smooth', block: 'center' });
		element.classList.remove('docx-citation-flash');
		void element.offsetHeight;
		element.classList.add('docx-citation-flash');
	}

	function handleManualScrollDragMove(event: MouseEvent) {
		if (!isManualScrollDragging || !documentScrollHost) return;
		const delta = (event.clientY - manualScrollStartY) * MANUAL_SCROLL_DRAG_SPEED;
		if (Math.abs(delta) > 2) manualScrollMoved = true;
		documentScrollHost.scrollTop = manualScrollStartTop + delta;
	}

	function stopManualScrollDrag() {
		if (!isManualScrollDragging) return;
		isManualScrollDragging = false;
		window.removeEventListener('mousemove', handleManualScrollDragMove);
		window.removeEventListener('mouseup', stopManualScrollDrag);
		document.body.style.userSelect = '';
		scheduleContradictionScrollMarkerRefresh();
		scheduleParagraphExplanationConnectorRefresh();
		if (manualScrollMoved) {
			suppressMarkerClickUntil = Date.now() + 140;
		}
	}

	function startManualScrollDrag(event: MouseEvent) {
		if (!documentScrollHost || event.button !== 0) return;
		if (isManualScrollDragging) return;
		event.preventDefault();
		isManualScrollDragging = true;
		manualScrollMoved = false;
		manualScrollStartY = event.clientY;
		manualScrollStartTop = documentScrollHost.scrollTop;
		document.body.style.userSelect = 'none';
		window.addEventListener('mousemove', handleManualScrollDragMove);
		window.addEventListener('mouseup', stopManualScrollDrag);
	}

	function setContradictionResults(results: ContradictionParagraphResult[], source: string | null) {
		const next = new Map<string, ContradictionParagraphResult>();
		for (const row of results) {
			next.set(String(row.paragraph_id), row);
		}
		contradictionResultsByParagraphId = next;
		contradictionSource = source;
		contradictionSummaryVisible = true;
		applyContradictionHighlights();
	}

	function setContradictionErrorMessage(message: string | null) {
		contradictionError = message;
		if (message) contradictionSummaryVisible = true;
	}

	function buildContradictionAnalysisPayload(): ContradictionAnalysisRequest | null {
		if (!activeDocumentId) return null;
		const selectedModel = globalAnalysisModel.trim();

		const nodes = get(paragraphs).map((node) => ({
			...node,
			text: getNodeCurrentText(nodeEditStateById, node),
			relationsCount: relationsCountByNodeId.get(node.id) ?? node.relationsCount
		}));

		if (nodes.length === 0) return null;

		return {
			documentId: activeDocumentId,
			provider: 'openai',
			temperature: 0.3,
			model: selectedModel || undefined,
			graph: {
				nodes,
				edges: backendEdges
			}
		};
	}

	async function loadSavedContradictions() {
		activeRightPanelTab = 'analysis';
		isRightDrawerOpen = true;

		if (!activeDocumentId) {
			setContradictionErrorMessage('No document is loaded.');
			return;
		}

		contradictionLoading = true;
		setContradictionErrorMessage(null);
		try {
			const response = await fetchSavedContradictions(activeDocumentId);
			setContradictionResults(response.paragraphResults ?? [], response.sourceFile);
		} catch (savedError) {
			setContradictionErrorMessage(
				getAxiosErrorMessage(savedError, 'Failed to load saved contradictions.')
			);
		} finally {
			contradictionLoading = false;
		}
	}

	async function searchContradictionsWithLlm() {
		activeRightPanelTab = 'analysis';
		isRightDrawerOpen = true;

		if (backendGraphLoading) {
			setContradictionErrorMessage(
				'Wait until graph generation finishes before searching contradictions.'
			);
			return;
		}

		const payload = buildContradictionAnalysisPayload();
		if (!payload) {
			setContradictionErrorMessage('No paragraph context is available yet.');
			return;
		}

		contradictionLoading = true;
		setContradictionErrorMessage(null);
		try {
			const response = await fetchContradictionAnalysis(payload);
			const resolvedModel = response.model?.trim() || payload.model || 'default';
			setContradictionResults(response.paragraphResults ?? [], `llm:openai:${resolvedModel}`);
		} catch (analysisError) {
			setContradictionErrorMessage(
				getAxiosErrorMessage(analysisError, 'Failed to search contradictions with LLM.')
			);
		} finally {
			contradictionLoading = false;
		}
	}

	function clearRelationBadgeHost(host: HTMLElement) {
		host.classList.remove('docx-relations-badge-host');
		delete host.dataset.relationsCount;
		delete host.dataset.relationsTone;
	}

	function freezeIgnoredParagraphElement(element: HTMLElement) {
		element.dataset.ignoredParagraph = 'true';
		element.removeAttribute('contenteditable');
		element.removeAttribute('spellcheck');
		element.removeAttribute('data-node-id');
		element.removeAttribute('data-paragraph-kind');
		element.classList.remove(...EDITABLE_PARAGRAPH_CLASSES);
	}

	function nextAssistantMessageId() {
		assistantMessageCounter += 1;
		return `assistant-${assistantMessageCounter}`;
	}

	async function scrollAssistantToBottom() {
		await tick();
		assistantThread?.scrollTo({ top: assistantThread.scrollHeight, behavior: 'smooth' });
	}

	function handleAssistantInputKeydown(event: KeyboardEvent) {
		if (event.key !== 'Enter' || event.shiftKey) return;
		event.preventDefault();
		void submitAssistantQuestion();
	}

	type SubmitAssistantQuestionOptions = {
		mode?: AssistantMode;
		scope?: AssistantScope;
	};

	async function submitAssistantQuestion(
		questionOverride?: string,
		options?: SubmitAssistantQuestionOptions
	) {
		if (assistantLoading) return;

		const question = (questionOverride ?? assistantInput).trim();
		if (!question) return;
		if (!activeDocumentId) {
			assistantError = 'No document is loaded.';
			return;
		}

		const paragraphNodes = buildAssistantNodeSnapshot(get(paragraphs), nodeEditStateById);
		if (paragraphNodes.length === 0) {
			assistantError = 'The contract is still loading.';
			return;
		}

		const selected = get(selectedParagraph);
		const resolvedScope = options?.scope ?? assistantScope;
		const resolvedMode = options?.mode ?? assistantMode;
		if (resolvedScope === 'selected' && !selected) {
			assistantError = 'Select a paragraph before asking in selected-paragraph mode.';
			return;
		}

		assistantError = null;
		assistantMessages = [
			...assistantMessages,
			{
				id: nextAssistantMessageId(),
				role: 'user',
				content: question
			}
		];
		assistantInput = questionOverride ? assistantInput : '';
		assistantLoading = true;
		await scrollAssistantToBottom();

		const payload: AssistantChatRequest = {
			documentId: activeDocumentId,
			question,
			mode: resolvedMode,
			scope: resolvedScope,
			provider: assistantProvider,
			model: globalAnalysisModel.trim() || undefined,
			selectedParagraphId: selected?.id ?? null,
			relatedParagraphs: buildAssistantRelatedContext(selectedRelatedParagraphs),
			paragraphNodes,
			history: buildAssistantHistoryPayload(assistantMessages)
		};

		try {
			const response = await fetchAssistantResponse(payload);
			assistantMessages = [
				...assistantMessages,
				{
					id: nextAssistantMessageId(),
					role: 'assistant',
					content: response.answer,
					citations: response.citations,
					suggestedQuestions: resolveAssistantSuggestedQuestions(response.suggestedQuestions, {
						mode: resolvedMode,
						scope: resolvedScope
					})
				}
			];
		} catch (assistantRequestError) {
			const message = getAxiosErrorMessage(assistantRequestError, 'Failed to generate a response.');
			assistantError = message;
			assistantMessages = [
				...assistantMessages,
				{
					id: nextAssistantMessageId(),
					role: 'assistant',
					content: `I could not complete this request: ${message}`
				}
			];
		} finally {
			assistantLoading = false;
			await scrollAssistantToBottom();
		}
	}

	async function submitParagraphExplanation() {
		if (paragraphExplanationLoading) return;
		if (!activeDocumentId) {
			paragraphExplanationError = 'No document is loaded.';
			return;
		}

		const selected = get(selectedParagraph);
		if (!selected) {
			paragraphExplanationError = 'Select a paragraph before requesting an explanation.';
			return;
		}

		const paragraphNodes = buildAssistantNodeSnapshot(get(paragraphs), nodeEditStateById);
		if (paragraphNodes.length === 0) {
			paragraphExplanationError = 'The contract is still loading.';
			return;
		}

		const selectedText = getNodeCurrentText(nodeEditStateById, selected).trim();
		if (!selectedText) {
			paragraphExplanationError = 'Selected paragraph has no text to explain.';
			return;
		}

		paragraphExplanationLoading = true;
		paragraphExplanationError = null;

		const question = [
			'Explain the selected contract paragraph in clear and accessible language.',
			'Use the related paragraphs as supporting context.',
			'Return a detailed explanation with:',
			'1) plain-language summary,',
			'2) practical meaning and obligations,',
			'3) potential risks/ambiguities,',
			'4) examples of real-world impact.',
			'Keep legal accuracy while avoiding jargon.'
		].join('\n');

		const payload: AssistantChatRequest = {
			documentId: activeDocumentId,
			question,
			mode: 'explain',
			scope: 'selected',
			provider: assistantProvider,
			model: globalAnalysisModel,
			selectedParagraphId: selected.id,
			relatedParagraphs: buildAssistantRelatedContext(paragraphExplanationRelatedParagraphs),
			paragraphNodes,
			history: []
		};

		try {
			const response = await fetchAssistantResponse(payload);
			paragraphExplanationAnswer = response.answer;
			paragraphExplanationCitations = response.citations ?? [];
		} catch (requestError) {
			const message = getAxiosErrorMessage(
				requestError,
				'Failed to generate paragraph explanation.'
			);
			paragraphExplanationError = message;
		} finally {
			paragraphExplanationLoading = false;
		}
	}

	async function submitStructuredContradictionWhy(
		selected: ParagraphNode,
		contradiction: ContradictionParagraphResult
	) {
		if (assistantLoading) return;
		if (!activeDocumentId) {
			assistantError = 'No document is loaded.';
			return;
		}

		const paragraphNodes = buildAssistantNodeSnapshot(get(paragraphs), nodeEditStateById);
		if (paragraphNodes.length === 0) {
			assistantError = 'The contract is still loading.';
			return;
		}

		const selectedText = getNodeCurrentText(nodeEditStateById, selected);
		const question = buildContradictionAiCostQuestion(selected.id, selectedText, contradiction);

		assistantLoading = true;
		assistantError = null;
		await scrollAssistantToBottom();

		const payload: AssistantChatRequest = {
			documentId: activeDocumentId,
			question,
			mode: 'explain',
			scope: 'selected',
			provider: assistantProvider,
			model: globalAnalysisModel.trim() || undefined,
			selectedParagraphId: selected.id,
			relatedParagraphs: buildAssistantRelatedContext(selectedRelatedParagraphs),
			paragraphNodes,
			history: buildAssistantHistoryPayload(assistantMessages)
		};

		try {
			const response = await fetchAssistantResponse(payload);
			const structured = parseStructuredContradictionFromAnswer(
				response.answer,
				selected.id,
				selectedText
			);

			assistantMessages = [
				...assistantMessages,
				{
					id: nextAssistantMessageId(),
					role: 'assistant',
					content: structured?.overall_summary?.trim() || response.answer,
					citations: response.citations,
					suggestedQuestions: resolveAssistantSuggestedQuestions(response.suggestedQuestions, {
						mode: 'explain',
						scope: 'selected',
						contradiction: true
					}),
					structuredContradiction: structured ?? undefined
				}
			];
		} catch (assistantRequestError) {
			const message = getAxiosErrorMessage(assistantRequestError, 'Failed to generate a response.');
			assistantError = message;
			assistantMessages = [
				...assistantMessages,
				{
					id: nextAssistantMessageId(),
					role: 'assistant',
					content: `I could not complete this request: ${message}`
				}
			];
		} finally {
			assistantLoading = false;
			await scrollAssistantToBottom();
		}
	}

	function appendAssistantQuickActionMessage(content: string, citationId?: string) {
		assistantMessages = [
			...assistantMessages,
			{
				id: nextAssistantMessageId(),
				role: 'assistant',
				content,
				citations: citationId ? [{ id: citationId, excerpt: '(selected paragraph)' }] : undefined
			}
		];
	}

	async function askQuickAction(prompt: string) {
		if (assistantLoading) return;
		if (
			prompt === QUICK_ACTION_WHY_CONTRADICTION_FREE ||
			prompt === QUICK_ACTION_WHY_CONTRADICTION_AI
		) {
			const selected = get(selectedParagraph);
			assistantError = null;
			assistantMessages = [
				...assistantMessages,
				{
					id: nextAssistantMessageId(),
					role: 'user',
					content: prompt
				}
			];

			if (!selected) {
				appendAssistantQuickActionMessage(
					'Select a highlighted paragraph first, then run this contradiction quick action.'
				);
				await scrollAssistantToBottom();
				return;
			}

			const contradiction = contradictionResultsByParagraphId.get(selected.id);
			if (!contradiction) {
				appendAssistantQuickActionMessage(
					'No contradiction result is available for this paragraph yet. Run "Search contradictions" first.',
					selected.id
				);
				await scrollAssistantToBottom();
				return;
			}

			if (!contradiction.contradiction) {
				appendAssistantQuickActionMessage(
					'This paragraph is not currently classified as contradiction.',
					selected.id
				);
				await scrollAssistantToBottom();
				return;
			}

			if (prompt === QUICK_ACTION_WHY_CONTRADICTION_FREE) {
				const reason = (contradiction.brief_reason || 'No brief reason is available.').trim();
				const confidence = Number.isFinite(contradiction.confidence) ? contradiction.confidence : 0;
				const evidence = contradiction.evidence;
				const evidenceLines =
					evidence?.snippet_a?.trim() && evidence?.snippet_b?.trim()
						? [
								`Snippet A (${evidence.source_a}): "${evidence.snippet_a}"`,
								`Snippet B (${evidence.source_b}): "${evidence.snippet_b}"`
							]
						: ['No structured evidence snippets were returned by the classifier.'];
				appendAssistantQuickActionMessage(
					[
						`Free explanation for paragraph ${selected.id}:`,
						reason,
						`Confidence: ${confidence}%`,
						...evidenceLines,
						'Use "Why is it a contradiction? (AI cost)" for deeper evidence with richer legal reasoning.'
					].join('\n\n'),
					selected.id
				);
				await scrollAssistantToBottom();
				return;
			}

			await submitStructuredContradictionWhy(selected, contradiction);
			return;
		}

		await submitAssistantQuestion(prompt);
	}

	function handleQuickActionSelectionChange() {
		if (!selectedQuickAction) return;
		void askQuickAction(selectedQuickAction);
		selectedQuickAction = '';
	}

	function onSuggestedQuestionClick(question: string) {
		void submitAssistantQuestion(question);
	}

	async function submitContradictionAssistantQuestion(questionOverride?: string) {
		await submitAssistantQuestion(questionOverride, {
			mode: 'explain',
			scope: 'selected'
		});
	}

	function handleContradictionAssistantInputKeydown(event: KeyboardEvent) {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			void submitContradictionAssistantQuestion();
		}
	}

	function suggestContradictionFixFromChat() {
		void submitContradictionAssistantQuestion(
			'Suggest a revised version of the selected paragraph that resolves the contradiction while preserving legal intent and legal style.'
		);
	}

	function resetSimplifyState() {
		simplifyToolbarVisible = false;
		simplifyToolbarTop = 0;
		simplifyToolbarLeft = 0;
		simplifyTarget = null;
		simplifyResult = null;
		latestRewriteSource = null;
		simplifyLoading = false;
		simplifyError = null;
	}

	function setSimplifyToolbarPosition(anchorRect: DOMRect) {
		const { left, top } = getRewriteToolbarPosition(anchorRect);
		simplifyToolbarLeft = left;
		simplifyToolbarTop = top;
	}

	function refreshSimplifyTarget() {
		const selectedParagraphId = get(selectedParagraph)?.id ?? null;
		const nextTarget = resolveActiveRewriteTarget({
			viewer,
			selectedParagraphId,
			paragraphElementById,
			fallbackTarget: null
		});
		if (nextTarget) {
			simplifyTarget = nextTarget;
			setSimplifyToolbarPosition(nextTarget.anchorRect);
		} else {
			simplifyTarget = null;
		}
		simplifyToolbarVisible = false;
	}

	function resolveActiveSimplifyTarget(): SimplifyTarget | null {
		const selectedParagraphId = get(selectedParagraph)?.id ?? null;
		return resolveActiveRewriteTarget({
			viewer,
			selectedParagraphId,
			paragraphElementById,
			fallbackTarget: simplifyTarget
		});
	}

	async function runFixContradiction() {
		if (fixContradictionLoading || assistantLoading || simplifyLoading) return;
		const target = resolveActiveSimplifyTarget();
		const paragraphNode = target
			? (get(paragraphs).find((node) => node.id === target.paragraphId) ?? null)
			: null;
		if (paragraphNode) setSelectedParagraphNode(paragraphNode);

		fixContradictionLoading = true;
		simplifyError = null;
		try {
			const execution = await executeFixContradictionRewrite({
				activeDocumentId,
				assistantProvider,
				contradictionResultsByParagraphId,
				selectedRelatedParagraphs,
				nodeEditStateById,
				fixRelatedLimit: FIX_CONTRADICTION_TOP_RELATED,
				viewer,
				selectedParagraphId: get(selectedParagraph)?.id ?? null,
				paragraphElementById,
				fallbackTarget: target ?? simplifyTarget,
				resolveErrorMessage: getAxiosErrorMessage
			});
			if (!execution.ok) {
				simplifyError = execution.error;
				return;
			}

			simplifyResult = execution.result;
			latestRewriteSource = 'fix';
			activeRightPanelTab = 'revisions';
			isRightDrawerOpen = true;

			simplifyAuditTrail.unshift(execution.auditRecord);

			if (simplifyAuditTrail.length > MAX_SIMPLIFY_AUDIT_TRAIL) {
				simplifyAuditTrail.length = MAX_SIMPLIFY_AUDIT_TRAIL;
			}
		} finally {
			fixContradictionLoading = false;
			refreshSimplifyTarget();
		}
	}

	async function runSimplify() {
		if (simplifyLoading) return;
		const target = resolveActiveSimplifyTarget();

		simplifyLoading = true;
		simplifyError = null;

		try {
			const execution = await executeSimplifyRewrite({
				activeDocumentId,
				assistantProvider,
				viewer,
				selectedParagraphId: get(selectedParagraph)?.id ?? null,
				paragraphElementById,
				fallbackTarget: target ?? simplifyTarget,
				resolveErrorMessage: getAxiosErrorMessage
			});
			if (!execution.ok) {
				simplifyError = execution.error;
				return;
			}

			simplifyResult = execution.result;
			latestRewriteSource = 'simplify';
			activeRightPanelTab = 'revisions';
			isRightDrawerOpen = true;

			simplifyAuditTrail.unshift(execution.auditRecord);

			if (simplifyAuditTrail.length > MAX_SIMPLIFY_AUDIT_TRAIL) {
				simplifyAuditTrail.length = MAX_SIMPLIFY_AUDIT_TRAIL;
			}
		} finally {
			simplifyLoading = false;
			refreshSimplifyTarget();
		}
	}

	async function copySimplifiedSnippet() {
		const copyError = await copyRewriteSnippetToClipboard(simplifyResult);
		if (copyError) simplifyError = copyError;
	}

	function cancelSimplifyResult() {
		simplifyResult = null;
		latestRewriteSource = null;
		simplifyError = null;
	}

	function replaceSelectionWithSimplifiedText() {
		const applied = applyRewriteToParagraph({
			simplifyResult,
			paragraphElementById
		});
		if (!applied.ok) {
			if (applied.error) simplifyError = applied.error;
			return;
		}

		const selectedNode = get(paragraphs).find((node) => node.id === applied.paragraphId) ?? null;
		if (selectedNode) setSelectedParagraphNode(selectedNode);

		simplifyResult = null;
		latestRewriteSource = null;
		simplifyError = null;
		refreshSimplifyTarget();
	}

	async function recomputeBackendEdges(docId: string, nodesSnapshot: ParagraphNode[]) {
		const requestToken = ++graphComputationToken;
		if (nodesSnapshot.length === 0) {
			backendEdges = [];
			backendGraphLoading = false;
			refreshInspector();
			return;
		}

		backendGraphLoading = true;

		try {
			const { edges, relationsByNodeId } = await fetchBackendGraph(
				docId,
				nodesSnapshot,
				nodeEditStateById
			);

			if (requestToken !== graphComputationToken || activeDocumentId !== docId) return;

			backendEdges = edges;

			relationsCountByNodeId.clear();
			for (const node of nodesSnapshot) {
				const count = relationsByNodeId.get(node.id) ?? 0;
				relationsCountByNodeId.set(node.id, count);
				updateRelationBadge(paragraphRelationHostById, relationsCountByNodeId, node.id);
			}

			paragraphs.update((existingNodes) =>
				existingNodes.map((node) => ({
					...node,
					relationsCount: relationsCountByNodeId.get(node.id) ?? 0
				}))
			);

			refreshInspector();
		} catch (graphError) {
			if (requestToken !== graphComputationToken || activeDocumentId !== docId) return;
			console.error('Failed to compute backend graph edges:', graphError);
			backendEdges = [];
			refreshInspector();
		} finally {
			if (requestToken === graphComputationToken && activeDocumentId === docId) {
				backendGraphLoading = false;
			}
		}
	}

	function clearRenderedDocument(clearStores = true) {
		if (releaseDoc) {
			releaseDoc();
			releaseDoc = null;
		}
		if (viewer) viewer.replaceChildren();
		contradictionResultsByParagraphId = new Map();
		contradictionSource = null;
		contradictionError = null;
		contradictionScrollMarkers = [];
		selectedContradictionEvidenceLink = null;
		resetInspectorState();
		resetAssistantState();
		resetParagraphExplanationState();
		if (clearStores) {
			paragraphs.set([]);
			setSelectedParagraphNode(null);
		}
	}

	const PAGE_OVERFLOW_TOLERANCE_PX = 10;
	const PAGE_SPLIT_GUARD_LIMIT = 180;
	const PAGE_HEIGHT_CALIBRATION_PX = 28;
	const PAGE_SOFT_OVERFLOW_ALLOWANCE_PX = 24;
	const DOCX_DEFAULT_TAB_INTERVAL_PX = 48;

	function parsePxValue(rawValue?: string | null): number | null {
		if (!rawValue) return null;
		const parsed = Number.parseFloat(rawValue);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function isIgnorableTextNode(node: Node): boolean {
		return node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim();
	}

	function getMeaningfulNodes(parent: HTMLElement): Node[] {
		return Array.from(parent.childNodes).filter((child) => !isIgnorableTextNode(child));
	}

	function countMeaningfulChildren(parent: HTMLElement): number {
		let count = 0;
		for (const child of Array.from(parent.childNodes)) {
			if (isIgnorableTextNode(child)) continue;
			count += 1;
		}
		return count;
	}

	function getLastMeaningfulElement(parent: HTMLElement): HTMLElement | null {
		const children = Array.from(parent.childNodes);
		for (let i = children.length - 1; i >= 0; i -= 1) {
			const node = children[i];
			if (isIgnorableTextNode(node)) continue;
			if (node instanceof HTMLElement) return node;
			break;
		}
		return null;
	}

	function getPreviousMeaningfulSibling(node: Node | null): HTMLElement | null {
		let current = node?.previousSibling ?? null;
		while (current) {
			if (!isIgnorableTextNode(current)) {
				return current instanceof HTMLElement ? current : null;
			}
			current = current.previousSibling;
		}
		return null;
	}

	function parseDocxTabStops(rawStops: string | undefined): number[] {
		if (!rawStops) return [];
		return rawStops
			.split(',')
			.map((value) => Number.parseFloat(value))
			.filter((value) => Number.isFinite(value) && value >= 0)
			.sort((left, right) => left - right);
	}

	function splitNodesByDocxTabs(container: HTMLElement): Node[][] {
		const segments: Node[][] = [[]];
		for (const node of Array.from(container.childNodes)) {
			if (node instanceof HTMLElement && node.dataset.docxTab === '1') {
				segments.push([]);
				continue;
			}
			segments[segments.length - 1].push(node);
		}
		return segments;
	}

	function segmentText(nodes: Node[]): string {
		return normalizeEditableText(nodes.map((node) => node.textContent ?? '').join('')).trim();
	}

	function buildDocxTabGridTemplate(stops: number[], segmentsCount: number): string {
		const requiredFixedCols = Math.max(segmentsCount - 1, 1);
		const fixedCols: number[] = [];
		let previousStop = 0;
		for (const stop of stops) {
			const width = Math.max(stop - previousStop, 2);
			fixedCols.push(width);
			previousStop = stop;
			if (fixedCols.length >= requiredFixedCols) break;
		}
		while (fixedCols.length < requiredFixedCols) {
			fixedCols.push(DOCX_DEFAULT_TAB_INTERVAL_PX);
		}
		const fixedTemplate = fixedCols.map((width) => `${Math.round(width)}px`).join(' ');
		return `${fixedTemplate} minmax(0, 1fr)`;
	}

	function shouldUseDocxTabGridLayout(
		container: HTMLElement,
		stops: number[],
		segments: Node[][]
	): boolean {
		if (container.dataset.docxListItem === 'true') return false;
		if (stops.length === 0 || segments.length < 2) return false;
		if (stops[0] < 120) return false;

		const leadingText = segmentText(segments[0]);
		const rightText = segmentText(segments[1]);
		if (!leadingText && !rightText) return false;

		const tabCount = segments.length - 1;
		if (tabCount > 10) return false;
		return true;
	}

	function applyDocxTabGridLayout(container: HTMLElement, stops: number[], segments: Node[][]) {
		const totalColumns = Math.max(segments.length, 2);
		const fragment = document.createDocumentFragment();
		for (let index = 0; index < totalColumns; index += 1) {
			const cell = document.createElement('span');
			cell.dataset.docxTabCell = String(index + 1);
			cell.style.display = 'block';
			cell.style.minWidth = '0';
			cell.style.whiteSpace = 'pre-wrap';
			cell.style.wordBreak = 'break-word';
			cell.style.gridColumn = String(index + 1);
			const nodes = segments[index] ?? [];
			for (const node of nodes) {
				cell.appendChild(node);
			}
			fragment.appendChild(cell);
		}

		container.replaceChildren(fragment);
		container.dataset.docxTabLayout = 'grid';
		container.style.display = 'grid';
		container.style.gridTemplateColumns = buildDocxTabGridTemplate(stops, segments.length);
		container.style.columnGap = '0px';
		container.style.alignItems = 'start';
	}

	function applyDocxTabStops(targetViewer: HTMLElement) {
		const containers = targetViewer.querySelectorAll<HTMLElement>('[data-docx-tab-stops]');
		for (const container of containers) {
			const stops = parseDocxTabStops(container.dataset.docxTabStops);
			if (stops.length === 0) continue;

			const tabs = container.querySelectorAll<HTMLElement>('span[data-docx-tab=\"1\"]');
			if (tabs.length === 0) continue;

			const segments = splitNodesByDocxTabs(container);
			if (shouldUseDocxTabGridLayout(container, stops, segments)) {
				applyDocxTabGridLayout(container, stops, segments);
				continue;
			}

			const containerRect = container.getBoundingClientRect();
			for (const tab of tabs) {
				tab.style.display = 'inline-block';
				tab.style.minWidth = '0';
				tab.style.width = '0';
				tab.style.verticalAlign = 'baseline';

				const tabRect = tab.getBoundingClientRect();
				const currentX = Math.max(0, tabRect.left - containerRect.left);
				let targetStop = stops.find((stop) => stop > currentX + 0.5);
				if (targetStop == null) {
					targetStop =
						(Math.floor(currentX / DOCX_DEFAULT_TAB_INTERVAL_PX) + 1) *
						DOCX_DEFAULT_TAB_INTERVAL_PX;
				}

				const width = Math.max(2, targetStop - currentX);
				tab.style.width = `${width}px`;
				tab.style.minWidth = `${width}px`;
				tab.textContent = '\u00a0';
			}
		}
	}

	function lockSectionHeight(section: HTMLElement, pageHeight: number) {
		section.style.height = `${pageHeight}px`;
		section.style.minHeight = `${pageHeight}px`;
		section.style.maxHeight = `${pageHeight}px`;
		section.style.overflow = 'hidden';
	}

	function createContinuationSection(section: HTMLElement): HTMLElement {
		const continuation = section.cloneNode(false) as HTMLElement;
		continuation.replaceChildren();
		return continuation;
	}

	function splitSingleOversizedTableSection(
		section: HTMLElement,
		pageHeight: number
	): HTMLElement | null {
		const meaningfulNodes = getMeaningfulNodes(section);
		if (meaningfulNodes.length !== 1) return null;
		const soleNode = meaningfulNodes[0];
		if (!(soleNode instanceof HTMLTableElement)) return null;

		const sourceTable = soleNode;
		const sourceBodies = Array.from(sourceTable.tBodies);
		if (sourceBodies.length === 0) return null;
		const initialBodyRows = sourceBodies.reduce((sum, body) => sum + body.rows.length, 0);
		if (initialBodyRows <= 1) return null;

		const continuationSection = createContinuationSection(section);
		lockSectionHeight(continuationSection, pageHeight);

		const continuationTable = sourceTable.cloneNode(false) as HTMLTableElement;
		const continuationBodyBySource = new Map<HTMLTableSectionElement, HTMLTableSectionElement>();
		for (const child of Array.from(sourceTable.children)) {
			if (!(child instanceof HTMLElement)) continue;
			const tag = child.tagName.toLowerCase();
			if (tag === 'tbody') {
				const clonedBody = child.cloneNode(false) as HTMLTableSectionElement;
				continuationTable.appendChild(clonedBody);
				continuationBodyBySource.set(child as HTMLTableSectionElement, clonedBody);
				continue;
			}
			if (tag === 'tfoot') continue;
			continuationTable.appendChild(child.cloneNode(true));
		}

		const targetBodies = Array.from(continuationTable.tBodies);
		if (targetBodies.length === 0) {
			const fallbackBody = document.createElement('tbody');
			continuationTable.appendChild(fallbackBody);
			const firstSourceBody = sourceBodies[0];
			if (firstSourceBody) {
				continuationBodyBySource.set(firstSourceBody, fallbackBody);
			}
		}

		continuationSection.appendChild(continuationTable);
		section.insertAdjacentElement('afterend', continuationSection);

		let movedAny = false;
		while (section.scrollHeight - section.clientHeight > PAGE_OVERFLOW_TOLERANCE_PX) {
			const remainingRows = sourceBodies.reduce((sum, body) => sum + body.rows.length, 0);
			if (remainingRows <= 1) break;

			let sourceBodyToMove: HTMLTableSectionElement | null = null;
			for (let i = sourceBodies.length - 1; i >= 0; i -= 1) {
				if (sourceBodies[i].rows.length > 0) {
					sourceBodyToMove = sourceBodies[i];
					break;
				}
			}
			if (!sourceBodyToMove) break;

			const rowToMove = sourceBodyToMove.rows.item(sourceBodyToMove.rows.length - 1);
			if (!rowToMove) break;

			const targetBody = continuationBodyBySource.get(sourceBodyToMove);
			if (!targetBody) break;

			targetBody.prepend(rowToMove);
			movedAny = true;
		}

		if (!movedAny) {
			continuationSection.remove();
			return null;
		}

		return continuationSection;
	}

	function splitSectionIntoPages(section: HTMLElement, pageHeight: number) {
		lockSectionHeight(section, pageHeight);

		let current = section;
		let guard = 0;

		while (
			current.scrollHeight - current.clientHeight > PAGE_OVERFLOW_TOLERANCE_PX &&
			guard < PAGE_SPLIT_GUARD_LIMIT
		) {
			const overflowPx = current.scrollHeight - current.clientHeight;
			let softAllowancePx = PAGE_SOFT_OVERFLOW_ALLOWANCE_PX;
			const lastMeaningfulElement = getLastMeaningfulElement(current);
			if (lastMeaningfulElement && lastMeaningfulElement.tagName.toLowerCase() === 'p') {
				const lastParagraphHeight = Math.ceil(lastMeaningfulElement.getBoundingClientRect().height);
				softAllowancePx = Math.min(
					Math.max(PAGE_SOFT_OVERFLOW_ALLOWANCE_PX, lastParagraphHeight + 12),
					48
				);
			}
			if (overflowPx <= softAllowancePx) {
				lockSectionHeight(current, pageHeight + overflowPx);
				break;
			}

			guard += 1;

			if (countMeaningfulChildren(current) <= 1) {
				const continuationFromTableSplit = splitSingleOversizedTableSection(current, pageHeight);
				if (continuationFromTableSplit) {
					current = continuationFromTableSplit;
					continue;
				}
				// A single oversized block (usually a large table/image) cannot be split safely here.
				current.style.height = 'auto';
				current.style.maxHeight = 'none';
				current.style.overflow = 'visible';
				break;
			}

			const continuation = createContinuationSection(current);
			current.insertAdjacentElement('afterend', continuation);
			lockSectionHeight(continuation, pageHeight);

			let movedAny = false;
			let keptCurrentPageByAllowance = false;
			while (current.scrollHeight - current.clientHeight > PAGE_OVERFLOW_TOLERANCE_PX) {
				if (countMeaningfulChildren(current) <= 1) break;
				const lastNode = current.lastChild;
				if (!lastNode) break;
				if (lastNode instanceof HTMLElement) {
					const overflowPx = current.scrollHeight - current.clientHeight;
					const isListItem = lastNode.dataset.docxListItem === 'true';
					if (isListItem) {
						const listItemHeight = Math.ceil(lastNode.getBoundingClientRect().height);
						const keepListItemAllowance = Math.min(
							Math.max(PAGE_SOFT_OVERFLOW_ALLOWANCE_PX, listItemHeight + 56),
							120
						);
						if (overflowPx <= keepListItemAllowance) {
							lockSectionHeight(current, pageHeight + overflowPx);
							keptCurrentPageByAllowance = true;
							break;
						}
					}

					const previousMeaningful = getPreviousMeaningfulSibling(lastNode);
					const isListContinuationBoundary =
						lastNode.tagName.toLowerCase() === 'p' &&
						previousMeaningful?.dataset.docxListItem === 'true';
					if (isListContinuationBoundary) {
						const continuationHeight = Math.ceil(lastNode.getBoundingClientRect().height);
						const keepWithMarkerAllowance = Math.min(
							Math.max(PAGE_SOFT_OVERFLOW_ALLOWANCE_PX, continuationHeight + 28),
							96
						);
						if (overflowPx <= keepWithMarkerAllowance) {
							lockSectionHeight(current, pageHeight + overflowPx);
							keptCurrentPageByAllowance = true;
							break;
						}
					}
				}
				continuation.prepend(lastNode);
				movedAny = true;
			}

			if (!movedAny) {
				continuation.remove();
				if (keptCurrentPageByAllowance) {
					break;
				}
				current.style.height = 'auto';
				current.style.maxHeight = 'none';
				current.style.overflow = 'visible';
				break;
			}

			current = continuation;
		}
	}

	function paginateRenderedSections(targetViewer: HTMLElement) {
		const root = targetViewer.firstElementChild;
		if (!(root instanceof HTMLElement)) return;

		const sections = Array.from(root.children).filter(
			(node): node is HTMLElement =>
				node instanceof HTMLElement && node.tagName.toLowerCase() === 'section'
		);

		for (const section of sections) {
			const declaredHeight =
				parsePxValue(section.style.height) ?? parsePxValue(section.style.minHeight);
			const measuredHeight = Math.round(section.getBoundingClientRect().height);
			const pageHeight =
				declaredHeight != null && declaredHeight > 0
					? declaredHeight
					: measuredHeight > 0
						? measuredHeight
						: null;
			if (!pageHeight) continue;
			// Word and browser font metrics differ slightly; use a small calibrated height
			// to avoid premature splits that leave a mostly empty trailing area.
			splitSectionIntoPages(section, pageHeight + PAGE_HEIGHT_CALIBRATION_PX);
		}
	}

	async function renderDocument(docId: string) {
		const token = ++renderToken;
		loading.set(true);
		error.set(null);
		localError = null;
		paragraphs.set([]);
		setSelectedParagraphNode(null);
		resetAssistantState();
		resetParagraphExplanationState();

		try {
			const metadata = await resolveDocumentMeta(docId);
			if (token !== renderToken) return;
			activeDocumentId = docId;
			activeDocumentName = metadata?.name ?? `${docId}.docx`;

			const response = await api.get<ArrayBuffer>(`/document_file/${encodeURIComponent(docId)}`, {
				responseType: 'arraybuffer'
			});
			if (token !== renderToken) return;

			const docx4jsModule = await loadBrowserDocx4js();
			if (token !== renderToken) return;

			const parsedDoc = await docx4jsModule.docx.load(response.data);
			if (token !== renderToken) {
				parsedDoc.release?.();
				return;
			}

			const nodesById = new Map<string, ParagraphNode>();
			const syncParagraphNodeStore = () => {
				paragraphs.set(
					Array.from(nodesById.values()).sort(
						(left, right) => left.paragraph_enum - right.paragraph_enum
					)
				);
			};
			const removeParagraphNode = (
				nodeId: string,
				options: { freezeElement?: boolean; deferStoreSync?: boolean } = {}
			): boolean => {
				const paragraphElement = paragraphElementById.get(nodeId);
				if (options.freezeElement && paragraphElement) {
					freezeIgnoredParagraphElement(paragraphElement);
				}

				const relationHost = paragraphRelationHostById.get(nodeId);
				if (relationHost) {
					clearRelationBadgeHost(relationHost);
				}

				nodeEditStateById.delete(nodeId);
				paragraphElementById.delete(nodeId);
				paragraphRelationHostById.delete(nodeId);
				relationsCountByNodeId.delete(nodeId);

				const removed = nodesById.delete(nodeId);
				const selected = get(selectedParagraph);
				if (selected?.id === nodeId) {
					setSelectedParagraphNode(null);
				}

				if (removed && !options.deferStoreSync) {
					syncParagraphNodeStore();
				}
				return removed;
			};
			const pruneBlankSections = () => {
				if (!viewer) return;
				const root = viewer.firstElementChild;
				if (!(root instanceof HTMLElement)) return;

				const sections = Array.from(root.children).filter(
					(node): node is HTMLElement =>
						node instanceof HTMLElement && node.tagName.toLowerCase() === 'section'
				);
				if (sections.length === 0) return;

				let removedAnyNode = false;
				for (const section of sections) {
					const hasMediaContent = Boolean(
						section.querySelector('img,table,svg,canvas,video,audio,object,iframe')
					);
					const visibleText = normalizeEditableText(section.innerText ?? '').trim();
					if (hasMediaContent || visibleText.length > 0) continue;

					const nodeElements = section.querySelectorAll<HTMLElement>('[data-node-id]');
					for (const nodeElement of nodeElements) {
						const nodeId = nodeElement.dataset.nodeId;
						if (!nodeId) continue;
						const removed = removeParagraphNode(nodeId, {
							freezeElement: true,
							deferStoreSync: true
						});
						removedAnyNode = removedAnyNode || removed;
					}
					section.remove();
				}

				if (removedAnyNode) {
					syncParagraphNodeStore();
				}
			};

			const upsertParagraphNode = (node: ParagraphNode) => {
				const state = ensureNodeEditState(nodeEditStateById, node.id, node.text);
				state.current = normalizeEditableText(node.text);
				nodesById.set(node.id, node);
				syncParagraphNodeStore();
			};
			const focusParagraphNode = (node: ParagraphNode) => {
				setSelectedParagraphNode(node);
			};
			const commitParagraphNode = (node: ParagraphNode) => {
				const state = ensureNodeEditState(nodeEditStateById, node.id, node.text);
				state.current = normalizeEditableText(node.text);
				state.committed = state.current;
				state.editedSinceCommit = false;

				const selected = get(selectedParagraph);
				if (selected?.id === node.id) {
					setSelectedParagraphNode(node);
				}

				const snapshot = Array.from(nodesById.values()).sort(
					(left, right) => left.paragraph_enum - right.paragraph_enum
				);
				void recomputeBackendEdges(docId, snapshot);
			};

			clearRenderedDocument(false);
			releaseDoc = typeof parsedDoc.release === 'function' ? () => parsedDoc.release?.() : null;

			const identify = (
				node: XmlNode,
				officeDocument: {
					constructor: { identify: (node: XmlNode, officeDocument: unknown) => unknown };
				}
			) => {
				return officeDocument.constructor.identify(node, officeDocument);
			};

			const renderedRoot = parsedDoc.render(
				createRenderer(
					docId,
					{
						onNodeUpsert: upsertParagraphNode,
						onNodeFocus: focusParagraphNode,
						onNodeCommit: commitParagraphNode,
						onNodeRemove: (nodeId: string) => {
							removeParagraphNode(nodeId);
						}
					},
					{
						nodeEditStateById,
						paragraphElementById,
						paragraphRelationHostById,
						relationsCountByNodeId,
						getSelectedNodeId: () => selectedNodeId
					}
				),
				identify
			);
			if (token !== renderToken || !viewer) return;

			viewer.replaceChildren();
			appendChildren(viewer, renderedRoot);
			await tick();
			if (document.fonts?.status !== 'loaded') {
				await document.fonts.ready;
				if (token !== renderToken || !viewer) return;
			}
			applyDocxTabStops(viewer);
			paginateRenderedSections(viewer);
			pruneBlankSections();
			applyContradictionHighlights();

			const structuralNoiseNodeIds = detectDocxNoiseNodeIds(viewer);
			if (structuralNoiseNodeIds.length > 0) {
				let removedAnyNode = false;
				for (const nodeId of structuralNoiseNodeIds) {
					const removed = removeParagraphNode(nodeId, {
						freezeElement: true,
						deferStoreSync: true
					});
					removedAnyNode = removedAnyNode || removed;
				}
				if (removedAnyNode) {
					syncParagraphNodeStore();
				}
			}
			pruneBlankSections();

			refreshSimplifyTarget();

			const snapshot = Array.from(nodesById.values()).sort(
				(left, right) => left.paragraph_enum - right.paragraph_enum
			);
			void recomputeBackendEdges(docId, snapshot);
		} catch (err) {
			if (token !== renderToken) return;
			activeDocumentId = null;
			activeDocumentName = '';
			localError = err instanceof Error ? err.message : 'Failed to render DOCX document.';
			error.set(localError);
			clearRenderedDocument();
		} finally {
			if (token === renderToken) loading.set(false);
		}
	}

	async function openFromRoute(docIdFromRoute: string | null) {
		const fallbackId = get(currentDocument)?.id ?? null;
		const docId = docIdFromRoute ?? fallbackId;

		if (!docId) {
			activeDocumentId = null;
			activeDocumentName = '';
			localError = 'Select a document in the dataset list first.';
			clearRenderedDocument();
			return;
		}

		if (activeDocumentId === docId && viewer?.childNodes.length) return;
		await renderDocument(docId);
	}

	function refreshViewportMode() {
		isCompactLayout = window.innerWidth < 1024;
	}

	function clampRightDrawerWidth(nextWidth: number): number {
		const viewportWidth = window.innerWidth || RIGHT_DRAWER_DEFAULT_WIDTH;
		const maxWidth = Math.max(
			RIGHT_DRAWER_MIN_WIDTH,
			Math.floor(viewportWidth * RIGHT_DRAWER_MAX_RATIO)
		);
		return Math.min(Math.max(nextWidth, RIGHT_DRAWER_MIN_WIDTH), maxWidth);
	}

	function setRightDrawerWidth(nextWidth: number) {
		rightDrawerWidth = clampRightDrawerWidth(nextWidth);
	}

	function stopRightDrawerResize() {
		if (!isResizingRightDrawer) return;
		isResizingRightDrawer = false;
		window.removeEventListener('mousemove', handleRightDrawerResizeMove);
		window.removeEventListener('mouseup', stopRightDrawerResize);
		document.body.style.userSelect = '';
	}

	function handleRightDrawerResizeMove(event: MouseEvent) {
		const desiredWidth = window.innerWidth - activeSidebarWidth - event.clientX;
		setRightDrawerWidth(desiredWidth);
	}

	function startRightDrawerResize(event: MouseEvent) {
		if (window.innerWidth < 1024 || !isRightDrawerOpen) return;
		event.preventDefault();
		isResizingRightDrawer = true;
		document.body.style.userSelect = 'none';
		window.addEventListener('mousemove', handleRightDrawerResizeMove);
		window.addEventListener('mouseup', stopRightDrawerResize);
	}

	function handleRightDrawerResizeKeydown(event: KeyboardEvent) {
		if (!isRightDrawerOpen) return;
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			setRightDrawerWidth(rightDrawerWidth + RIGHT_DRAWER_KEYBOARD_STEP);
			return;
		}
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			setRightDrawerWidth(rightDrawerWidth - RIGHT_DRAWER_KEYBOARD_STEP);
		}
	}

	function selectRightTool(tabId: RightPanelTab) {
		activeRightPanelTab = tabId;
		isRightDrawerOpen = true;
	}

	function toggleSidebarLabels() {
		sidebarLabelsPinned = !sidebarLabelsPinned;
	}

	function measureGlobalModelSelectWidthPx(): number {
		if (typeof document === 'undefined') return GLOBAL_MODEL_MIN_WIDTH_PX;

		const canvas = document.createElement('canvas');
		const context = canvas.getContext('2d');
		if (!context) return GLOBAL_MODEL_MIN_WIDTH_PX;

		const rootStyles = getComputedStyle(document.documentElement);
		const fontFamily = rootStyles.fontFamily || 'sans-serif';
		context.font = `400 ${GLOBAL_MODEL_FONT_SIZE_PX}px ${fontFamily}`;

		const longestLabelPx = GLOBAL_ANALYSIS_MODEL_OPTIONS.reduce((maxWidth, option) => {
			const width = context.measureText(option.label).width;
			return Math.max(maxWidth, width);
		}, 0);

		const paddingAndIconsPx = Math.max(GLOBAL_MODEL_TRIGGER_EXTRA_PX, GLOBAL_MODEL_ITEM_CHECK_EXTRA_PX);
		return Math.max(GLOBAL_MODEL_MIN_WIDTH_PX, Math.ceil(longestLabelPx + paddingAndIconsPx));
	}

	onMount(() => {
		const handleGlobalPointerDown = (event: MouseEvent) => {
			if (activeRightPanelTab !== 'related') return;
			const selected = get(selectedParagraph);
			if (!selected?.id) return;

			const target = event.target instanceof Element ? event.target : null;
			if (target?.closest('aside')) return;
			const paragraphElement = target?.closest('[data-node-id]') as HTMLElement | null;
			if (!paragraphElement) {
				setSelectedParagraphNode(null);
				return;
			}

			const clickedNodeId = paragraphElement.dataset.nodeId;
			if (!clickedNodeId || clickedNodeId !== selected.id) return;

			event.preventDefault();
			if (document.activeElement instanceof HTMLElement) {
				document.activeElement.blur();
			}
			setSelectedParagraphNode(null);
		};

		const handleDocumentSelectionChange = () => {
			refreshSimplifyTarget();
			scheduleContradictionScrollMarkerRefresh();
			scheduleParagraphExplanationConnectorRefresh();
		};
		const handleDocumentScroll = () => {
			scheduleContradictionScrollMarkerRefresh();
			scheduleParagraphExplanationConnectorRefresh();
		};
		const handleViewportResize = () => {
			refreshViewportMode();
			scheduleContradictionScrollMarkerRefresh();
			scheduleParagraphExplanationConnectorRefresh();
			setRightDrawerWidth(rightDrawerWidth);
		};

		document.addEventListener('selectionchange', handleDocumentSelectionChange);
		document.addEventListener('mouseup', handleDocumentSelectionChange);
		document.addEventListener('keyup', handleDocumentSelectionChange);
		document.addEventListener('mousedown', handleGlobalPointerDown, true);
		window.addEventListener('resize', handleViewportResize);
		documentScrollHost?.addEventListener('scroll', handleDocumentScroll, {
			passive: true
		});
		refreshViewportMode();
		setRightDrawerWidth(rightDrawerWidth);
		globalModelSelectWidthPx = measureGlobalModelSelectWidthPx();
		const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
		if (fontSet) {
			void fontSet.ready.then(() => {
				globalModelSelectWidthPx = measureGlobalModelSelectWidthPx();
			});
		}

		if (typeof ResizeObserver !== 'undefined') {
			contradictionMarkerResizeObserver = new ResizeObserver(() => {
				scheduleContradictionScrollMarkerRefresh();
			});
			if (documentScrollHost) contradictionMarkerResizeObserver.observe(documentScrollHost);
			if (viewer) contradictionMarkerResizeObserver.observe(viewer);
		}

		const unsubscribe = page.subscribe(($page) => {
			void openFromRoute($page.url.searchParams.get('id'));
		});
		scheduleContradictionScrollMarkerRefresh();

		return () => {
			renderToken += 1;
			unsubscribe();
			document.removeEventListener('selectionchange', handleDocumentSelectionChange);
			document.removeEventListener('mouseup', handleDocumentSelectionChange);
			document.removeEventListener('keyup', handleDocumentSelectionChange);
			document.removeEventListener('mousedown', handleGlobalPointerDown, true);
			window.removeEventListener('resize', handleViewportResize);
			documentScrollHost?.removeEventListener('scroll', handleDocumentScroll);
			stopRightDrawerResize();
			stopManualScrollDrag();
			contradictionMarkerResizeObserver?.disconnect();
			contradictionMarkerResizeObserver = null;
			if (contradictionMarkerFrame != null) {
				window.cancelAnimationFrame(contradictionMarkerFrame);
				contradictionMarkerFrame = null;
			}
			if (paragraphExplanationFrame != null) {
				window.cancelAnimationFrame(paragraphExplanationFrame);
				paragraphExplanationFrame = null;
			}
			clearRenderedDocument();
		};
	});
</script>

<main
	class={`relative flex h-screen w-screen overflow-hidden bg-gray-100 font-sans ${
		activeRightPanelTab === 'related' ? 'related-badges-on' : 'related-badges-off'
	} ${activeRightPanelTab === 'related' && $selectedParagraph?.id ? 'related-focus-on' : ''}`}
>
	<div
		class="relative flex min-w-0 flex-col border-r border-gray-300"
		style={isCompactLayout
			? ''
			: `width: calc(100% - ${activeSidebarWidth + activeDrawerWidth}px);`}
	>
		<header
			class="flex flex-none items-center gap-3 border-b border-gray-200/90 bg-white/90 px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur supports-[backdrop-filter]:bg-white/75"
		>
			<div class="min-w-0 flex-1">
				<p class="text-[11px] text-gray-500">Document</p>
				<div class="flex items-center gap-2">
					<div class="min-w-0 flex-1 truncate text-sm font-medium text-gray-800">
						{activeDocumentName || 'No document selected'}
					</div>
					<div class="mr-5">
						<Select.Root
							type="single"
							bind:value={globalAnalysisModel}
							disabled={contradictionLoading || paragraphExplanationLoading}
						>
							<Select.Trigger
								size="sm"
								class="h-7 shrink-0 border-gray-200 bg-white px-1.5 text-[10px] text-gray-600"
								style={`width: ${globalModelSelectWidthPx}px;`}
								title="Global model for Contradiction Analysis and Paragraph Explanation"
							>
								{GLOBAL_ANALYSIS_MODEL_OPTIONS.find((option) => option.value === globalAnalysisModel)
									?.label ?? globalAnalysisModel}
							</Select.Trigger>
							<Select.Content
								class="min-w-0"
								style={`width: ${globalModelSelectWidthPx}px; min-width: 0;`}
							>
								{#each GLOBAL_ANALYSIS_MODEL_OPTIONS as option}
									<Select.Item value={option.value} label={option.label} class="text-[10px] whitespace-nowrap">
										{option.label}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				</div>
			</div>
		</header>

		{#if contradictionSummaryVisible && (contradictionError || contradictionResultsByParagraphId.size > 0)}
			<Card.Root
				size="sm"
				class="absolute top-[64px] right-4 left-4 z-[70] border-gray-200 py-0 text-[10px] shadow-lg"
			>
				<Card.Content class="px-2.5 text-gray-600">
					<div class="flex items-start justify-between gap-2">
						{#if contradictionError}
							<p class="min-w-0 leading-snug text-red-700">{contradictionError}</p>
						{:else}
							<p class="min-w-0 leading-snug">
								{contradictionCount} paragraph(s) with highlighted contradiction(s).
								{#if contradictionSource}
									<span class="text-gray-500"> Source: {contradictionSource}</span>
								{/if}
							</p>
						{/if}
						<button
							type="button"
							class="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded border border-gray-200 bg-white text-gray-500 transition hover:border-gray-300 hover:text-gray-700"
							aria-label="Close contradiction summary"
							on:click={() => (contradictionSummaryVisible = false)}
						>
							<CloseIcon className="h-3 w-3" />
						</button>
					</div>
				</Card.Content>
			</Card.Root>
		{/if}

		{#if localError || $error}
			<div class="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
				{localError ?? $error}
			</div>
		{/if}

		<div class="relative flex min-h-0 flex-1">
			<section
				bind:this={documentScrollHost}
				inert={backendGraphLoading}
				class={`flex min-h-0 flex-1 flex-col items-center overflow-auto px-2 py-4 shadow-inner ${
					backendGraphLoading ? 'pointer-events-none opacity-60 select-none' : ''
				}`}
			>
				<div bind:this={viewer} class="min-h-full w-full"></div>
			</section>

			{#if shouldShowContradictionDecorations && contradictionScrollMarkers.length > 0}
				<div class="absolute top-2 right-1 bottom-2 z-20 w-2" on:mousedown={startManualScrollDrag}>
					{#each contradictionScrollMarkers as marker (marker.paragraphId)}
						<span
							class={`docx-contradiction-scroll-marker docx-contradiction-scroll-marker--${marker.confidenceBand}`}
							style={`top: ${marker.topPercent}%;`}
							role="button"
							tabindex="0"
							aria-label={`Go to contradiction in paragraph ${marker.paragraphId}`}
							on:click={() => jumpToContradictionParagraph(marker.paragraphId)}
							on:keydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									jumpToContradictionParagraph(marker.paragraphId);
								}
							}}
						></span>
					{/each}
				</div>
			{/if}

			{#if shouldShowContradictionDecorations && selectedContradictionEvidenceLink}
				<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden">
					<span
						class="docx-contradiction-evidence-bracket"
						style={`left: ${selectedContradictionEvidenceLink.leftPx}px; top: ${selectedContradictionEvidenceLink.topPx}px; height: ${Math.max(
							6,
							selectedContradictionEvidenceLink.bottomPx - selectedContradictionEvidenceLink.topPx
						)}px;`}
					></span>
					{#if selectedContradictionEvidenceLink.showA}
						<span
							class="docx-contradiction-evidence-cap"
							style={`left: ${selectedContradictionEvidenceLink.leftPx}px; top: ${selectedContradictionEvidenceLink.aCenterPx}px;`}
						></span>
						<span
							class="docx-contradiction-evidence-dot docx-contradiction-evidence-dot--a"
							style={`left: ${selectedContradictionEvidenceLink.leftPx}px; top: ${selectedContradictionEvidenceLink.aCenterPx}px;`}
						></span>
						<span
							class="docx-contradiction-evidence-label docx-contradiction-evidence-label--a"
							style={`left: ${selectedContradictionEvidenceLink.leftPx}px; top: ${selectedContradictionEvidenceLink.aCenterPx}px;`}
						>
							A
						</span>
					{/if}
					{#if selectedContradictionEvidenceLink.showB}
						<span
							class="docx-contradiction-evidence-cap"
							style={`left: ${selectedContradictionEvidenceLink.leftPx}px; top: ${selectedContradictionEvidenceLink.bCenterPx}px;`}
						></span>
						<span
							class="docx-contradiction-evidence-dot docx-contradiction-evidence-dot--b"
							style={`left: ${selectedContradictionEvidenceLink.leftPx}px; top: ${selectedContradictionEvidenceLink.bCenterPx}px;`}
						></span>
						<span
							class="docx-contradiction-evidence-label docx-contradiction-evidence-label--b"
							style={`left: ${selectedContradictionEvidenceLink.leftPx}px; top: ${selectedContradictionEvidenceLink.bCenterPx}px;`}
						>
							B
						</span>
					{/if}
				</div>
			{/if}

			{#if shouldShowParagraphExplanationDecorations && paragraphExplanationConnectors.length > 0}
				<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden">
					{#each paragraphExplanationConnectors as connector, index (`connector-${index}`)}
						<span
							class="docx-paragraph-explanation-bracket"
							style={`left: ${connector.leftPx}px; top: ${connector.topPx}px; height: ${Math.max(
								6,
								connector.bottomPx - connector.topPx
							)}px;`}
							role="button"
							tabindex="0"
							aria-label={`Go to related paragraph ${connector.paragraphId}`}
							on:click={() => jumpToRelatedParagraphMarker(connector.paragraphId)}
							on:keydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									jumpToRelatedParagraphMarker(connector.paragraphId);
								}
							}}
						></span>
						<span
							class="docx-paragraph-explanation-cap"
							style={`left: ${connector.leftPx}px; top: ${connector.selectedCapTopPx}px;`}
						></span>
						<span
							class="docx-paragraph-explanation-cap"
							style={`left: ${connector.leftPx}px; top: ${connector.relatedCapTopPx}px;`}
						></span>
					{/each}
				</div>
			{/if}

			{#if shouldShowParagraphExplanationDecorations && paragraphExplanationScrollMarkers.length > 0}
				<div class="absolute top-2 right-1 bottom-2 z-20 w-2" on:mousedown={startManualScrollDrag}>
					{#each paragraphExplanationScrollMarkers as marker (`related-marker-${marker.paragraphId}`)}
						<span
							class="docx-related-scroll-marker"
							style={`top: ${marker.topPercent}%;`}
							role="button"
							tabindex="0"
							aria-label={`Go to related paragraph ${marker.paragraphId}`}
							on:click={() => jumpToRelatedParagraphMarker(marker.paragraphId)}
							on:keydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									jumpToRelatedParagraphMarker(marker.paragraphId);
								}
							}}
						></span>
					{/each}
				</div>
			{/if}

		</div>
	</div>

	{#if isCompactLayout && isRightDrawerOpen}
		<button
			type="button"
			class="absolute inset-0 z-30 bg-slate-900/25"
			on:click={() => (isRightDrawerOpen = false)}
			aria-label="Close side panel"
		></button>
	{/if}

	{#if !isCompactLayout && isRightDrawerOpen}
		<div
			role="separator"
			aria-orientation="vertical"
			aria-label="Resize side panel"
			tabindex="0"
			class="absolute top-0 bottom-0 z-50 w-1 cursor-col-resize bg-gray-200/80 transition hover:bg-teal-300 focus:bg-teal-400 focus:outline-none"
			style={`right: ${activeSidebarWidth + rightDrawerWidth}px;`}
			on:mousedown={startRightDrawerResize}
			on:keydown={handleRightDrawerResizeKeydown}
		>
			<span
				class="pointer-events-none absolute top-1/2 left-1/2 h-10 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-400/70"
			></span>
		</div>
	{/if}

	<aside
		class={`absolute top-0 bottom-0 z-40 flex min-h-0 flex-col overflow-hidden border-l border-gray-200 bg-white transition-transform duration-300 ${
			isCompactLayout ? 'right-16 w-[min(92vw,430px)]' : ''
		} ${
			isRightDrawerOpen
				? 'pointer-events-auto visible translate-x-0 opacity-100 shadow-2xl'
				: 'pointer-events-none invisible translate-x-[calc(100%+var(--drawer-rail-offset,58px)+20px)] opacity-0 shadow-none'
		}`}
		style={isCompactLayout
			? ''
			: `right: ${activeSidebarWidth}px; width: ${rightDrawerWidth}px; --drawer-rail-offset: ${activeSidebarWidth}px;`}
	>
		<header class="flex items-center justify-between border-b border-gray-200/90 bg-white/90 px-4 py-2.5">
			<div class="min-w-0 flex flex-1 items-center gap-2">
				<h2 class="inline-flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-semibold text-gray-700">
					<span class="shrink-0 text-blue-700">
						{#if activeRightPanelTab === 'related'}
							<RelatedParagraphsIcon className="h-4 w-4" strokeWidth={1.9} />
						{:else if activeRightPanelTab === 'analysis'}
							<ContradictionAnalysisIcon className="h-4 w-4" strokeWidth={1.9} />
						{:else if activeRightPanelTab === 'paragraph_explanation'}
							<ParagraphExplanationIcon className="h-4 w-4" strokeWidth={1.9} />
						{:else if activeRightPanelTab === 'redundancy'}
							<RedundancyAnalysisIcon className="h-4 w-4" strokeWidth={1.9} />
						{:else if activeRightPanelTab === 'summarize'}
							<SummarizeSimplifyIcon className="h-4 w-4" strokeWidth={1.9} />
						{:else if activeRightPanelTab === 'ambiguity'}
							<AmbiguityAnalysisIcon className="h-4 w-4" strokeWidth={1.9} />
						{:else if activeRightPanelTab === 'revisions'}
							<ParagraphRevisionsIcon className="h-4 w-4" strokeWidth={1.9} />
						{:else}
							<ContractChatAssistantIcon className="h-4 w-4" strokeWidth={1.9} />
						{/if}
					</span>
					<span>
						{toTitleCaseLabel(
							RIGHT_PANEL_TOOLS.find((item) => item.id === activeRightPanelTab)?.label ?? ''
						)}
					</span>
				</h2>

				{#if activeRightPanelTab === 'analysis'}
					<div class="flex shrink-0 items-center gap-1.5">
						<Button
							variant="outline"
							size="sm"
							class="h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
							disabled={!Boolean(activeDocumentId) || contradictionLoading || $loading}
							onclick={() => void loadSavedContradictions()}
						>
							Saved contradictions
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
							disabled={!Boolean(activeDocumentId) || contradictionLoading || $loading || backendGraphLoading}
							onclick={() => void searchContradictionsWithLlm()}
						>
							Search contradictions
						</Button>
					</div>
				{:else if activeRightPanelTab === 'paragraph_explanation'}
					<div class="flex shrink-0 items-center gap-1.5">
						<Button
							variant="outline"
							size="sm"
							class="h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
							disabled={!$selectedParagraph || paragraphExplanationLoading}
							onclick={() => void submitParagraphExplanation()}
						>
							Explain paragraph
						</Button>
					</div>
				{/if}
			</div>

			<Button
				variant="outline"
				size="icon-sm"
				class="ml-2 h-7 w-7 shrink-0 border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-100 hover:text-gray-700"
				onclick={() => (isRightDrawerOpen = false)}
				aria-label="Close"
				title="Close"
			>
				<CloseIcon className="h-4 w-4" />
			</Button>
		</header>

		{#if activeRightPanelTab === 'analysis'}
			<RightPanelAnalysis
				selectedParagraph={$selectedParagraph}
				contradictionLoading={contradictionLoading}
				revisionProcessingSteps={revisionProcessingSteps}
				selectedContradictionResult={selectedContradictionResult}
				selectedContradictionEvidence={selectedContradictionEvidence}
				bind:assistantInput
				bind:assistantThread
				assistantMessages={assistantMessages}
				assistantLoading={assistantLoading}
				assistantError={assistantError}
				contradictionQuickActionFreeLabel={QUICK_ACTION_WHY_CONTRADICTION_FREE}
				contradictionQuickActionAiLabel={QUICK_ACTION_WHY_CONTRADICTION_AI}
				contradictionTaxonomyLabels={CONTRADICTION_TAXONOMY_LABELS}
				contradictionTaxonomyColors={CONTRADICTION_TAXONOMY_COLORS}
				onSuggestContradictionFix={suggestContradictionFixFromChat}
				onRunContradictionQuickAction={(prompt) => void askQuickAction(prompt)}
				onSubmitAssistantQuestion={submitContradictionAssistantQuestion}
				onHandleAssistantInputKeydown={handleContradictionAssistantInputKeydown}
				onFocusNodeFromPanel={focusNodeFromPanel}
				onFocusEvidenceSnippet={focusEvidenceSnippet}
			/>
		{:else if activeRightPanelTab === 'redundancy'}
			<RightPanelRedundancy selectedParagraph={$selectedParagraph} />
		{:else if activeRightPanelTab === 'summarize'}
			<RightPanelSummarize selectedParagraph={$selectedParagraph} />
		{:else if activeRightPanelTab === 'ambiguity'}
			<RightPanelAmbiguity selectedParagraph={$selectedParagraph} />
		{:else if activeRightPanelTab === 'revisions'}
			<RightPanelRevisions
				selectedParagraph={$selectedParagraph}
				selectedChangeLog={selectedChangeLog}
				simplifyResult={simplifyResult}
				simplifyError={simplifyError}
				rewriteSource={latestRewriteSource}
				rewriteBusy={simplifyLoading || fixContradictionLoading}
				onReplaceRewrite={replaceSelectionWithSimplifiedText}
				onCopyRewrite={copySimplifiedSnippet}
				onRejectRewrite={cancelSimplifyResult}
				onFocusParagraph={focusNodeFromPanel}
				commitShortcutHint={COMMIT_SHORTCUT_HINT}
				commitShortcutLabel={COMMIT_SHORTCUT_LABEL}
				commitShortcutTooltip={COMMIT_SHORTCUT_TOOLTIP}
			/>
		{:else if activeRightPanelTab === 'related'}
			<RightPanelRelated
				selectedParagraph={$selectedParagraph}
				backendGraphLoading={backendGraphLoading}
				relatedProcessingSteps={relatedProcessingSteps}
				selectedRelatedParagraphs={selectedRelatedParagraphs}
				nodeEditStateById={nodeEditStateById}
				onFocusNodeFromPanel={jumpToNodeWithoutSelecting}
			/>
		{:else if activeRightPanelTab === 'paragraph_explanation'}
			<RightPanelParagraphExplanation
				selectedParagraph={$selectedParagraph}
				loading={paragraphExplanationLoading}
				error={paragraphExplanationError}
				explanation={paragraphExplanationAnswer}
				citations={paragraphExplanationCitations}
				onFocusNodeFromPanel={focusNodeFromPanel}
			/>
		{:else}
			<RightPanelAssistant
				bind:assistantProvider
				bind:assistantMode
				bind:assistantScope
				bind:selectedQuickAction
				bind:assistantInput
				bind:assistantThread
				assistantProviderLabel={assistantProviderLabel}
				assistantModeLabel={assistantModeLabel}
				assistantScopeLabel={assistantScopeLabel}
				quickActionLabel={quickActionLabel}
				providerOptions={PROVIDER_OPTIONS}
				modeOptions={MODE_OPTIONS}
				scopeOptions={SCOPE_OPTIONS}
				quickActions={QUICK_ACTIONS}
				assistantMessages={assistantMessages}
				assistantLoading={assistantLoading}
				assistantError={assistantError}
				contradictionTaxonomyOrder={CONTRADICTION_TAXONOMY_ORDER}
				contradictionTaxonomyLabels={CONTRADICTION_TAXONOMY_LABELS}
				contradictionTaxonomyColors={CONTRADICTION_TAXONOMY_COLORS}
				contradictionClaimSideColors={CONTRADICTION_CLAIM_SIDE_COLORS}
				onHandleQuickActionSelectionChange={handleQuickActionSelectionChange}
				onSuggestedQuestionClick={onSuggestedQuestionClick}
				onFocusNodeFromPanel={focusNodeFromPanel}
				onSubmitAssistantQuestion={submitAssistantQuestion}
				onHandleAssistantInputKeydown={handleAssistantInputKeydown}
			/>
		{/if}
	</aside>

	<aside
		class="absolute top-0 right-0 bottom-0 z-50 flex items-stretch justify-end transition-[width] duration-200 ease-out"
		style={`width: ${activeSidebarWidth}px;`}
		aria-label="Tools sidebar"
	>
		<Tooltip.Provider delayDuration={130}>
			<div
				class={`relative flex h-full flex-col border-l border-gray-200 bg-white py-2 transition-[width,padding] duration-200 ease-out ${
					sidebarLabelsPinned ? 'ml-auto w-[calc(100%-6px)] px-1.5' : 'w-9 items-center px-[2px]'
				}`}
			>
				<div class={`mb-3 flex w-full items-center ${sidebarLabelsPinned ? 'justify-between' : 'justify-center'}`}>
					{#if sidebarLabelsPinned}
						<span class="ml-1 text-[17px] font-semibold tracking-wide text-gray-600">{TOOL_BRAND_SHORT_NAME}</span>
					{/if}
					<Button
						variant="ghost"
						size="icon-sm"
						class="border border-transparent bg-transparent text-slate-500 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
						onclick={toggleSidebarLabels}
						aria-label={sidebarLabelsPinned ? 'Collapse tool names' : 'Expand tool names'}
						title={sidebarLabelsPinned ? 'Hide names' : 'Show names'}
					>
						<svg
							viewBox="0 0 24 24"
							fill="none"
							class="h-4 w-4"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							{#if sidebarLabelsPinned}
								<path d="M5 6v12M8 12h10m0 0-3-3m3 3-3 3" stroke-linecap="round" stroke-linejoin="round" />
							{:else}
								<path d="M19 6v12M16 12H6m0 0 3-3m-3 3 3 3" stroke-linecap="round" stroke-linejoin="round" />
							{/if}
						</svg>
					</Button>
				</div>

				<div class="mb-7 h-px w-full bg-gray-200" aria-hidden="true"></div>

				<div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
					{#each RIGHT_PANEL_TOOLS as item (item.id)}
						{@const isActive = activeRightPanelTab === item.id && isRightDrawerOpen}
						{@const label = toTitleCaseLabel(item.label)}
						{@const rowClasses = sidebarLabelsPinned
							? `h-8 w-full justify-start gap-1.5 px-1.5 text-[10px] font-semibold ${
									isActive
										? 'border-blue-200 bg-blue-50 text-blue-700 shadow-[0_4px_10px_rgba(59,130,246,0.2)]'
										: 'text-slate-600 hover:border-blue-100 hover:bg-blue-50/70 hover:text-blue-700'
								}`
							: `h-8 w-8 justify-center ${
									isActive
										? 'border-blue-300 bg-blue-100 text-blue-700 shadow-[0_0_0_2px_rgba(147,197,253,0.55),0_7px_16px_rgba(29,78,216,0.25)]'
										: 'text-blue-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:shadow-[0_6px_14px_rgba(59,130,246,0.22)]'
								}`}
						{#if sidebarLabelsPinned}
							<Button
								variant="ghost"
								class={rowClasses}
								onclick={() => selectRightTool(item.id)}
								aria-label={item.label}
							>
								{#if item.id === 'related'}
									<RelatedParagraphsIcon className="h-[17px] w-[17px]" />
								{:else if item.id === 'analysis'}
									<ContradictionAnalysisIcon className="h-[17px] w-[17px]" />
								{:else if item.id === 'paragraph_explanation'}
									<ParagraphExplanationIcon className="h-[17px] w-[17px]" />
								{:else if item.id === 'redundancy'}
									<RedundancyAnalysisIcon className="h-[17px] w-[17px]" />
								{:else if item.id === 'summarize'}
									<SummarizeSimplifyIcon className="h-[17px] w-[17px]" />
								{:else if item.id === 'ambiguity'}
									<AmbiguityAnalysisIcon className="h-[17px] w-[17px]" />
								{:else if item.id === 'revisions'}
									<ParagraphRevisionsIcon className="h-[17px] w-[17px]" />
								{:else}
									<ContractChatAssistantIcon className="h-[17px] w-[17px]" />
								{/if}
								<span class="truncate">{label}</span>
							</Button>
						{:else}
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											class={rowClasses}
											onclick={() => selectRightTool(item.id)}
											aria-label={item.label}
										>
											{#if item.id === 'related'}
												<RelatedParagraphsIcon className="h-[17px] w-[17px]" />
											{:else if item.id === 'analysis'}
												<ContradictionAnalysisIcon className="h-[17px] w-[17px]" />
											{:else if item.id === 'paragraph_explanation'}
												<ParagraphExplanationIcon className="h-[17px] w-[17px]" />
											{:else if item.id === 'redundancy'}
												<RedundancyAnalysisIcon className="h-[17px] w-[17px]" />
											{:else if item.id === 'summarize'}
												<SummarizeSimplifyIcon className="h-[17px] w-[17px]" />
											{:else if item.id === 'ambiguity'}
												<AmbiguityAnalysisIcon className="h-[17px] w-[17px]" />
											{:else if item.id === 'revisions'}
												<ParagraphRevisionsIcon className="h-[17px] w-[17px]" />
											{:else}
												<ContractChatAssistantIcon className="h-[17px] w-[17px]" />
											{/if}
										</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content
									side="left"
									sideOffset={10}
									arrowClasses="hidden"
									class="border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-md"
								>
									{label}
								</Tooltip.Content>
							</Tooltip.Root>
						{/if}
					{/each}
				</div>
			</div>
		</Tooltip.Provider>
	</aside>

</main>

<style>
	:global([contenteditable='true'])::selection {
		background: rgba(250, 204, 21, 0.3);
	}

	:global(.docx-relations-badge-host) {
		position: relative;
		transition: background-color 140ms ease;
	}

	:global(.docx-relations-badge-host)::before {
		content: '';
		position: absolute;
		right: -14px;
		top: 2px;
		bottom: 2px;
		width: 2px;
		border-radius: 9999px;
		background: #d1d5db;
		pointer-events: none;
	}

	:global(.docx-relations-badge-host[data-relations-tone='linked'])::before {
		background: #60a5fa;
	}

	:global(.docx-relations-badge-host)::after {
		content: attr(data-relations-count);
		position: absolute;
		right: -24px;
		top: 50%;
		display: inline-flex;
		height: 22px;
		width: 22px;
		min-width: 22px;
		transform: translateY(-50%);
		align-items: center;
		justify-content: center;
		border-radius: 9999px;
		border: 1px solid #d1d5db;
		background: #f3f4f6;
		color: #6b7280;
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
		pointer-events: none;
	}

	:global(.docx-relations-badge-host[data-relations-tone='linked'])::after {
		border-color: #93c5fd;
		background: #dbeafe;
		color: #1d4ed8;
	}

	:global(.related-badges-off .docx-relations-badge-host)::before,
	:global(.related-badges-off .docx-relations-badge-host)::after {
		display: none;
	}

	:global(.related-focus-on .docx-relations-badge-host)::before,
	:global(.related-focus-on .docx-relations-badge-host)::after {
		opacity: 0.2;
	}

	:global(.related-focus-on .docx-relations-badge-host.docx-related-badge-emphasis)::before,
	:global(.related-focus-on .docx-relations-badge-host.docx-related-badge-emphasis)::after {
		opacity: 1;
	}

	:global(.related-focus-on .docx-relations-badge-host.docx-related-badge--similarity)::before {
		background: #16a34a;
	}

	:global(.related-focus-on .docx-relations-badge-host.docx-related-badge--similarity)::after {
		border-color: #86efac;
		background: #dcfce7;
		color: #15803d;
	}

	:global(.related-focus-on .docx-relations-badge-host.docx-related-badge--reference)::before {
		background: #2563eb;
	}

	:global(.related-focus-on .docx-relations-badge-host.docx-related-badge--reference)::after {
		border-color: #93c5fd;
		background: #dbeafe;
		color: #1d4ed8;
	}

	:global(.docx-citation-flash) {
		animation: citation-flash 1.2s ease-out;
	}

	:global(.docx-related-selected) {
		outline: 2px solid #2563eb !important;
		outline-offset: 1px !important;
		background: rgba(37, 99, 235, 0.08) !important;
	}

	:global(.docx-related-selected:focus),
	:global(.docx-related-selected:focus-visible) {
		outline: 2px solid #2563eb !important;
		outline-offset: 1px !important;
		box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2) !important;
	}

	:global(.docx-related-linked) {
		box-shadow: none;
	}

	:global(.docx-related-context) {
		position: relative;
	}

	:global(.docx-related-context)::before {
		position: absolute;
		content: '';
		left: -7px;
		top: 2px;
		bottom: 2px;
		width: 2px;
		border-radius: 9999px;
		opacity: 0.9;
		pointer-events: none;
	}

	:global(.docx-related-context)::after {
		position: absolute;
		content: attr(data-related-label);
		left: -58px;
		top: 10px;
		width: 50px;
		text-align: right;
		font-size: 10px;
		font-weight: 600;
		line-height: 1.1;
		white-space: pre-line;
		opacity: 0.95;
		pointer-events: none;
		z-index: 1;
		text-shadow: 0 0 0.1px currentColor;
	}

	:global(.docx-related-context--with-sub)::after {
		content: attr(data-related-label) '\A' attr(data-related-sub);
		white-space: pre;
		line-height: 1.15;
	}

	:global(.docx-related-context--reference)::before {
		background: #0c41d4;
	}

	:global(.docx-related-context--reference)::after {
		color: #0c41d4;
	}

	:global(.docx-related-context--similarity)::before {
		background: #09993e;
	}

	:global(.docx-related-context--similarity)::after {
		color: #09993e;
	}

	:global(.docx-paragraph-explanation-selected) {
		outline: 2.5px solid rgba(37, 99, 235, 0.82) !important;
		/* outline-offset: 1px !important; */
		background: rgba(59, 130, 246, 0.1) !important;
		/* border-left: 1px solid rgba(37, 99, 235, 0.9) !important; */
		box-shadow:
			inset 0 0 0 9999px rgba(59, 130, 246, 0.08),
			inset 0 0 0 1px rgba(37, 99, 235, 0.4) !important;
	}

	:global(.docx-paragraph-explanation-selected:focus),
	:global(.docx-paragraph-explanation-selected:focus-visible) {
		outline: 2px solid rgba(37, 99, 235, 0.9) !important;
		outline-offset: 1px !important;
		box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.22) !important;
	}

	:global(.docx-paragraph-explanation-related) {
		outline: 2px solid #2563eb !important;
		outline-offset: 1px !important;
		border-left: 1px solid #2563eb !important;
		background: transparent !important;
		/* box-shadow: inset 0 0 0 1px #2563eb !important; */
	}

	:global(.docx-paragraph-explanation-bracket) {
		position: absolute;
		width: 2px;
		border-radius: 0;
		background: #2563eb;
		transform: translateX(-50%);
		opacity: 0.9;
		pointer-events: auto;
		cursor: pointer;
		transition: opacity 120ms ease, box-shadow 120ms ease, width 120ms ease;
	}

	:global(.docx-paragraph-explanation-bracket:hover),
	:global(.docx-paragraph-explanation-bracket:focus-visible) {
		outline: none;
		opacity: 1;
		width: 3px;
		box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.18);
	}

	:global(.docx-paragraph-explanation-cap) {
		position: absolute;
		width: 12px;
		height: 2px;
		border-radius: 0;
		background: #2563eb;
		transform: translate(-100%, -50%);
		opacity: 0.92;
	}

	:global(.docx-related-scroll-marker) {
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		transform: translateY(-50%);
		border-radius: 9999px;
		background: #2563eb;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.88);
		opacity: 0.9;
		cursor: pointer;
		transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
	}

	:global(.docx-related-scroll-marker:hover),
	:global(.docx-related-scroll-marker:focus-visible) {
		outline: none;
		opacity: 1;
		transform: translateY(-50%) scaleY(1.4);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.95), 0 0 0 2px rgba(37, 99, 235, 0.35);
	}

	:global(.docx-contradiction-highlight) {
		background: transparent;
		box-shadow: inset 3px 0 0 #dc2626;
	}

	:global(.docx-contradiction-highlight[data-contradiction-confidence-band='medium']) {
		background: transparent;
		box-shadow: inset 3px 0 0 #ef4444;
	}

	:global(.docx-contradiction-highlight[data-contradiction-confidence-band='low']) {
		background: transparent;
		box-shadow: inset 3px 0 0 #f97316;
	}

	:global(.docx-contradiction-selected) {
		outline: none;
	}

	:global(mark.docx-contradiction-snippet) {
		background: transparent;
		color: #7f1d1d;
		padding: 0 1px;
		border-radius: 1px;
		text-decoration: none;
	}

	:global(mark.docx-contradiction-snippet[data-contradiction-role='a']) {
		color: #991b1b;
		background: rgba(254, 202, 202, 0.26);
	}

	:global(mark.docx-contradiction-snippet[data-contradiction-role='b']) {
		color: #854d0e;
		background: rgba(254, 240, 138, 0.28);
	}

	:global(mark.docx-contradiction-snippet.docx-contradiction-snippet--active) {
		box-shadow: 0 0 0 1px rgba(30, 41, 59, 0.28);
	}

	:global(mark.docx-contradiction-snippet.docx-contradiction-snippet--active[data-contradiction-role='a']) {
		background: rgba(254, 202, 202, 0.58);
		box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.7);
	}

	:global(mark.docx-contradiction-snippet.docx-contradiction-snippet--active[data-contradiction-role='b']) {
		background: rgba(254, 240, 138, 0.6);
		box-shadow: 0 0 0 1px rgba(202, 138, 4, 0.72);
	}

	:global(.docx-contradiction-scroll-marker) {
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		transform: translateY(-50%);
		border-radius: 9999px;
		background: #dc2626;
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.85);
		opacity: 0.92;
		cursor: pointer;
		transition: transform 120ms ease, opacity 120ms ease, box-shadow 120ms ease;
	}

	:global(.docx-contradiction-scroll-marker:hover) {
		opacity: 1;
		transform: translateY(-50%) scaleY(1.4);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.95), 0 0 0 2px rgba(239, 68, 68, 0.35);
	}

	:global(.docx-contradiction-scroll-marker:focus-visible) {
		outline: none;
		opacity: 1;
		transform: translateY(-50%) scaleY(1.4);
		box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.95), 0 0 0 2px rgba(239, 68, 68, 0.45);
	}

	:global(.docx-contradiction-scroll-marker--medium) {
		background: #ef4444;
	}

	:global(.docx-contradiction-scroll-marker--low) {
		background: #f87171;
	}

	:global(.docx-contradiction-evidence-bracket) {
		position: absolute;
		width: 2px;
		border-radius: 0;
		background: linear-gradient(to bottom, #dc2626 0%, #eab308 100%);
		transform: translateX(-50%);
		opacity: 0.92;
	}

	:global(.docx-contradiction-evidence-cap) {
		position: absolute;
		width: 12px;
		height: 2px;
		border-radius: 0;
		background: linear-gradient(to right, rgba(220, 38, 38, 0.95) 0%, rgba(234, 179, 8, 0.95) 100%);
		transform: translate(-100%, -50%);
		opacity: 0.92;
	}

	:global(.docx-contradiction-evidence-dot) {
		position: absolute;
		height: 8px;
		width: 8px;
		transform: translate(-50%, -50%);
		border-radius: 9999px;
		border: 1px solid rgba(255, 255, 255, 0.9);
		box-shadow: 0 0 0 1px rgba(100, 116, 139, 0.28);
	}

	:global(.docx-contradiction-evidence-dot--a) {
		background: #dc2626;
	}

	:global(.docx-contradiction-evidence-dot--b) {
		background: #eab308;
	}

	:global(.docx-contradiction-evidence-label) {
		position: absolute;
		transform: translate(9px, -50%);
		font-size: 10px;
		font-weight: 700;
		line-height: 1;
	}

	:global(.docx-contradiction-evidence-label--a) {
		color: #b91c1c;
	}

	:global(.docx-contradiction-evidence-label--b) {
		color: #a16207;
	}

	@keyframes bounce {
		0%,
		100% {
			transform: translateY(0);
		}
		50% {
			transform: translateY(-3px);
		}
	}

	.animate-bounce {
		animation: bounce 2s infinite;
	}

	@keyframes citation-flash {
		0% {
			background-color: rgba(254, 243, 199, 0.8);
			box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.55);
		}
		70% {
			background-color: rgba(254, 252, 232, 0.65);
			box-shadow: 0 0 0 10px rgba(245, 158, 11, 0);
		}
		100% {
			background-color: transparent;
			box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
		}
	}

	@keyframes processing-dot-pulse {
		0%,
		100% {
			opacity: 0.2;
			transform: scale(0.85);
		}
		45% {
			opacity: 0.95;
			transform: scale(1.06);
		}
	}

	@keyframes processing-step-fade {
		0%,
		100% {
			opacity: 0.42;
		}
		50% {
			opacity: 0.95;
		}
	}

	@keyframes processing-ellipsis-dot {
		0%,
		100% {
			opacity: 0.15;
		}
		50% {
			opacity: 1;
		}
	}
</style>
