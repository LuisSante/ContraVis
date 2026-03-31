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
		ContradictionAnalysisRequest,
		ContradictionParagraphResult,
		Edge as GraphEdge,
		Node as ParagraphNode,
		ParagraphEditState,
		RelatedParagraph,
		SimplifyRelatedParagraph,
		XmlNode,
		SimplifyResultState,
		SimplifyAuditRecord
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
		buildChangeLog,
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
		MODE_OPTIONS,
		PROVIDER_OPTIONS,
		QUICK_ACTIONS,
		QUICK_ACTION_WHY_CONTRADICTION_AI,
		QUICK_ACTION_WHY_CONTRADICTION_FREE,
		SCOPE_OPTIONS
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
	import HammerShieldIcon from '$lib/icons/HammerShieldIcon.svelte';
	import LightningBoltIcon from '$lib/icons/LightningBoltIcon.svelte';
	import SimplifyWandIcon from '$lib/icons/SimplifyWandIcon.svelte';

	let viewer: HTMLDivElement | null = null;
	let documentScrollHost: HTMLElement | null = null;
	let assistantThread: HTMLDivElement | null = null;
	let activeDocumentId: string | null = null;
	let activeDocumentName = '';
	let localError: string | null = null;
	let renderToken = 0;
	let releaseDoc: (() => void) | null = null;
	const initialInspectorState = createEmptyInspectorState();
	let selectedNodeId: string | null = initialInspectorState.selectedNodeId;
	let selectedChangeLog: ChangeLogState = initialInspectorState.selectedChangeLog;
	let selectedRelatedParagraphs: RelatedParagraph[] =
		initialInspectorState.selectedRelatedParagraphs;
	let backendEdges: GraphEdge[] = [];
	let backendGraphLoading = false;
	let graphComputationToken = 0;
	const nodeEditStateById = new Map<string, ParagraphEditState>();
	const paragraphElementById = new Map<string, HTMLElement>();
	const paragraphRelationHostById = new Map<string, HTMLElement>();
	const relationsCountByNodeId = new Map<string, number>();

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
	let simplifyResultDiff: ChangeLogState = { hasChanges: false, oldSegments: [], newSegments: [] };
	let simplifyLoading = false;
	let fixContradictionLoading = false;
	let simplifyError: string | null = null;
	const simplifyAuditTrail: SimplifyAuditRecord[] = [];
	const FIX_CONTRADICTION_TOP_RELATED = 3;

	let contradictionLoading = false;
	let contradictionError: string | null = null;
	let contradictionSource: string | null = null;
	let contradictionModel = 'gpt-4.1';
	let contradictionResultsByParagraphId = new Map<string, ContradictionParagraphResult>();
	type ContradictionScrollMarker = {
		paragraphId: string;
		topPercent: number;
		confidenceBand: 'high' | 'medium' | 'low';
	};
	let contradictionScrollMarkers: ContradictionScrollMarker[] = [];
	let contradictionMarkerFrame: number | null = null;
	let contradictionMarkerResizeObserver: ResizeObserver | null = null;
	let selectedContradictionResult: ContradictionParagraphResult | null = null;
	let selectedContradictionEvidence: ContradictionParagraphResult['evidence'] = null;
	type RightPanelTab = 'related' | 'revisions' | 'assistant';
	const RIGHT_PANEL_TABS: Array<{ id: RightPanelTab; label: string }> = [
		{ id: 'related', label: 'Related Paragraphs' },
		{ id: 'revisions', label: 'Paragraph Revisions' },
		{ id: 'assistant', label: 'Contract Chat Assistant' }
	];
	const RIGHT_PANEL_MIN_WIDTH = 360;
	const RIGHT_PANEL_DEFAULT_WIDTH = 540;
	const RIGHT_PANEL_MAX_RATIO = 0.68;
	const RIGHT_PANEL_KEYBOARD_STEP = 24;
	let activeRightPanelTab: RightPanelTab = 'related';
	let rightPanelWidth = RIGHT_PANEL_DEFAULT_WIDTH;
	let isResizingRightPanel = false;
	let isCompactLayout = false;

	$: contradictionCount = Array.from(contradictionResultsByParagraphId.values()).filter(
		(row) => row.contradiction
	).length;
	$: selectedContradictionResult = $selectedParagraph
		? contradictionResultsByParagraphId.get($selectedParagraph.id) ?? null
		: null;
	$: selectedContradictionEvidence =
		selectedContradictionResult?.contradiction && selectedContradictionResult.evidence
			? selectedContradictionResult.evidence
			: null;

	$: simplifyResultDiff = simplifyResult
		? buildChangeLog(
				simplifyResult.payload.originalSnippet,
				simplifyResult.payload.simplifiedSnippet
			)
		: { hasChanges: false, oldSegments: [], newSegments: [] };

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
					'No contradiction result is available for this paragraph yet. Run "Searching for contradictions" first.',
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

			const aiWhyQuestion = [
				`Why is selected paragraph ${selected.id} a contradiction?`,
				'Point to exact conflicting statements and explain why they cannot both be true.',
				'Cite paragraph IDs from the selected paragraph and its related context.'
			].join(' ');

			await submitAssistantQuestion(aiWhyQuestion, {
				mode: 'explain',
				scope: 'selected'
			});
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
				'No contradiction result is available for this paragraph yet. Run "Searching for contradictions" first.';
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
				const tag = localName(node.name);
				if (tag === 'styles' || tag === 'numbering') return null;
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

	function clampRightPanelWidth(nextWidth: number): number {
		const viewportWidth = window.innerWidth || RIGHT_PANEL_DEFAULT_WIDTH;
		const maxWidth = Math.max(RIGHT_PANEL_MIN_WIDTH, Math.floor(viewportWidth * RIGHT_PANEL_MAX_RATIO));
		return Math.min(Math.max(nextWidth, RIGHT_PANEL_MIN_WIDTH), maxWidth);
	}

	function setRightPanelWidth(nextWidth: number) {
		rightPanelWidth = clampRightPanelWidth(nextWidth);
	}

	function refreshViewportMode() {
		isCompactLayout = window.innerWidth < 1024;
	}

	function stopRightPanelResize() {
		if (!isResizingRightPanel) return;
		isResizingRightPanel = false;
		window.removeEventListener('mousemove', handleRightPanelResizeMove);
		window.removeEventListener('mouseup', stopRightPanelResize);
		document.body.style.userSelect = '';
	}

	function handleRightPanelResizeMove(event: MouseEvent) {
		const desiredWidth = window.innerWidth - event.clientX;
		setRightPanelWidth(desiredWidth);
	}

	function startRightPanelResize(event: MouseEvent) {
		if (window.innerWidth < 1024) return;
		event.preventDefault();
		isResizingRightPanel = true;
		document.body.style.userSelect = 'none';
		window.addEventListener('mousemove', handleRightPanelResizeMove);
		window.addEventListener('mouseup', stopRightPanelResize);
	}

	function handleRightPanelResizeKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			setRightPanelWidth(rightPanelWidth + RIGHT_PANEL_KEYBOARD_STEP);
			return;
		}
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			setRightPanelWidth(rightPanelWidth - RIGHT_PANEL_KEYBOARD_STEP);
		}
	}

	onMount(() => {
		const handleDocumentSelectionChange = () => {
			refreshSimplifyTarget();
			scheduleContradictionScrollMarkerRefresh();
		};
		const handleViewportResize = () => {
			refreshViewportMode();
			handleDocumentSelectionChange();
			setRightPanelWidth(rightPanelWidth);
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
		setRightPanelWidth(rightPanelWidth);

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
			stopRightPanelResize();
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

<main class="relative flex h-screen w-screen overflow-hidden bg-gray-100 font-sans max-lg:flex-col">
	<div
		class="flex min-w-0 flex-col border-r border-gray-300 max-lg:h-[58%] max-lg:w-full max-lg:border-r-0 max-lg:border-b"
		style={isCompactLayout ? '' : `width: calc(100% - ${rightPanelWidth}px);`}
	>
		<header
			class="flex flex-none items-center justify-between gap-3 border-b border-gray-300 bg-gray-50 px-4 py-3"
		>
			<div class="min-w-0">
				<div class="truncate text-sm font-semibold text-gray-800">
					{activeDocumentName || 'No document selected'}
				</div>
			</div>
			<div class="flex items-center gap-2">
				<button
					type="button"
					on:click={() => void loadSavedContradictions()}
					disabled={!activeDocumentId || contradictionLoading || $loading}
					class="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-700 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Saved Contradictions
				</button>
				<select
					bind:value={contradictionModel}
					disabled={contradictionLoading || $loading || backendGraphLoading}
					class="max-w-[170px] rounded border border-gray-200 bg-white px-1.5 py-1 text-[10px] font-semibold text-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
					title="Realtime contradiction model"
				>
					{#each CONTRADICTION_OPENAI_MODEL_OPTIONS as option}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
				<button
					type="button"
					on:click={() => void searchContradictionsWithLlm()}
					disabled={!activeDocumentId || contradictionLoading || $loading || backendGraphLoading}
					class="rounded border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-semibold text-red-700 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
				>
					Searching for contradictions
				</button>
			</div>
		</header>

		{#if contradictionLoading || contradictionError || contradictionResultsByParagraphId.size > 0}
			<div
				class="mx-4 mt-2 rounded border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-600"
			>
				{#if contradictionLoading}
					<p>Processing contradiction classification...</p>
				{:else if contradictionError}
					<p class="text-red-700">{contradictionError}</p>
				{:else}
					<p>
						{contradictionCount} paragraph(s) with highlighted contradiction(s).
						{#if contradictionSource}
							<span class="text-gray-500"> Source: {contradictionSource}</span>
						{/if}
					</p>
				{/if}
			</div>
		{/if}

		{#if localError || $error}
			<div class="mx-4 mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
				{localError ?? $error}
			</div>
		{/if}

		<div class="relative flex min-h-0 flex-1">
			<section
				bind:this={documentScrollHost}
				class="flex min-h-0 flex-1 flex-col items-center overflow-auto px-2 py-4 shadow-inner"
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

	<div
		role="separator"
		aria-orientation="vertical"
		aria-label="Resize right panel"
		tabindex="0"
		class="relative hidden w-1 flex-none cursor-col-resize bg-gray-200 transition hover:bg-blue-300 focus:bg-blue-400 focus:outline-none lg:block"
		on:mousedown={startRightPanelResize}
		on:keydown={handleRightPanelResizeKeydown}
	>
		<span
			class="pointer-events-none absolute top-1/2 left-1/2 h-10 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-400/70"
		></span>
	</div>

	<aside
		class="flex min-h-0 flex-col overflow-hidden bg-white shadow-xl max-lg:h-[42%] max-lg:w-full"
		style={isCompactLayout ? '' : `width: ${rightPanelWidth}px;`}
	>
		<header
			role="tablist"
			aria-label="Right panel tabs"
			class="flex flex-none items-end border-b border-gray-300 bg-gray-100 px-2 pt-2"
		>
			{#each RIGHT_PANEL_TABS as tab (tab.id)}
				<button
					type="button"
					role="tab"
					aria-selected={activeRightPanelTab === tab.id}
					on:click={() => (activeRightPanelTab = tab.id)}
					class={`-mb-px mr-1 rounded-t-md border px-3 py-1.5 text-[10px] font-semibold transition focus:outline-none ${
						activeRightPanelTab === tab.id
							? 'border-gray-300 border-b-white bg-white text-gray-800'
							: 'border-transparent bg-gray-200 text-gray-600 hover:bg-gray-300/60 hover:text-gray-800'
					}`}
				>
					{tab.label}
				</button>
			{/each}
		</header>

		{#if activeRightPanelTab === 'revisions'}
			<section class="flex min-h-0 flex-1 flex-col">
				<header
					class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2"
				>
					<h3 class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">
						Paragraph Revisions
					</h3>
					<div class="group relative inline-flex">
						<span
							class="cursor-help rounded border border-gray-200 bg-white px-2 py-0.5 text-[9px] font-bold tracking-tight text-gray-600"
							title={COMMIT_SHORTCUT_HINT}
						>
							{COMMIT_SHORTCUT_LABEL}
						</span>
						<div
							class="pointer-events-none absolute top-full right-0 z-20 mt-1 rounded bg-gray-800 px-2 py-1 text-[9px] font-bold tracking-tight whitespace-nowrap text-white opacity-0 shadow-2xl ring-1 ring-white/20 transition-opacity group-hover:opacity-100 {selectedChangeLog.hasChanges
								? 'animate-bounce'
								: ''}"
						>
							{COMMIT_SHORTCUT_TOOLTIP}
						</div>
					</div>
				</header>

				<div class="min-h-0 flex-1 overflow-y-auto p-3">
					<div class="space-y-2">
						{#if selectedContradictionEvidence?.snippet_a?.trim() && selectedContradictionEvidence?.snippet_b?.trim()}
							<div class="overflow-hidden rounded border border-red-200 bg-red-50/70 text-[11px]">
								<div class="border-b border-red-200 bg-red-100/70 px-3 py-1.5">
									<p class="text-[9px] font-bold tracking-widest text-red-700 uppercase">
										Contradiction Evidence
									</p>
								</div>
								<div class="space-y-2 p-2.5">
									<div class="rounded border border-red-300 bg-red-100/80 px-2.5 py-2">
										<div class="mb-1 flex items-center justify-between">
											<span class="text-[9px] font-bold text-red-800 uppercase">Snippet A</span>
											<span class="rounded border border-red-300 bg-white px-1.5 py-0.5 text-[8px] font-semibold text-red-800 uppercase">
												{selectedContradictionEvidence.source_a}
											</span>
										</div>
										<button
											type="button"
											class="w-full text-left leading-relaxed text-red-800 transition hover:text-red-900"
											on:click={() =>
												selectedContradictionResult &&
												focusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'a')}
										>
											{selectedContradictionEvidence.snippet_a}
										</button>
									</div>

									<div class="rounded border border-red-300 bg-red-100/80 px-2.5 py-2">
										<div class="mb-1 flex items-center justify-between">
											<span class="text-[9px] font-bold text-red-800 uppercase">Snippet B</span>
											<span class="rounded border border-red-300 bg-white px-1.5 py-0.5 text-[8px] font-semibold text-red-800 uppercase">
												{selectedContradictionEvidence.source_b}
											</span>
										</div>
										<button
											type="button"
											class="w-full text-left leading-relaxed text-red-800 transition hover:text-red-900"
											on:click={() =>
												selectedContradictionResult &&
												focusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'b')}
										>
											{selectedContradictionEvidence.snippet_b}
										</button>
									</div>
								</div>
							</div>
						{/if}

						{#if !$selectedParagraph || !selectedChangeLog.hasChanges}
							<div class="flex flex-col items-center justify-center py-2 text-gray-300">
								<p class="text-[10px] italic">No active changes</p>
							</div>
						{:else}
							<div class="overflow-hidden rounded border border-gray-100 text-[11px]">
								<div class="border-b border-gray-50 bg-red-50/20 px-3 py-2">
									<span class="mb-1 block text-[8px] font-bold text-red-300 uppercase">Original</span>
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
									<span class="mb-1 block text-[8px] font-bold text-green-300 uppercase"
										>Modified</span
									>
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

						{#if simplifyResult || simplifyLoading || simplifyError}
							<div class="overflow-hidden rounded border border-gray-100 text-[11px]">
								<div class="border-b border-gray-50 bg-gray-50/60 px-3 py-1.5">
									<span class="block text-[8px] font-bold text-gray-400 uppercase">
										Simplify Selection
									</span>
								</div>

								<div class="space-y-2 p-2.5">
									{#if simplifyLoading}
										<div
											class="rounded border border-gray-200 bg-white px-3 py-2 text-[11px] text-gray-500"
										>
											Simplifying selected text...
										</div>
									{/if}

									{#if simplifyError}
										<div
											class="rounded border border-red-200 bg-red-50 px-3 py-2 text-[10px] text-red-700"
										>
											{simplifyError}
										</div>
									{/if}

									{#if simplifyResult}
										<div class="overflow-hidden rounded border border-gray-100 text-[11px]">
											<div class="border-b border-gray-50 bg-red-50/20 px-3 py-2">
												<span class="mb-1 block text-[8px] font-bold text-red-300 uppercase"
													>Original Diff</span
												>
												<p class="font-mono leading-relaxed whitespace-pre-wrap text-red-700/80">
													{#each simplifyResultDiff.oldSegments as segment}
														{#if segment.changed}
															<mark class="bg-red-100 px-0.5 text-red-800">{segment.value}</mark>
														{:else}
															<span>{segment.value}</span>
														{/if}
													{/each}
												</p>
											</div>

											<div class="bg-green-50/20 px-3 py-2">
												<span class="mb-1 block text-[8px] font-bold text-green-300 uppercase"
													>Simplified Diff</span
												>
												<p class="font-mono leading-relaxed whitespace-pre-wrap text-green-800">
													{#each simplifyResultDiff.newSegments as segment}
														{#if segment.changed}
															<mark class="bg-green-100 px-0.5 text-green-800">{segment.value}</mark>
														{:else}
															<span>{segment.value}</span>
														{/if}
													{/each}
												</p>
											</div>
										</div>

										<div
											class="rounded border border-gray-100 bg-gray-50 px-2.5 py-2 text-[9px] text-gray-500"
										>
											<p>
												evidence: {simplifyResult.payload.evidence.paragraph_id} Â·
												{simplifyResult.payload.evidence.selection_start}-
												{simplifyResult.payload.evidence.selection_end}
											</p>
											<p class="mt-1 truncate" title={simplifyResult.payload.audit.user_prompt}>
												audit: prompt/response captured ({simplifyResult.payload.provider})
											</p>
											<p class="mt-1">audit trail entries: {simplifyAuditTrail.length}</p>
										</div>

										<div class="flex flex-wrap items-center gap-1.5">
											<button
												type="button"
												class="rounded border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-bold text-gray-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
												on:click={replaceSelectionWithSimplifiedText}
											>
												Replace selection
											</button>
											<button
												type="button"
												class="rounded border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-bold text-gray-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
												on:click={() => void copySimplifiedSnippet()}
											>
												Copy
											</button>
											<button
												type="button"
												class="rounded border border-gray-200 bg-white px-2.5 py-1 text-[10px] font-bold text-gray-600 transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
												on:click={cancelSimplifyResult}
											>
												Cancel
											</button>
										</div>
									{/if}
								</div>
							</div>
						{/if}
					</div>
				</div>
			</section>
		{:else if activeRightPanelTab === 'related'}
			<section class="flex min-h-0 flex-1 flex-col">
				<header class="border-b border-gray-100 bg-gray-50 px-4 py-2">
					<h3 class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">
						Related Paragraphs
					</h3>
				</header>

				<div
					class="flex min-h-0 flex-1 flex-col space-y-2 overflow-y-auto overscroll-contain bg-gray-50/30 p-2"
				>
					{#if !$selectedParagraph}
						<div class="flex flex-1 flex-col items-center justify-center py-12 text-gray-300">
							<LightningBoltIcon className="mb-2 h-6 w-6 opacity-20" />
							<p class="text-[10px] font-medium tracking-widest uppercase">
								Select text to analyze
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
											<span
												class="rounded border border-green-100 bg-green-50 px-1.5 py-0.5 text-[9px] font-bold text-green-600 uppercase"
											>
												Similarity
											</span>
										{/if}
										{#if related.relationTypes.includes('reference')}
											<span
												class="rounded border border-blue-100 bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-600 uppercase"
											>
												Reference
											</span>
										{/if}
										{#if related.semanticScore != null}
											<span class="text-[9px] font-semibold text-gray-500">
												{(related.semanticScore * 100).toFixed(1)}%
											</span>
										{/if}
									</div>
									<span class="text-[9px] font-bold tracking-tighter text-gray-400 uppercase">
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
			</section>
		{:else}
			<section class="flex min-h-0 flex-1 flex-col bg-white">
				<header
					class="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2"
				>
					<h3 class="text-[10px] font-bold tracking-widest text-gray-400 uppercase">
						Contract Chat Assistant
					</h3>
					<select
						bind:value={assistantProvider}
						class="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-600"
					>
						{#each PROVIDER_OPTIONS as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</header>

				<div class="grid grid-cols-3 gap-1.5 border-b border-gray-100 bg-gray-50/60 px-2 py-2">
					<select
						bind:value={assistantMode}
						class="min-w-0 rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600"
					>
						{#each MODE_OPTIONS as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>

					<select
						bind:value={assistantScope}
						class="min-w-0 rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600"
					>
						{#each SCOPE_OPTIONS as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>

					<select
						bind:value={selectedQuickAction}
						on:change={handleQuickActionSelectionChange}
						class="min-w-0 rounded border border-gray-200 bg-white px-2 py-1 text-[10px] font-semibold text-gray-600"
					>
						<option value="">Quick Action</option>
						{#each QUICK_ACTIONS as action}
							<option value={action}>{action}</option>
						{/each}
					</select>
				</div>

				<div
					bind:this={assistantThread}
					class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain bg-gray-50/30 p-2"
				>
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
								<p class="whitespace-pre-wrap">{message.content}</p>

								{#if message.citations?.length}
									<div class="mt-2 flex flex-wrap gap-1">
										{#each message.citations as citation}
											<button
												type="button"
												class="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 transition-colors hover:border-amber-300"
												title={citation.excerpt}
												on:click={() => focusNodeFromPanel(citation.id, true)}
											>
												{citation.id}
											</button>
										{/each}
									</div>
								{/if}

								{#if message.suggestedQuestions?.length}
									<div class="mt-2">
										<p class="mb-1 text-[9px] font-bold tracking-tight text-gray-500 uppercase">
											Suggested Questions
										</p>
										<div class="flex flex-wrap gap-1">
											{#each message.suggestedQuestions as suggestedQuestion}
												<button
													type="button"
													class="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[9px] text-gray-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
													on:click={() => onSuggestedQuestionClick(suggestedQuestion)}
												>
													{suggestedQuestion}
												</button>
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
								class="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-[11px] text-gray-500"
							>
								Analyzing contract context...
							</div>
						</div>
					{/if}
				</div>

				{#if assistantError}
					<div class="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[10px] text-red-700">
						{assistantError}
					</div>
				{/if}

				<form
					class="border-t border-gray-200 bg-white p-2"
					on:submit|preventDefault={() => void submitAssistantQuestion()}
				>
					<textarea
						rows="2"
						placeholder="Ask about this contract or paragraph..."
						bind:value={assistantInput}
						on:keydown={handleAssistantInputKeydown}
						class="w-full resize-none rounded border border-gray-200 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-700 transition outline-none focus:border-blue-300 focus:ring-1 focus:ring-blue-200"
					></textarea>
					<div class="mt-1.5 flex items-center justify-between">
						<p class="text-[9px] text-gray-400">Enter to send | Shift+Enter for newline</p>
						<button
							type="submit"
							disabled={assistantLoading || !assistantInput.trim()}
							class="rounded border border-gray-200 bg-white px-3 py-1 text-[10px] font-bold text-gray-600 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
						>
							Ask
						</button>
					</div>
				</form>
			</section>
		{/if}
	</aside>

	{#if simplifyToolbarVisible && simplifyTarget}
		<div
			class="fixed z-40 w-52 rounded-xl border border-slate-200 bg-white/95 p-2 shadow-[0_14px_40px_rgba(15,23,42,0.16)] backdrop-blur-sm"
			style={`top: ${simplifyToolbarTop}px; left: ${simplifyToolbarLeft}px;`}
		>
			<p class="px-1 pb-1 text-[9px] font-bold tracking-[0.12em] text-slate-400 uppercase">
				Paragraph Tools
			</p>
			<div class="flex flex-col gap-1.5">
				<button
					type="button"
					class="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-800 transition hover:border-amber-300 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
					disabled={fixContradictionLoading || assistantLoading || simplifyLoading}
					on:mousedown|preventDefault
					on:click={() => void runFixContradiction()}
				>
					<span class="inline-flex items-center gap-1.5">
						<HammerShieldIcon className="h-3.5 w-3.5" />
						<span>{fixContradictionLoading ? 'Fixing...' : 'Fix contradiction'}</span>
					</span>
					<!-- <span
						class="rounded border border-amber-300 bg-white px-1 py-0.5 text-[8px] font-black text-amber-700"
					>
						AI
					</span> -->
				</button>

				<button
					type="button"
					class="flex items-center justify-between rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[10px] font-bold text-sky-800 transition hover:border-sky-300 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60"
					disabled={simplifyLoading || fixContradictionLoading}
					on:mousedown|preventDefault
					on:click={() => void runSimplify()}
				>
					<span class="inline-flex items-center gap-1.5">
						<SimplifyWandIcon className="h-3.5 w-3.5" />
						<span>{simplifyLoading ? 'Simplifying...' : 'Simplify'}</span>
					</span>
					<!-- <span
						class="rounded border border-sky-300 bg-white px-1 py-0.5 text-[8px] font-black text-sky-700"
					>
						AI
					</span> -->
				</button>
			</div>
			<button
				class="mt-2 w-full rounded border border-gray-200 bg-white px-2 py-1 text-[9px] font-semibold text-gray-500 transition hover:border-gray-300 hover:bg-gray-50"
				type="button"
				on:mousedown|preventDefault
				on:click={() => {
					simplifyToolbarVisible = false;
				}}
			>
				Close tools
			</button>
		</div>
	{/if}

	{#if backendGraphLoading}
		<div
			class="absolute inset-0 z-50 flex items-center justify-center bg-white/65 backdrop-blur-[1.5px]"
		>
			<div
				class="backend-loader-card flex items-center gap-3 rounded-md border border-gray-200 bg-white px-4 py-3 shadow-xl"
			>
				<div class="relative h-5 w-5" aria-hidden="true">
					<span class="absolute inset-0 rounded-full border-2 border-gray-200"></span>
					<span
						class="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-blue-500 border-r-blue-500"
					></span>
				</div>
				<p class="text-[11px] font-semibold tracking-tight text-gray-600">
					Loading backend relationships...
				</p>
			</div>
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

	:global(.overflow-y-auto)::-webkit-scrollbar {
		width: 3px;
	}

	:global(.overflow-y-auto)::-webkit-scrollbar-track {
		background: transparent;
	}

	:global(.overflow-y-auto)::-webkit-scrollbar-thumb {
		background: #f3f4f6;
		border-radius: 10px;
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
</style>
