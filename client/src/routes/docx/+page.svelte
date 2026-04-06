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
		AssistantContextNode,
		AssistantContextRelation,
		AssistantMode,
		AssistantProvider,
		AssistantScope,
		ChangeLogState,
		ContradictionTaxonomyType,
		ContradictionAnalysisRequest,
		ContradictionParagraphResult,
		Edge as GraphEdge,
		Node as ParagraphNode,
		ParagraphEditState,
		RelatedParagraph,
		SimplifyRelatedParagraph,
		StructuredContradictionAnalysis,
		XmlNode,
		SimplifyResultState,
		SimplifyAuditRecord,
		RightPanelTab,
		ChatHighlightSegment,
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
		fetchFixContradictionSelection,
		fetchSavedContradictions,
		fetchSimplifySelection,
		loadBrowserDocx4js,
		resolveDocumentMeta,
		updateRelationBadge
	} from '$lib/utils/docx-page';
	import {
		ensureNodeEditState,
		formatReferenceSummary,
		getNodeCurrentText,
		truncateText
	} from '$lib/utils/edit';
	import {
		COMMIT_SHORTCUT_HINT,
		COMMIT_SHORTCUT_LABEL,
		COMMIT_SHORTCUT_TOOLTIP,
		EDITABLE_PARAGRAPH_CLASSES,
		MAX_SIMPLIFY_AUDIT_TRAIL,
		CONTRADICTION_OPENAI_MODEL_OPTIONS,
		CONTRADICTION_TAXONOMY_COLORS,
		CONTRADICTION_TAXONOMY_ORDER,
		CONTRADICTION_TAXONOMY_LABELS,
		MODE_OPTIONS,
		PROVIDER_OPTIONS,
		QUICK_ACTIONS,
		QUICK_ACTION_WHY_CONTRADICTION_AI,
		QUICK_ACTION_WHY_CONTRADICTION_FREE,
		SCOPE_OPTIONS,
		RIGHT_DRAWER_DEFAULT_WIDTH,
		RIGHT_TOOLBAR_WIDTH,
		RIGHT_DRAWER_KEYBOARD_STEP,
		RIGHT_DRAWER_MIN_WIDTH,
		RIGHT_DRAWER_MAX_RATIO,
		RIGHT_PANEL_TOOLS,
		FIX_CONTRADICTION_TOP_RELATED
	} from '$lib/constants/docx-viewer';
	import {
		buildTargetForWholeParagraph,
		buildTargetFromSelectionRange,
		computeSimplifyToolbarPosition,
		normalizeBounds,
		preserveBoundaryWhitespace,
		replaceParagraphTextRange,
		type SimplifyTarget
	} from '$lib/utils/docx/simplify-selection';
	import AmbiguityAnalysisIcon from '$lib/icons/AmbiguityAnalysisIcon.svelte';
	import CloseIcon from '$lib/icons/CloseIcon.svelte';
	import ContractChatAssistantIcon from '$lib/icons/ContractChatAssistantIcon.svelte';
	import ContradictionAnalysisIcon from '$lib/icons/ContradictionAnalysisIcon.svelte';
	import HammerShieldIcon from '$lib/icons/HammerShieldIcon.svelte';
	import LightningBoltIcon from '$lib/icons/LightningBoltIcon.svelte';
	import ParagraphRevisionsIcon from '$lib/icons/ParagraphRevisionsIcon.svelte';
	import RedundancyAnalysisIcon from '$lib/icons/RedundancyAnalysisIcon.svelte';
	import RelatedParagraphsIcon from '$lib/icons/RelatedParagraphsIcon.svelte';
	import SimplifyWandIcon from '$lib/icons/SimplifyWandIcon.svelte';
	import SummarizeSimplifyIcon from '$lib/icons/SummarizeSimplifyIcon.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { ScrollArea } from '$lib/components/ui/scroll-area/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';

	const initialInspectorState = createEmptyInspectorState();
	const nodeEditStateById = new Map<string, ParagraphEditState>();
	const paragraphElementById = new Map<string, HTMLElement>();
	const paragraphRelationHostById = new Map<string, HTMLElement>();
	const relationsCountByNodeId = new Map<string, number>();
	const simplifyAuditTrail: SimplifyAuditRecord[] = [];

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
	let simplifyLoading = false;
	let fixContradictionLoading = false;
	let simplifyError: string | null = null;

	let contradictionLoading = false;
	let contradictionError: string | null = null;
	let contradictionSource: string | null = null;
	let contradictionModel = 'gpt-4.1';
	let contradictionResultsByParagraphId = new Map<string, ContradictionParagraphResult>();
	let contradictionScrollMarkers: ContradictionScrollMarker[] = [];
	let contradictionMarkerFrame: number | null = null;
	let contradictionMarkerResizeObserver: ResizeObserver | null = null;
	let selectedContradictionResult: ContradictionParagraphResult | null = null;
	let selectedContradictionEvidence: ContradictionParagraphResult['evidence'] = null;

	let activeRightPanelTab: RightPanelTab = 'related';
	let isRightDrawerOpen = true;
	let isCompactLayout = false;
	let rightDrawerWidth = RIGHT_DRAWER_DEFAULT_WIDTH;
	let isResizingRightDrawer = false;
	$: activeDrawerWidth = !isCompactLayout && isRightDrawerOpen ? rightDrawerWidth : 0;

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
	$: contradictionModelLabel =
		CONTRADICTION_OPENAI_MODEL_OPTIONS.find((option) => option.value === contradictionModel)
			?.label ?? 'gpt-4.1';
	$: assistantProviderLabel =
		PROVIDER_OPTIONS.find((option) => option.value === assistantProvider)?.label ?? 'Provider';
	$: assistantModeLabel =
		MODE_OPTIONS.find((option) => option.value === assistantMode)?.label ?? 'Mode';
	$: assistantScopeLabel =
		SCOPE_OPTIONS.find((option) => option.value === assistantScope)?.label ?? 'Scope';
	$: quickActionLabel = selectedQuickAction || 'Quick action';

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
			return;
		}

		const hostRect = documentScrollHost.getBoundingClientRect();
		const hostScrollHeight = documentScrollHost.scrollHeight;
		if (!Number.isFinite(hostScrollHeight) || hostScrollHeight <= 0) {
			contradictionScrollMarkers = [];
			return;
		}

		const nextMarkers: ContradictionScrollMarker[] = [];

		for (const [paragraphId, result] of contradictionResultsByParagraphId.entries()) {
			if (!result.contradiction) continue;
			const element = paragraphElementById.get(paragraphId);
			if (!element) continue;

			const confidenceBand = resolveContradictionConfidenceBand(result.confidence);
			const elementRect = element.getBoundingClientRect();
			const centerOffset =
				elementRect.top - hostRect.top + documentScrollHost.scrollTop + elementRect.height / 2;
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

	function setContradictionResults(results: ContradictionParagraphResult[], source: string | null) {
		const next = new Map<string, ContradictionParagraphResult>();
		for (const row of results) {
			next.set(String(row.paragraph_id), row);
		}
		contradictionResultsByParagraphId = next;
		contradictionSource = source;
		applyContradictionHighlights();
	}

	function buildContradictionAnalysisPayload(): ContradictionAnalysisRequest | null {
		if (!activeDocumentId) return null;
		const selectedModel = contradictionModel.trim();

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
			contradictionError = 'No document is loaded.';
			return;
		}

		contradictionLoading = true;
		contradictionError = null;
		try {
			const response = await fetchSavedContradictions(activeDocumentId);
			setContradictionResults(response.paragraphResults ?? [], response.sourceFile);
		} catch (savedError) {
			contradictionError = getAxiosErrorMessage(savedError, 'Failed to load saved contradictions.');
		} finally {
			contradictionLoading = false;
		}
	}

	async function searchContradictionsWithLlm() {
		activeRightPanelTab = 'analysis';
		isRightDrawerOpen = true;

		if (backendGraphLoading) {
			contradictionError = 'Wait until graph generation finishes before searching contradictions.';
			return;
		}

		const payload = buildContradictionAnalysisPayload();
		if (!payload) {
			contradictionError = 'No paragraph context is available yet.';
			return;
		}

		contradictionLoading = true;
		contradictionError = null;
		try {
			const response = await fetchContradictionAnalysis(payload);
			const resolvedModel = response.model?.trim() || payload.model || 'default';
			setContradictionResults(response.paragraphResults ?? [], `llm:openai:${resolvedModel}`);
		} catch (analysisError) {
			contradictionError = getAxiosErrorMessage(
				analysisError,
				'Failed to search contradictions with LLM.'
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

	function buildAssistantNodeSnapshot(): AssistantContextNode[] {
		return get(paragraphs).map((node) => ({
			id: node.id,
			text: getNodeCurrentText(nodeEditStateById, node),
			paragraph_enum: node.paragraph_enum,
			page: node.page
		}));
	}

	function buildAssistantRelatedContext(): AssistantContextRelation[] {
		return selectedRelatedParagraphs.map((related) => ({
			id: related.node.id,
			relationTypes: related.relationTypes,
			semanticScore: related.semanticScore,
			references: related.references.map((reference) => `${reference.label} ${reference.value}`)
		}));
	}

	function buildFixRelatedContext(
		limit: number = FIX_CONTRADICTION_TOP_RELATED
	): SimplifyRelatedParagraph[] {
		if (limit <= 0) return [];
		return selectedRelatedParagraphs
			.slice(0, limit)
			.map((related) => ({
				id: related.node.id,
				text: getNodeCurrentText(nodeEditStateById, related.node),
				paragraph_enum: related.node.paragraph_enum,
				page: related.node.page,
				relationTypes: related.relationTypes,
				semanticScore: related.semanticScore,
				references: related.references.map((reference) => `${reference.label} ${reference.value}`)
			}))
			.filter((related) => related.text.trim().length > 0);
	}

	function buildAssistantHistoryPayload() {
		return assistantMessages.slice(-8).map((message) => ({
			role: message.role,
			content: message.content
		}));
	}

	function extractObjectFromText(text: string): Record<string, unknown> | null {
		const raw = (text || '').trim();
		if (!raw) return null;

		const fenced = raw
			.replace(/^```(?:json)?\s*/i, '')
			.replace(/\s*```$/i, '')
			.trim();

		const candidates = [raw, fenced];
		for (const candidate of candidates) {
			try {
				const parsed = JSON.parse(candidate);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					return parsed as Record<string, unknown>;
				}
			} catch {
				// ignore parse errors and continue with fallback extraction
			}
		}

		const objectMatch = fenced.match(/\{[\s\S]*\}/);
		if (objectMatch) {
			try {
				const parsed = JSON.parse(objectMatch[0]);
				if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
					return parsed as Record<string, unknown>;
				}
			} catch {
				return null;
			}
		}

		return null;
	}

	function normalizeHighlightCategory(raw: unknown): ContradictionTaxonomyType {
		const normalized = toNonEmptyString(raw)
			.toLowerCase()
			.replace(/[\s-]+/g, '_');
		const direct = normalizeContradictionType(normalized);
		if (direct !== 'other') return direct;

		// Backward compatibility for old highlight categories
		if (
			normalized === 'party' ||
			normalized === 'parties' ||
			normalized === 'role' ||
			normalized === 'roles' ||
			normalized === 'parties_and_roles' ||
			normalized === 'fundamental_entities'
		) {
			return 'authority';
		}
		if (
			normalized === 'obligation' ||
			normalized === 'obligations' ||
			normalized === 'prohibition' ||
			normalized === 'prohibitions' ||
			normalized === 'duty' ||
			normalized === 'duties' ||
			normalized === 'obligations_and_prohibitions' ||
			normalized === 'rights_and_permissions' ||
			normalized === 'individual_behaviors' ||
			normalized === 'motion_descriptors'
		) {
			return 'policy_reversal';
		}
		if (
			normalized === 'condition' ||
			normalized === 'conditions' ||
			normalized === 'exception' ||
			normalized === 'exceptions' ||
			normalized === 'conditions_and_exceptions' ||
			normalized === 'safety_situations'
		) {
			return 'specificity';
		}
		if (
			normalized === 'amount' ||
			normalized === 'amounts' ||
			normalized === 'amounts_and_timing' ||
			normalized === 'environment_entities'
		) {
			return 'numerical';
		}
		return 'other';
	}

	function toNonEmptyString(raw: unknown): string {
		return typeof raw === 'string' ? raw.trim() : '';
	}

	function clampConfidence(raw: unknown): number {
		if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
		return Math.max(0, Math.min(100, Math.round(raw)));
	}

	function normalizeClaimSource(raw: unknown): 'paragraph' | 'context' | 'unknown' {
		const value = toNonEmptyString(raw);
		if (value === 'paragraph' || value === 'context') return value;
		return 'unknown';
	}

	function normalizeClaimPolarity(raw: unknown): 'affirmed' | 'negated' | 'unknown' {
		const value = toNonEmptyString(raw);
		if (value === 'affirmed' || value === 'negated') return value;
		return 'unknown';
	}

	function normalizeHighlightClaimSide(raw: unknown): 'a' | 'b' | 'both' | 'unknown' | undefined {
		const value = toNonEmptyString(raw)
			.toLowerCase()
			.replace(/[\s-]+/g, '_');
		if (!value) return undefined;
		if (value === 'a' || value === 'claim_a') return 'a';
		if (value === 'b' || value === 'claim_b') return 'b';
		if (value === 'both') return 'both';
		return 'unknown';
	}

	function normalizeContradictionType(raw: unknown): ContradictionTaxonomyType {
		const value = toNonEmptyString(raw)
			.toLowerCase()
			.replace(/[\s-]+/g, '_');
		if (!value) return 'other';

		if (value === 'temporal' || value === 'time' || value === 'date') return 'temporal';
		if (
			value === 'numerical' ||
			value === 'numeric' ||
			value === 'amount' ||
			value === 'amounts' ||
			value === 'value' ||
			value === 'values' ||
			value === 'percentage' ||
			value === 'percentages'
		) {
			return 'numerical';
		}
		if (value === 'authority' || value === 'issuer' || value === 'source') return 'authority';
		if (value === 'process' || value === 'procedure' || value === 'workflow') return 'process';
		if (
			value === 'policy_reversal' ||
			value === 'negation' ||
			value === 'direct_negation' ||
			value === 'reversal'
		) {
			return 'policy_reversal';
		}
		if (
			value === 'specificity' ||
			value === 'scope' ||
			value === 'general_vs_specific' ||
			value === 'specific'
		) {
			return 'specificity';
		}
		return 'other';
	}

	function normalizeStructuredContradiction(
		raw: unknown,
		fallbackParagraphId: string,
		highlightSourceText: string
	): StructuredContradictionAnalysis | null {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
		const source = raw as Record<string, unknown>;

		const rawContradictions = Array.isArray(source.contradictions) ? source.contradictions : [];
		const contradictions = rawContradictions
			.map((entry, index) => {
				if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
				const item = entry as Record<string, unknown>;
				const rawClaimA =
					item.claim_a && typeof item.claim_a === 'object' && !Array.isArray(item.claim_a)
						? (item.claim_a as Record<string, unknown>)
						: {};
				const rawClaimB =
					item.claim_b && typeof item.claim_b === 'object' && !Array.isArray(item.claim_b)
						? (item.claim_b as Record<string, unknown>)
						: {};

				const claimA = {
					text: toNonEmptyString(rawClaimA.text),
					source: normalizeClaimSource(rawClaimA.source),
					paragraph_id: toNonEmptyString(rawClaimA.paragraph_id) || undefined,
					subject: toNonEmptyString(rawClaimA.subject) || undefined,
					relation: toNonEmptyString(rawClaimA.relation) || undefined,
					object: toNonEmptyString(rawClaimA.object) || undefined,
					polarity: normalizeClaimPolarity(rawClaimA.polarity)
				};

				const claimB = {
					text: toNonEmptyString(rawClaimB.text),
					source: normalizeClaimSource(rawClaimB.source),
					paragraph_id: toNonEmptyString(rawClaimB.paragraph_id) || undefined,
					subject: toNonEmptyString(rawClaimB.subject) || undefined,
					relation: toNonEmptyString(rawClaimB.relation) || undefined,
					object: toNonEmptyString(rawClaimB.object) || undefined,
					polarity: normalizeClaimPolarity(rawClaimB.polarity)
				};

				return {
					id: toNonEmptyString(item.id) || `c${index + 1}`,
					contradiction_type: normalizeContradictionType(item.contradiction_type),
					why: toNonEmptyString(item.why) || 'Potential contradiction detected.',
					claim_a: claimA,
					claim_b: claimB,
					conflicting_fields: Array.isArray(item.conflicting_fields)
						? item.conflicting_fields
								.map((field) => (typeof field === 'string' ? field.trim() : ''))
								.filter((field) => field.length > 0)
						: [],
					confidence: clampConfidence(item.confidence)
				};
			})
			.filter((item): item is NonNullable<typeof item> => item !== null);

		const rawHighlights = Array.isArray(source.highlights) ? source.highlights : [];
		const highlights = rawHighlights
			.map((entry) => {
				if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
				const item = entry as Record<string, unknown>;
				const phrase = toNonEmptyString(item.phrase);
				if (!phrase) return null;
				return {
					phrase,
					category: normalizeHighlightCategory(item.category),
					claim_id: toNonEmptyString(item.claim_id) || undefined,
					claim_side: normalizeHighlightClaimSide(item.claim_side),
					source: normalizeClaimSource(item.source)
				};
			})
			.filter((item): item is NonNullable<typeof item> => item !== null);

		if (contradictions.length === 0 && highlights.length === 0) {
			return null;
		}

		const contradictionCount =
			typeof source.contradiction_count === 'number' && Number.isFinite(source.contradiction_count)
				? Math.max(contradictions.length, Math.round(source.contradiction_count))
				: contradictions.length;
		const notes = Array.isArray(source.notes)
			? source.notes
					.map((note) => (typeof note === 'string' ? note.trim() : ''))
					.filter((note) => note.length > 0)
			: undefined;

		return {
			version: toNonEmptyString(source.version) || undefined,
			paragraph_id: toNonEmptyString(source.paragraph_id) || fallbackParagraphId,
			overall_summary:
				toNonEmptyString(source.overall_summary) ||
				`Detected ${contradictionCount} contradiction candidate(s).`,
			contradiction_count: contradictionCount,
			contradictions,
			highlights,
			notes,
			highlight_source_text: highlightSourceText
		};
	}

	function parseStructuredContradictionFromAnswer(
		answer: string,
		fallbackParagraphId: string,
		highlightSourceText: string
	): StructuredContradictionAnalysis | null {
		const objectCandidate = extractObjectFromText(answer);
		if (!objectCandidate) return null;
		return normalizeStructuredContradiction(
			objectCandidate,
			fallbackParagraphId,
			highlightSourceText
		);
	}

	function buildContradictionAiCostQuestion(
		paragraphId: string,
		paragraphText: string,
		contradiction: ContradictionParagraphResult
	): string {
		const evidence = contradiction.evidence;
		const evidenceA = evidence?.snippet_a?.trim() || '(missing)';
		const evidenceB = evidence?.snippet_b?.trim() || '(missing)';
		const sourceA = evidence?.source_a || 'unknown';
		const sourceB = evidence?.source_b || 'unknown';

		return [
			`Provide structured contradiction analysis for selected paragraph ${paragraphId}.`,
			'Return JSON only inside the "answer" field. Do not use markdown.',
			'JSON schema:',
			'{',
			'  "paragraph_id": "string",',
			'  "overall_summary": "string",',
			'  "contradiction_count": 0,',
			'  "contradictions": [',
			'    {',
			'      "id": "c1",',
			'      "contradiction_type": "temporal|numerical|authority|process|policy_reversal|specificity|other",',
			'      "why": "string",',
			'      "claim_a": {"text":"string","source":"paragraph|context|unknown","paragraph_id":"string","subject":"string","relation":"string","object":"string","polarity":"affirmed|negated|unknown"},',
			'      "claim_b": {"text":"string","source":"paragraph|context|unknown","paragraph_id":"string","subject":"string","relation":"string","object":"string","polarity":"affirmed|negated|unknown"},',
			'      "conflicting_fields": ["polarity","time","quantity","scope"],',
			'      "confidence": 0',
			'    }',
			'  ],',
			'  "highlights": [',
			'    {"phrase":"string","category":"temporal|numerical|authority|process|policy_reversal|specificity|other","claim_id":"c1","claim_side":"a|b|both|unknown","source":"paragraph|context|unknown"}',
			'  ]',
			'}',
			'Rules:',
			'- Use contradiction_type taxonomy from Table 1:',
			'  temporal: contradicts date/time of event.',
			'  numerical: conflicting numbers/values/percentages.',
			'  authority: conflicting issuer/source of statement.',
			'  process: conflicting procedures/operational routes.',
			'  policy_reversal: one statement directly negates the other.',
			'  specificity: one statement is broader/narrower than the other.',
			'- Ground every contradiction only on provided paragraph/context.',
			'- Prefer exact quoted claim text.',
			'- Keep contradiction_count equal to contradictions.length.',
			'- Include at least 3 highlights when possible.',
			'- For each highlight, set claim_side as a or b when it belongs to Claim A/B.',
			'- If uncertain, return fewer contradictions.',
			`Known classifier signal: contradiction=true, confidence=${Math.round(contradiction.confidence || 0)}, reason="${(contradiction.brief_reason || '').trim()}".`,
			`Evidence A (${sourceA}): "${evidenceA}"`,
			`Evidence B (${sourceB}): "${evidenceB}"`,
			'Selected paragraph text:',
			`"""${paragraphText}"""`
		].join('\n');
	}

	function buildChatHighlightSegments(
		analysis: StructuredContradictionAnalysis | undefined
	): ChatHighlightSegment[] {
		if (!analysis) return [];

		const sourceText = (analysis.highlight_source_text || '').trim();
		if (!sourceText) return [];

		type HighlightSpan = {
			start: number;
			end: number;
			category: ContradictionTaxonomyType;
			claimId?: string;
			claimSide?: 'a' | 'b';
			contradictionType?: ContradictionTaxonomyType;
			contradictionWhy?: string;
		};
		type ClaimSpan = {
			start: number;
			end: number;
			claimId: string;
			claimSide: 'a' | 'b';
		};

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

		const claimSpans: ClaimSpan[] = [];
		const pushClaimSpan = (claimId: string, claimSide: 'a' | 'b', rawClaimText: string) => {
			const phrase = rawClaimText.trim();
			if (phrase.length < 6) return;
			const phraseLower = phrase.toLowerCase();
			let fromIndex = 0;
			let hitCount = 0;
			while (fromIndex < textLower.length && hitCount < 1) {
				const start = textLower.indexOf(phraseLower, fromIndex);
				if (start < 0) break;
				claimSpans.push({
					start,
					end: start + phrase.length,
					claimId,
					claimSide
				});
				fromIndex = start + phrase.length;
				hitCount += 1;
			}
		};

		for (const contradiction of analysis.contradictions) {
			const claimId = toNonEmptyString(contradiction.id);
			if (!claimId) continue;
			pushClaimSpan(claimId, 'a', contradiction.claim_a.text || '');
			pushClaimSpan(claimId, 'b', contradiction.claim_b.text || '');
		}

		const highlightSpans: HighlightSpan[] = [];
		for (const highlight of analysis.highlights) {
			const phrase = highlight.phrase.trim();
			if (phrase.length < 2) continue;
			const phraseLower = phrase.toLowerCase();
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

			let fromIndex = 0;
			let hitCount = 0;
			while (fromIndex < textLower.length && hitCount < 3) {
				const start = textLower.indexOf(phraseLower, fromIndex);
				if (start < 0) break;
				highlightSpans.push({
					start,
					end: start + phrase.length,
					category: highlight.category,
					claimId,
					claimSide,
					contradictionType,
					contradictionWhy
				});
				fromIndex = start + phrase.length;
				hitCount += 1;
			}
		}

		if (highlightSpans.length === 0 && claimSpans.length === 0) {
			return [{ text: sourceText, category: null, interactive: false }];
		}

		const boundaries = new Set<number>([0, sourceText.length]);
		for (const span of highlightSpans) {
			boundaries.add(Math.max(0, Math.min(sourceText.length, span.start)));
			boundaries.add(Math.max(0, Math.min(sourceText.length, span.end)));
		}
		for (const span of claimSpans) {
			boundaries.add(Math.max(0, Math.min(sourceText.length, span.start)));
			boundaries.add(Math.max(0, Math.min(sourceText.length, span.end)));
		}
		const sortedBoundaries = Array.from(boundaries).sort((left, right) => left - right);

		const segments: ChatHighlightSegment[] = [];
		for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
			const start = sortedBoundaries[index];
			const end = sortedBoundaries[index + 1];
			if (end <= start) continue;
			const text = sourceText.slice(start, end);
			if (!text) continue;

			const claimSpan = claimSpans.find((span) => start >= span.start && end <= span.end);
			const highlightSpan = highlightSpans
				.filter((span) => start >= span.start && end <= span.end)
				.sort((left, right) => {
					const leftLen = left.end - left.start;
					const rightLen = right.end - right.start;
					return leftLen - rightLen;
				})[0];

			let claimId = highlightSpan?.claimId || claimSpan?.claimId;
			if (!claimId) {
				const overlapClaim = claimSpans.find((span) => start < span.end && end > span.start);
				claimId = overlapClaim?.claimId;
			}

			const contradiction = claimId ? contradictionById.get(claimId.toLowerCase()) : undefined;
			const nextSegment: ChatHighlightSegment = {
				text,
				category: highlightSpan?.category ?? null,
				claimId,
				claimSide: claimSpan?.claimSide || highlightSpan?.claimSide,
				contradictionType: contradiction?.contradiction_type || highlightSpan?.contradictionType,
				contradictionWhy: contradiction?.why || highlightSpan?.contradictionWhy,
				interactive: Boolean(highlightSpan || claimSpan || claimId)
			};

			const previous = segments[segments.length - 1];
			const canMerge =
				previous &&
				previous.category === nextSegment.category &&
				previous.claimId === nextSegment.claimId &&
				previous.claimSide === nextSegment.claimSide &&
				previous.contradictionType === nextSegment.contradictionType &&
				previous.contradictionWhy === nextSegment.contradictionWhy &&
				previous.interactive === nextSegment.interactive;
			if (canMerge) {
				previous.text += nextSegment.text;
			} else {
				segments.push(nextSegment);
			}
		}

		return segments;
	}

	function resolveChatHighlightSegmentStyle(segment: ChatHighlightSegment): string {
		if (segment.category) {
			const color = CONTRADICTION_TAXONOMY_COLORS[segment.category];
			return `background: ${color}22; border-bottom: 1.5px solid ${color};`;
		}
		return '';
	}

	function resolveChatHighlightSegmentTooltip(segment: ChatHighlightSegment): string | undefined {
		if (segment.category && segment.claimId) {
			const typeLabel =
				CONTRADICTION_TAXONOMY_LABELS[segment.contradictionType || segment.category];
			const header = `${segment.claimId.toUpperCase()} · ${typeLabel}`;
			if (segment.contradictionWhy) {
				return `${header}\n${segment.contradictionWhy}`;
			}
			return header;
		}
		if (segment.claimSide) {
			const claimLabel = segment.claimSide === 'a' ? 'Claim A' : 'Claim B';
			return segment.claimId ? `${claimLabel} (${segment.claimId.toUpperCase()})` : claimLabel;
		}
		if (segment.category) return CONTRADICTION_TAXONOMY_LABELS[segment.category];
		return undefined;
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

		const paragraphNodes = buildAssistantNodeSnapshot();
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
			selectedParagraphId: selected?.id ?? null,
			relatedParagraphs: buildAssistantRelatedContext(),
			paragraphNodes,
			history: buildAssistantHistoryPayload()
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
					suggestedQuestions: response.suggestedQuestions
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

	async function submitStructuredContradictionWhy(
		selected: ParagraphNode,
		contradiction: ContradictionParagraphResult
	) {
		if (assistantLoading) return;
		if (!activeDocumentId) {
			assistantError = 'No document is loaded.';
			return;
		}

		const paragraphNodes = buildAssistantNodeSnapshot();
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
			selectedParagraphId: selected.id,
			relatedParagraphs: buildAssistantRelatedContext(),
			paragraphNodes,
			history: buildAssistantHistoryPayload()
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
					suggestedQuestions: response.suggestedQuestions,
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

	function resetSimplifyState() {
		simplifyToolbarVisible = false;
		simplifyToolbarTop = 0;
		simplifyToolbarLeft = 0;
		simplifyTarget = null;
		simplifyResult = null;
		simplifyLoading = false;
		simplifyError = null;
	}

	function setSimplifyToolbarPosition(anchorRect: DOMRect) {
		const { left, top } = computeSimplifyToolbarPosition(
			anchorRect,
			window.innerWidth,
			window.innerHeight
		);
		simplifyToolbarLeft = left;
		simplifyToolbarTop = top;
	}

	function refreshSimplifyTarget() {
		const rangeTarget = buildTargetFromSelectionRange({ viewer });
		if (rangeTarget) {
			simplifyTarget = rangeTarget;
			simplifyToolbarVisible = true;
			setSimplifyToolbarPosition(rangeTarget.anchorRect);
			return;
		}

		const selected = get(selectedParagraph);
		const activeElement = document.activeElement;
		const activeInViewer = Boolean(activeElement && viewer?.contains(activeElement));
		if (selected?.id && activeInViewer) {
			const paragraphTarget = buildTargetForWholeParagraph(selected.id, paragraphElementById);
			if (paragraphTarget) {
				simplifyTarget = paragraphTarget;
				simplifyToolbarVisible = true;
				setSimplifyToolbarPosition(paragraphTarget.anchorRect);
				return;
			}
		}

		simplifyToolbarVisible = false;
		simplifyTarget = null;
	}

	function resolveActiveSimplifyTarget(): SimplifyTarget | null {
		const rangeTarget = buildTargetFromSelectionRange({ viewer });
		if (rangeTarget) return rangeTarget;

		const selected = get(selectedParagraph);
		if (selected?.id) {
			const paragraphTarget = buildTargetForWholeParagraph(selected.id, paragraphElementById);
			if (paragraphTarget) return paragraphTarget;
		}

		return simplifyTarget;
	}

	async function runFixContradiction() {
		if (fixContradictionLoading || assistantLoading || simplifyLoading) return;
		if (!activeDocumentId) {
			simplifyError = 'No document is loaded.';
			return;
		}

		const target = resolveActiveSimplifyTarget();
		if (!target) {
			simplifyError = 'Select text in a paragraph or focus a paragraph to fix contradictions.';
			return;
		}

		const paragraphNode = get(paragraphs).find((node) => node.id === target.paragraphId) ?? null;
		if (paragraphNode) setSelectedParagraphNode(paragraphNode);

		const contradiction = contradictionResultsByParagraphId.get(target.paragraphId);
		if (!contradiction) {
			simplifyError =
				'No contradiction result is available for this paragraph yet. Run "Search contradictions" first.';
			return;
		}

		if (!contradiction.contradiction) {
			simplifyError = 'This paragraph is not currently classified as contradiction.';
			return;
		}

		const bounds = normalizeBounds(
			target.selectionStart,
			target.selectionEnd,
			target.paragraphText.length
		);
		const selectionStart = bounds.start;
		const selectionEnd = bounds.end === bounds.start ? target.paragraphText.length : bounds.end;

		fixContradictionLoading = true;
		simplifyError = null;
		try {
			const response = await fetchFixContradictionSelection({
				documentId: activeDocumentId,
				provider: assistantProvider,
				paragraphId: target.paragraphId,
				paragraphText: target.paragraphText,
				selectionStart,
				selectionEnd,
				contradictionReason: contradiction.brief_reason,
				relatedParagraphs: buildFixRelatedContext()
			});

			simplifyResult = {
				payload: response,
				paragraphTextSnapshot: target.paragraphText,
				createdAt: new Date().toISOString()
			};

			simplifyAuditTrail.unshift({
				documentId: activeDocumentId,
				provider: response.provider,
				paragraphId: response.evidence.paragraph_id,
				selectionStart: response.evidence.selection_start,
				selectionEnd: response.evidence.selection_end,
				originalSnippet: response.originalSnippet,
				simplifiedSnippet: response.simplifiedSnippet,
				systemPrompt: response.audit.system_prompt,
				userPrompt: response.audit.user_prompt,
				modelResponse: response.audit.model_response,
				timestamp: new Date().toISOString()
			});

			if (simplifyAuditTrail.length > MAX_SIMPLIFY_AUDIT_TRAIL) {
				simplifyAuditTrail.length = MAX_SIMPLIFY_AUDIT_TRAIL;
			}
		} catch (fixRequestError) {
			simplifyError = getAxiosErrorMessage(
				fixRequestError,
				'Failed to fix contradiction for selected text.'
			);
		} finally {
			fixContradictionLoading = false;
			refreshSimplifyTarget();
		}
	}

	async function runSimplify() {
		if (simplifyLoading) return;
		if (!activeDocumentId) {
			simplifyError = 'No document is loaded.';
			return;
		}

		const target = resolveActiveSimplifyTarget();
		if (!target) {
			simplifyError = 'Select text in a paragraph or focus a paragraph to simplify.';
			return;
		}

		const safeBounds = normalizeBounds(
			target.selectionStart,
			target.selectionEnd,
			target.paragraphText.length
		);
		const selectionStart = safeBounds.start;
		const selectionEnd =
			safeBounds.end === safeBounds.start ? target.paragraphText.length : safeBounds.end;

		simplifyLoading = true;
		simplifyError = null;

		try {
			const response = await fetchSimplifySelection({
				documentId: activeDocumentId,
				provider: assistantProvider,
				paragraphId: target.paragraphId,
				paragraphText: target.paragraphText,
				selectionStart,
				selectionEnd
			});

			simplifyResult = {
				payload: response,
				paragraphTextSnapshot: target.paragraphText,
				createdAt: new Date().toISOString()
			};

			simplifyAuditTrail.unshift({
				documentId: activeDocumentId,
				provider: response.provider,
				paragraphId: response.evidence.paragraph_id,
				selectionStart: response.evidence.selection_start,
				selectionEnd: response.evidence.selection_end,
				originalSnippet: response.originalSnippet,
				simplifiedSnippet: response.simplifiedSnippet,
				systemPrompt: response.audit.system_prompt,
				userPrompt: response.audit.user_prompt,
				modelResponse: response.audit.model_response,
				timestamp: new Date().toISOString()
			});

			if (simplifyAuditTrail.length > MAX_SIMPLIFY_AUDIT_TRAIL) {
				simplifyAuditTrail.length = MAX_SIMPLIFY_AUDIT_TRAIL;
			}
		} catch (simplifyRequestError) {
			simplifyError = getAxiosErrorMessage(
				simplifyRequestError,
				'Failed to simplify the selected text.'
			);
		} finally {
			simplifyLoading = false;
			refreshSimplifyTarget();
		}
	}

	async function copySimplifiedSnippet() {
		if (!simplifyResult) return;
		if (!navigator.clipboard) {
			simplifyError = 'Clipboard access is unavailable in this browser.';
			return;
		}

		try {
			await navigator.clipboard.writeText(simplifyResult.payload.simplifiedSnippet);
		} catch (copyError) {
			simplifyError = copyError instanceof Error ? copyError.message : 'Failed to copy text.';
		}
	}

	function cancelSimplifyResult() {
		simplifyResult = null;
		simplifyError = null;
	}

	function replaceSelectionWithSimplifiedText() {
		if (!simplifyResult) return;

		const payload = simplifyResult.payload;
		const paragraphId = payload.evidence.paragraph_id;
		const paragraphElement = paragraphElementById.get(paragraphId);
		if (!paragraphElement) {
			simplifyError = 'Could not find the paragraph to replace.';
			return;
		}

		const currentParagraphText = normalizeEditableText(paragraphElement.innerText ?? '');
		let bounds = normalizeBounds(
			payload.evidence.selection_start,
			payload.evidence.selection_end,
			currentParagraphText.length
		);

		const snapshotText = simplifyResult.paragraphTextSnapshot;
		if (snapshotText !== currentParagraphText) {
			const locatedStart = currentParagraphText.indexOf(payload.originalSnippet);
			if (locatedStart >= 0) {
				bounds = {
					start: locatedStart,
					end: locatedStart + payload.originalSnippet.length
				};
			} else {
				simplifyError =
					'The paragraph changed after simplification. Please run Simplify again on the latest text.';
				return;
			}
		}

		const replacement = preserveBoundaryWhitespace(
			payload.originalSnippet,
			payload.simplifiedSnippet
		);
		replaceParagraphTextRange(paragraphElement, bounds.start, bounds.end, replacement);
		paragraphElement.dispatchEvent(new Event('input', { bubbles: true }));
		paragraphElement.focus();

		const selectedNode = get(paragraphs).find((node) => node.id === paragraphId) ?? null;
		if (selectedNode) setSelectedParagraphNode(selectedNode);

		simplifyResult = null;
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
		resetInspectorState();
		resetAssistantState();
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
		const desiredWidth = window.innerWidth - RIGHT_TOOLBAR_WIDTH - event.clientX;
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
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			setRightDrawerWidth(rightDrawerWidth + RIGHT_DRAWER_KEYBOARD_STEP);
			return;
		}
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			setRightDrawerWidth(rightDrawerWidth - RIGHT_DRAWER_KEYBOARD_STEP);
		}
	}

	function selectRightTool(tabId: RightPanelTab) {
		if (activeRightPanelTab === tabId && isRightDrawerOpen) {
			isRightDrawerOpen = false;
			return;
		}
		activeRightPanelTab = tabId;
		isRightDrawerOpen = true;
	}

	onMount(() => {
		const handleDocumentSelectionChange = () => {
			refreshSimplifyTarget();
			scheduleContradictionScrollMarkerRefresh();
		};
		const handleViewportResize = () => {
			refreshViewportMode();
			handleDocumentSelectionChange();
			setRightDrawerWidth(rightDrawerWidth);
		};

		document.addEventListener('selectionchange', handleDocumentSelectionChange);
		document.addEventListener('mouseup', handleDocumentSelectionChange);
		document.addEventListener('keyup', handleDocumentSelectionChange);
		window.addEventListener('resize', handleViewportResize);
		window.addEventListener('scroll', handleDocumentSelectionChange, true);
		documentScrollHost?.addEventListener('scroll', handleDocumentSelectionChange, {
			passive: true
		});
		refreshViewportMode();
		setRightDrawerWidth(rightDrawerWidth);

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
			window.removeEventListener('resize', handleViewportResize);
			window.removeEventListener('scroll', handleDocumentSelectionChange, true);
			documentScrollHost?.removeEventListener('scroll', handleDocumentSelectionChange);
			stopRightDrawerResize();
			contradictionMarkerResizeObserver?.disconnect();
			contradictionMarkerResizeObserver = null;
			if (contradictionMarkerFrame != null) {
				window.cancelAnimationFrame(contradictionMarkerFrame);
				contradictionMarkerFrame = null;
			}
			clearRenderedDocument();
		};
	});
</script>

<main class="relative flex h-screen w-screen overflow-hidden bg-gray-100 font-sans">
	<div
		class="flex min-w-0 flex-col border-r border-gray-300"
		style={isCompactLayout
			? ''
			: `width: calc(100% - ${RIGHT_TOOLBAR_WIDTH + activeDrawerWidth}px);`}
	>
		<header
			class="flex flex-none items-center justify-between gap-3 border-b border-gray-200/90 bg-white/90 px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur supports-[backdrop-filter]:bg-white/75"
		>
			<div class="min-w-0">
				<p class="text-[11px] text-gray-500">Document</p>
				<div class="truncate text-sm font-medium text-gray-800">
					{activeDocumentName || 'No document selected'}
				</div>
			</div>
			<div class="flex items-center gap-1.5">
				<Button
					variant="outline"
					size="sm"
					onclick={() => void loadSavedContradictions()}
					disabled={!activeDocumentId || contradictionLoading || $loading}
					class="h-7 border-amber-200 bg-amber-50 px-2.5 text-[10px] text-amber-700 hover:border-amber-300 hover:bg-amber-100"
				>
					Saved Contradictions
				</Button>
				<Select.Root
					type="single"
					bind:value={contradictionModel}
					disabled={contradictionLoading || $loading || backendGraphLoading}
				>
					<Select.Trigger
						size="sm"
						class="h-7 w-[170px] border-gray-200 bg-white px-1.5 text-[10px] text-gray-600"
						title="Realtime contradiction model"
					>
						{contradictionModelLabel}
					</Select.Trigger>
					<Select.Content>
						{#each CONTRADICTION_OPENAI_MODEL_OPTIONS as option}
							<Select.Item value={option.value} label={option.label} class="text-[10px]">
								{option.label}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Button
					variant="destructive"
					size="sm"
					onclick={() => void searchContradictionsWithLlm()}
					disabled={!activeDocumentId || contradictionLoading || $loading || backendGraphLoading}
					class="h-7 border-red-200 bg-red-50 px-2.5 text-[10px] text-red-700 hover:border-red-300 hover:bg-red-100"
				>
					Search contradictions
				</Button>
			</div>
		</header>

		{#if contradictionError || contradictionResultsByParagraphId.size > 0}
			<Card.Root size="sm" class="mx-4 mt-2 border-gray-200 py-0 text-[11px]">
				<Card.Content class="px-3 py-2 text-gray-600">
					{#if contradictionError}
						<p class="text-red-700">{contradictionError}</p>
					{:else}
						<p>
							{contradictionCount} paragraph(s) with highlighted contradiction(s).
							{#if contradictionSource}
								<span class="text-gray-500"> Source: {contradictionSource}</span>
							{/if}
						</p>
					{/if}
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

			{#if contradictionScrollMarkers.length > 0}
				<div class="pointer-events-none absolute top-2 right-1 bottom-2 z-20 w-2">
					{#each contradictionScrollMarkers as marker (marker.paragraphId)}
						<span
							class={`docx-contradiction-scroll-marker docx-contradiction-scroll-marker--${marker.confidenceBand}`}
							style={`top: ${marker.topPercent}%;`}
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
			style={`right: ${RIGHT_TOOLBAR_WIDTH + rightDrawerWidth}px;`}
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
			: `right: ${RIGHT_TOOLBAR_WIDTH}px; width: ${rightDrawerWidth}px; --drawer-rail-offset: ${RIGHT_TOOLBAR_WIDTH}px;`}
	>
		<header
			class="flex items-center justify-between border-b border-gray-200/90 bg-white/90 px-4 py-2.5"
		>
			<div class="min-w-0">
				<h2 class="inline-flex items-center gap-2 truncate text-sm font-semibold text-gray-700">
					<span class="shrink-0 text-blue-700">
						{#if activeRightPanelTab === 'related'}
							<RelatedParagraphsIcon className="h-4 w-4" strokeWidth={1.9} />
						{:else if activeRightPanelTab === 'analysis'}
							<ContradictionAnalysisIcon className="h-4 w-4" strokeWidth={1.9} />
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
			</div>
			<Button
				variant="outline"
				size="icon-sm"
				class="h-7 w-7 border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-100 hover:text-gray-700"
				onclick={() => (isRightDrawerOpen = false)}
				aria-label="Close"
				title="Close"
			>
				<CloseIcon className="h-4 w-4" />
			</Button>
		</header>

		{#if activeRightPanelTab === 'analysis'}
			<section class="flex min-h-0 flex-1 flex-col">
				<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
					<p class="text-[11px] text-gray-500">
						Inspect contradictions, confidence, and evidence for the selected paragraph.
					</p>
				</header>

				<ScrollArea class="min-h-0 flex-1">
					<div class="space-y-2 p-3">
						{#if contradictionLoading}
							<div
								class="rounded-xl border border-gray-200 bg-gray-50/90 p-3 text-[11px] text-gray-700"
							>
								<p class="mb-2 text-[10px] font-semibold text-gray-500">Processing panel</p>
								<ul class="space-y-1.5 text-[12px] text-gray-600">
									{#each revisionProcessingSteps as step, index}
										<li
											class="flex [animation:processing-step-fade_1.35s_ease-in-out_infinite] items-center gap-2 opacity-[0.45]"
											style={`animation-delay: ${index * 220}ms;`}
										>
											<span
												class="h-1.5 w-1.5 [animation:processing-dot-pulse_1.2s_ease-in-out_infinite] rounded-full bg-gray-500 opacity-[0.35]"
												style={`animation-delay: ${index * 220}ms;`}
												aria-hidden="true"
											></span>
											<span class="text-gray-600">
												{step.label}
												<span class="ml-px inline-flex min-w-[14px]" aria-hidden="true">
													<span
														class="[animation:processing-ellipsis-dot_0.95s_ease-in-out_infinite] opacity-[0.18]"
														style="animation-delay: 0ms;">.</span
													>
													<span
														class="[animation:processing-ellipsis-dot_0.95s_ease-in-out_infinite] opacity-[0.18]"
														style="animation-delay: 140ms;">.</span
													>
													<span
														class="[animation:processing-ellipsis-dot_0.95s_ease-in-out_infinite] opacity-[0.18]"
														style="animation-delay: 280ms;">.</span
													>
												</span>
											</span>
										</li>
									{/each}
								</ul>
							</div>
						{/if}

						{#if !$selectedParagraph}
							<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
								<p class="text-[10px] font-medium">Select a paragraph to analyze contradictions</p>
								<p class="mt-1 text-[10px] text-gray-400">
									Choose a paragraph in the document on the left.
								</p>
							</div>
						{:else if !selectedContradictionResult}
							<Card.Root size="sm" class="border-gray-200 bg-gray-50 py-0 text-[11px]">
								<Card.Content class="px-3 py-2 text-gray-600">
									No contradiction result is available for this paragraph yet. Run "Search
									contradictions" first.
								</Card.Content>
							</Card.Root>
						{:else if !selectedContradictionResult.contradiction}
							<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
								<p class="text-[10px] italic">No contradiction found in this paragraph.</p>
							</div>
						{:else}
							<Card.Root size="sm" class="border-red-200 bg-red-50/65 py-0 text-[11px]">
								<Card.Content class="px-3 py-2 text-red-800">
									<p>
										Confidence: {selectedContradictionResult.confidence}% · {selectedContradictionResult.brief_reason}
									</p>
								</Card.Content>
							</Card.Root>

							{#if selectedContradictionEvidence?.snippet_a?.trim() && selectedContradictionEvidence?.snippet_b?.trim()}
								<div class="overflow-hidden rounded border border-red-200 bg-red-50/70 text-[11px]">
									<div class="border-b border-red-200 bg-red-100/70 px-3 py-1.5">
										<p class="text-[9px] font-semibold text-red-700">Contradiction evidence</p>
									</div>
									<div class="space-y-2 p-2.5">
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
												class="h-auto w-full justify-start px-0 py-0 text-left leading-relaxed text-red-800 hover:bg-transparent hover:text-red-900"
												onclick={() =>
													selectedContradictionResult &&
													focusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'a')}
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
												class="h-auto w-full justify-start px-0 py-0 text-left leading-relaxed text-red-800 hover:bg-transparent hover:text-red-900"
												onclick={() =>
													selectedContradictionResult &&
													focusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'b')}
											>
												{selectedContradictionEvidence.snippet_b}
											</Button>
										</div>
									</div>
								</div>
							{:else}
								<Card.Root size="sm" class="border-gray-200 bg-gray-50 py-0 text-[11px]">
									<Card.Content class="px-3 py-2 text-gray-600">
										Evidence snippets are unavailable for this contradiction.
									</Card.Content>
								</Card.Root>
							{/if}
						{/if}
					</div>
				</ScrollArea>
			</section>
		{:else if activeRightPanelTab === 'redundancy'}
			<section class="flex min-h-0 flex-1 flex-col">
				<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
					<p class="text-[11px] text-gray-500">
						Inspect repetitive statements and overlapping ideas in the selected paragraph.
					</p>
				</header>
				<ScrollArea class="min-h-0 flex-1">
					<div class="p-3">
						{#if !$selectedParagraph}
							<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
								<p class="text-[10px] font-medium">Select a paragraph to analyze redundancies</p>
								<p class="mt-1 text-[10px] text-gray-400">
									Choose a paragraph in the document on the left.
								</p>
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
		{:else if activeRightPanelTab === 'summarize'}
			<section class="flex min-h-0 flex-1 flex-col">
				<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
					<p class="text-[11px] text-gray-500">
						Get concise rewrite suggestions to summarize and simplify the selected paragraph.
					</p>
				</header>
				<ScrollArea class="min-h-0 flex-1">
					<div class="p-3">
						{#if !$selectedParagraph}
							<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
								<p class="text-[10px] font-medium">Select a paragraph to summarize and simplify</p>
								<p class="mt-1 text-[10px] text-gray-400">
									Choose a paragraph in the document on the left.
								</p>
							</div>
						{:else}
							<Card.Root size="sm" class="border-gray-200 bg-gray-50 py-0 text-[11px]">
								<Card.Content class="px-3 py-2 text-gray-600">
									Summarization and simplification panel is available in the UI. Backend suggestions
									will be added next.
								</Card.Content>
							</Card.Root>
						{/if}
					</div>
				</ScrollArea>
			</section>
		{:else if activeRightPanelTab === 'ambiguity'}
			<section class="flex min-h-0 flex-1 flex-col">
				<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
					<p class="text-[11px] text-gray-500">
						Inspect ambiguous wording and unclear obligations in the selected paragraph.
					</p>
				</header>
				<ScrollArea class="min-h-0 flex-1">
					<div class="p-3">
						{#if !$selectedParagraph}
							<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
								<p class="text-[10px] font-medium">Select a paragraph to analyze ambiguities</p>
								<p class="mt-1 text-[10px] text-gray-400">
									Choose a paragraph in the document on the left.
								</p>
							</div>
						{:else}
							<Card.Root size="sm" class="border-gray-200 bg-gray-50 py-0 text-[11px]">
								<Card.Content class="px-3 py-2 text-gray-600">
									Ambiguity analysis UI is ready. Backend detection will be connected in a future
									step.
								</Card.Content>
							</Card.Root>
						{/if}
					</div>
				</ScrollArea>
			</section>
		{:else if activeRightPanelTab === 'revisions'}
			<section class="flex min-h-0 flex-1 flex-col">
				<header
					class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2"
				>
					<p class="text-[11px] text-gray-500">
						View modification history and compare original versus edited content.
					</p>
					<div class="group relative inline-flex">
						<Badge
							variant="outline"
							class="h-5 cursor-help border-gray-200 bg-white px-2 text-[9px] font-bold tracking-tight text-gray-600"
							title={COMMIT_SHORTCUT_HINT}
						>
							{COMMIT_SHORTCUT_LABEL}
						</Badge>
						<div
							class="pointer-events-none absolute top-full right-0 z-20 mt-1 rounded bg-gray-800 px-2 py-1 text-[9px] font-bold tracking-tight whitespace-nowrap text-white opacity-0 shadow-2xl ring-1 ring-white/20 transition-opacity group-hover:opacity-100 {selectedChangeLog.hasChanges
								? 'animate-bounce'
								: ''}"
						>
							{COMMIT_SHORTCUT_TOOLTIP}
						</div>
					</div>
				</header>

				<ScrollArea class="min-h-0 flex-1">
					<div class="space-y-2 p-3">
						{#if !$selectedParagraph}
							<div class="flex flex-col items-center justify-center py-3 text-center text-gray-400">
								<p class="text-[10px] font-medium">Select a paragraph to view revision history</p>
								<p class="mt-1 text-[10px] text-gray-400">
									Choose a paragraph in the document on the left.
								</p>
							</div>
						{:else if !selectedChangeLog.hasChanges}
							<div class="flex flex-col items-center justify-center py-2 text-gray-300">
								<p class="text-[10px] italic">No modifications recorded for this paragraph.</p>
							</div>
						{:else}
							<div class="overflow-hidden rounded border border-gray-100 text-[11px]">
								<div class="border-b border-gray-50 bg-red-50/20 px-3 py-2">
									<span class="mb-1 block text-[8px] font-semibold text-red-300">Original</span>
									<p class="font-mono leading-relaxed text-red-700/80">
										{#each selectedChangeLog.oldSegments as segment}
											{#if segment.changed}
												<mark class="bg-red-100 px-0.5 text-red-800">{segment.value}</mark>
											{:else}
												<span>{segment.value}</span>
											{/if}
										{/each}
									</p>
								</div>

								<div class="bg-green-50/20 px-3 py-2">
									<span class="mb-1 block text-[8px] font-semibold text-green-300">Modified</span>
									<p class="font-mono leading-relaxed text-green-800">
										{#each selectedChangeLog.newSegments as segment}
											{#if segment.changed}
												<mark class="bg-green-100 px-0.5 text-green-800">{segment.value}</mark>
											{:else}
												<span>{segment.value}</span>
											{/if}
										{/each}
									</p>
								</div>
							</div>
						{/if}
					</div>
				</ScrollArea>
			</section>
		{:else if activeRightPanelTab === 'related'}
			<section class="flex min-h-0 flex-1 flex-col">
				<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
					<p class="text-[11px] text-gray-500">
						View linked paragraphs, relation types, and semantic similarity context.
					</p>
				</header>

				<ScrollArea class="min-h-0 flex-1 bg-gray-50/30">
					<div class="flex min-h-full flex-col space-y-2 p-2">
						{#if backendGraphLoading}
							<div
								class="rounded-xl border border-gray-200 bg-gray-50/90 p-3 text-[11px] text-gray-700"
							>
								<p class="mb-2 text-[10px] font-semibold text-gray-500">Processing panel</p>
								<ul class="space-y-1.5 text-[12px] text-gray-600">
									{#each relatedProcessingSteps as step, index}
										<li
											class="flex [animation:processing-step-fade_1.35s_ease-in-out_infinite] items-center gap-2 opacity-[0.45]"
											style={`animation-delay: ${index * 220}ms;`}
										>
											<span
												class="h-1.5 w-1.5 [animation:processing-dot-pulse_1.2s_ease-in-out_infinite] rounded-full bg-gray-500 opacity-[0.35]"
												style={`animation-delay: ${index * 220}ms;`}
												aria-hidden="true"
											></span>
											<span class="text-gray-600">
												{step.label}
												<span class="ml-px inline-flex min-w-[14px]" aria-hidden="true">
													<span
														class="[animation:processing-ellipsis-dot_0.95s_ease-in-out_infinite] opacity-[0.18]"
														style="animation-delay: 0ms;">.</span
													>
													<span
														class="[animation:processing-ellipsis-dot_0.95s_ease-in-out_infinite] opacity-[0.18]"
														style="animation-delay: 140ms;">.</span
													>
													<span
														class="[animation:processing-ellipsis-dot_0.95s_ease-in-out_infinite] opacity-[0.18]"
														style="animation-delay: 280ms;">.</span
													>
												</span>
											</span>
										</li>
									{/each}
								</ul>
							</div>
						{:else if !$selectedParagraph}
							<div class="flex flex-1 flex-col items-center justify-center py-12 text-gray-300">
								<LightningBoltIcon className="mb-2 h-6 w-6 opacity-20" />
								<p class="text-center text-[10px] font-medium">
									Select a paragraph to view related items
								</p>
								<p class="mt-1 text-center text-[10px] text-gray-400">
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
									on:click={() => focusNodeFromPanel(related.node.id)}
								>
									<div class="mb-2 flex items-center justify-between">
										<div class="flex flex-wrap items-center gap-1.5">
											{#if related.relationTypes.includes('semantic_similarity')}
												<Badge
													variant="outline"
													class="h-4 border-green-100 bg-green-50 px-1.5 text-[9px] font-semibold text-green-600"
												>
													Similarity
												</Badge>
											{/if}
											{#if related.relationTypes.includes('reference')}
												<Badge
													variant="outline"
													class="h-4 border-blue-100 bg-blue-50 px-1.5 text-[9px] font-semibold text-blue-600"
												>
													Reference
												</Badge>
											{/if}
											{#if related.semanticScore != null}
												<Badge
													variant="outline"
													class="h-4 border-gray-200 bg-white px-1.5 text-[9px] font-semibold text-gray-500"
												>
													{(related.semanticScore * 100).toFixed(1)}%
												</Badge>
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
		{:else}
			<section class="flex min-h-0 flex-1 flex-col bg-white">
				<header
					class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2"
				>
					<p class="text-[11px] text-gray-500">
						Ask questions and get contextual help grounded in the selected contract.
					</p>
					<Select.Root type="single" bind:value={assistantProvider}>
						<Select.Trigger
							size="sm"
							class="h-6 w-[130px] border-gray-200 bg-white px-1.5 text-[10px] font-semibold text-gray-600"
						>
							{assistantProviderLabel}
						</Select.Trigger>
						<Select.Content>
							{#each PROVIDER_OPTIONS as option}
								<Select.Item
									value={option.value}
									label={option.label}
									class="text-[10px] font-semibold"
								>
									{option.label}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</header>

				<div class="grid grid-cols-3 gap-1.5 border-b border-gray-100 bg-gray-50/60 px-2 py-2">
					<Select.Root type="single" bind:value={assistantMode}>
						<Select.Trigger
							size="sm"
							class="h-7 w-full min-w-0 border-gray-200 bg-white px-2 text-[10px] font-semibold text-gray-600"
						>
							{assistantModeLabel}
						</Select.Trigger>
						<Select.Content>
							{#each MODE_OPTIONS as option}
								<Select.Item
									value={option.value}
									label={option.label}
									class="text-[10px] font-semibold"
								>
									{option.label}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>

					<Select.Root type="single" bind:value={assistantScope}>
						<Select.Trigger
							size="sm"
							class="h-7 w-full min-w-0 border-gray-200 bg-white px-2 text-[10px] font-semibold text-gray-600"
						>
							{assistantScopeLabel}
						</Select.Trigger>
						<Select.Content>
							{#each SCOPE_OPTIONS as option}
								<Select.Item
									value={option.value}
									label={option.label}
									class="text-[10px] font-semibold"
								>
									{option.label}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>

					<Select.Root
						type="single"
						bind:value={selectedQuickAction}
						onValueChange={() => handleQuickActionSelectionChange()}
					>
						<Select.Trigger
							size="sm"
							class="h-7 w-full min-w-0 border-gray-200 bg-white px-2 text-[10px] font-semibold text-gray-600"
						>
							{quickActionLabel}
						</Select.Trigger>
						<Select.Content>
							{#each QUICK_ACTIONS as action}
								<Select.Item value={action} label={action} class="text-[10px] font-semibold">
									{action}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

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
												<div class="rounded border border-gray-200 bg-gray-50 px-2 py-2">
													<p class="mb-1 text-[9px] font-semibold text-gray-500">
														KG highlight preview
													</p>
													<p class="leading-relaxed text-gray-700">
														{#each buildChatHighlightSegments(message.structuredContradiction) as segment}
															{#if segment.interactive}
																<span
																	class="inline rounded-sm border-0 bg-transparent px-[2px] py-[1px] text-left text-inherit"
																	style={resolveChatHighlightSegmentStyle(segment)}
																	title={resolveChatHighlightSegmentTooltip(segment)}
																>
																	{segment.text}
																</span>
															{:else}
																<span>{segment.text}</span>
															{/if}
														{/each}
													</p>

													<div class="mt-2 flex flex-wrap gap-2">
														{#each CONTRADICTION_TAXONOMY_ORDER as category}
															<Badge
																variant="outline"
																class="h-4 items-center gap-1 border-gray-200 bg-white px-1.5 text-[9px] text-gray-600"
															>
																<span
																	class="inline-flex h-2 w-2 rounded-full"
																	style={`background: ${CONTRADICTION_TAXONOMY_COLORS[category]};`}
																></span>
																{CONTRADICTION_TAXONOMY_LABELS[category]}
															</Badge>
														{/each}
													</div>
												</div>
											{/if}

											{#if message.structuredContradiction.contradictions.length > 0}
												<div class="space-y-1.5">
													{#each message.structuredContradiction.contradictions as contradictionItem}
														<Card.Root size="sm" class="border-red-200 bg-red-50/55 py-0">
															<Card.Content class="px-2 py-2">
																<div class="mb-1 flex items-center justify-between gap-2">
																	<p class="text-[9px] font-semibold text-red-700">
																		{contradictionItem.id} · {CONTRADICTION_TAXONOMY_LABELS[
																			contradictionItem.contradiction_type
																		]}
																	</p>
																	{#if Number.isFinite(contradictionItem.confidence)}
																		<p class="text-[9px] font-bold text-red-700">
																			{Math.round(contradictionItem.confidence)}%
																		</p>
																	{/if}
																</div>
																<div class="mt-1 space-y-1 text-[10px] text-red-900">
																	<p>{contradictionItem.why || 'No explanation returned.'}</p>
																	<p>
																		<span class="font-bold">Claim A:</span>
																		{contradictionItem.claim_a.text || '(missing)'}
																	</p>
																	<p>
																		<span class="font-bold">Claim B:</span>
																		{contradictionItem.claim_b.text || '(missing)'}
																	</p>
																	{#if contradictionItem.conflicting_fields.length > 0}
																		<p class="text-[9px] text-red-700">
																			Conflict fields: {contradictionItem.conflicting_fields.join(
																				', '
																			)}
																		</p>
																	{/if}
																</div>
															</Card.Content>
														</Card.Root>
													{/each}
												</div>
											{/if}
										</div>
									{:else}
										<p class="whitespace-pre-wrap">{message.content}</p>
									{/if}

									{#if message.citations?.length}
										<div class="mt-2 flex flex-wrap gap-1">
											{#each message.citations as citation}
												<Button
													variant="outline"
													size="xs"
													class="h-5 border-amber-200 bg-amber-50 px-1.5 text-[9px] font-bold text-amber-700 hover:border-amber-300"
													title={citation.excerpt}
													onclick={() => focusNodeFromPanel(citation.id, true)}
												>
													{citation.id}
												</Button>
											{/each}
										</div>
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
								</div>
							</div>
						{/each}

						{#if assistantLoading}
							<div class="flex justify-start">
								<div
									class="w-[82%] max-w-[92%] rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
								>
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
					on:submit|preventDefault={() => void submitAssistantQuestion()}
				>
					<Textarea
						rows={2}
						placeholder="Ask about this contract or paragraph..."
						bind:value={assistantInput}
						onkeydown={handleAssistantInputKeydown}
						class="min-h-[52px] resize-none border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-700"
					></Textarea>
					<div class="mt-1.5 flex items-center justify-between">
						<p class="text-[9px] text-gray-400">Enter to send | Shift+Enter for newline</p>
						<Button
							type="submit"
							variant="outline"
							size="sm"
							disabled={assistantLoading || !assistantInput.trim()}
							class="h-7 border-gray-200 bg-white px-3 text-[10px] font-bold text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
						>
							Ask
						</Button>
					</div>
				</form>
			</section>
		{/if}
	</aside>

	<aside
		class="absolute top-0 right-0 bottom-0 z-50 flex w-[58px] items-center justify-center px-2 py-3"
		aria-label="Tools sidebar"
	>
		<div
			class="group/rail flex w-11 flex-col items-center justify-center gap-2.5 rounded-[22px] border border-gray-200 bg-white py-3 shadow-[0_1px_2px_rgba(15,23,42,0.08),0_10px_24px_rgba(15,23,42,0.07)]"
		>
			{#each RIGHT_PANEL_TOOLS as item (item.id)}
				<div
					class="group/item relative flex h-[34px] w-full flex-[0_0_34px] items-center justify-center"
				>
					<button
						type="button"
						on:click={() => selectRightTool(item.id)}
						class={`inline-flex h-[30px] w-[30px] items-center justify-center rounded-full border border-transparent [transition:transform_150ms_cubic-bezier(0.2,0.85,0.2,1),background-color_150ms_ease,border-color_150ms_ease,color_150ms_ease,box-shadow_160ms_ease] ${
							activeRightPanelTab === item.id && isRightDrawerOpen
								? 'border-blue-300 bg-blue-100 text-blue-700 shadow-[0_0_0_2px_rgba(147,197,253,0.55),0_7px_16px_rgba(29,78,216,0.25)]'
								: 'bg-transparent text-blue-700 group-hover/item:translate-x-[-1px] group-hover/item:scale-[1.03] group-hover/item:border-blue-200 group-hover/item:bg-blue-50 group-hover/item:text-blue-700 group-hover/item:shadow-[0_6px_14px_rgba(59,130,246,0.22)]'
						}`}
						aria-label={item.label}
					>
						{#if item.id === 'related'}
							<RelatedParagraphsIcon className="h-[18px] w-[18px]" />
						{:else if item.id === 'analysis'}
							<ContradictionAnalysisIcon className="h-[18px] w-[18px]" />
						{:else if item.id === 'redundancy'}
							<RedundancyAnalysisIcon className="h-[18px] w-[18px]" />
						{:else if item.id === 'summarize'}
							<SummarizeSimplifyIcon className="h-[18px] w-[18px]" />
						{:else if item.id === 'ambiguity'}
							<AmbiguityAnalysisIcon className="h-[18px] w-[18px]" />
						{:else if item.id === 'revisions'}
							<ParagraphRevisionsIcon className="h-[18px] w-[18px]" />
						{:else}
							<ContractChatAssistantIcon className="h-[18px] w-[18px]" />
						{/if}
					</button>
					<div
						class={`pointer-events-none absolute top-1/2 right-[calc(100%+8px)] translate-x-[-4px] -translate-y-1/2 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold whitespace-nowrap opacity-0 shadow-md [transition:opacity_140ms_ease,transform_170ms_cubic-bezier(0.2,0.85,0.2,1)] group-focus-within/item:translate-x-0 group-focus-within/item:opacity-100 group-hover/rail:translate-x-0 group-hover/rail:opacity-100 ${
							activeRightPanelTab === item.id ? 'text-slate-900' : 'text-slate-500'
						}`}
					>
						{toTitleCaseLabel(item.label)}
					</div>
				</div>
			{/each}
		</div>
	</aside>

	{#if simplifyToolbarVisible && simplifyTarget}
		<div
			class="fixed z-40 w-52 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-[0_14px_40px_rgba(15,23,42,0.16)] backdrop-blur-sm"
			style={`top: ${simplifyToolbarTop}px; left: ${simplifyToolbarLeft}px;`}
		>
			<p class="px-1 pb-1 text-[9px] font-semibold text-slate-400">Paragraph tools</p>
			<div class="flex flex-col gap-1.5">
				<Button
					variant="outline"
					size="sm"
					class="h-auto justify-between border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-800 hover:border-amber-300 hover:bg-amber-100"
					disabled={fixContradictionLoading || assistantLoading || simplifyLoading}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => void runFixContradiction()}
				>
					<span class="inline-flex items-center gap-1.5">
						<HammerShieldIcon className="h-3.5 w-3.5" />
						<span>{fixContradictionLoading ? 'Fixing...' : 'Fix contradiction'}</span>
					</span>
				</Button>

				<Button
					variant="outline"
					size="sm"
					class="h-auto justify-between border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[10px] font-bold text-sky-800 hover:border-sky-300 hover:bg-sky-100"
					disabled={simplifyLoading || fixContradictionLoading}
					onmousedown={(event) => event.preventDefault()}
					onclick={() => void runSimplify()}
				>
					<span class="inline-flex items-center gap-1.5">
						<SimplifyWandIcon className="h-3.5 w-3.5" />
						<span>{simplifyLoading ? 'Simplifying...' : 'Simplify'}</span>
					</span>
				</Button>
			</div>
			<Button
				class="mt-2 h-6 w-full border-gray-200 bg-white px-2 text-[9px] font-semibold text-gray-500 hover:border-gray-300 hover:bg-gray-50"
				variant="outline"
				size="sm"
				onmousedown={(event) => event.preventDefault()}
				onclick={() => {
					simplifyToolbarVisible = false;
				}}
			>
				Close tools
			</Button>
		</div>
	{/if}
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

	:global(.docx-citation-flash) {
		animation: citation-flash 1.2s ease-out;
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
		color: #991b1b;
		padding: 0 1px;
		border-radius: 1px;
		text-decoration: underline;
		text-decoration-color: #dc2626;
		text-decoration-thickness: 2px;
		text-underline-offset: 2px;
	}

	:global(mark.docx-contradiction-snippet.docx-contradiction-snippet--active) {
		background: rgba(254, 202, 202, 0.55);
		box-shadow: 0 0 0 1px rgba(220, 38, 38, 0.7);
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
	}

	:global(.docx-contradiction-scroll-marker--medium) {
		background: #ef4444;
	}

	:global(.docx-contradiction-scroll-marker--low) {
		background: #f87171;
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
