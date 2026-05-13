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
		FixContradictionSuggestion,
		ChangeLogState,
		ContradictionAnalysisRequest,
		ContradictionGraphMode,
		ContradictionParagraphResult,
		ContradictionTaxonomyType,
		Edge as GraphEdge,
		Node as ParagraphNode,
		ParagraphEditState,
		RelatedParagraph,
		XmlNode,
		SimplifyResultState,
		SimplifyAuditRecord,
		RightPanelTab,
		ContradictionScrollMarker,
		LlmEstimateResponse,
		LlmUsageTotalResponse,
		SimplifySelectionRequest
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
		fetchLlmEstimate,
		fetchLlmTotalCost,
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
		resolveAssistantSuggestedQuestions
	} from '$lib/utils/docx/assistant';
	import { buildChangeLog } from '$lib/utils/docx/change-log';
	import { ensureNodeEditState, getNodeCurrentText } from '$lib/utils/edit';
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
		PROVIDER_OPTIONS,
		QUICK_ACTIONS,
		QUICK_ACTION_WHY_CONTRADICTION_AI,
		QUICK_ACTION_WHY_CONTRADICTION_FREE,
		RIGHT_DRAWER_DEFAULT_WIDTH,
		RIGHT_DRAWER_KEYBOARD_STEP,
		RIGHT_DRAWER_MIN_WIDTH,
		RIGHT_DRAWER_MAX_RATIO,
		RIGHT_PANEL_TOOLS,
		FIX_CONTRADICTION_TOP_RELATED
	} from '$lib/constants/docx-viewer';
	import { type SimplifyTarget } from '$lib/utils/docx/simplify-selection';
	import {
		applyRewriteToParagraph,
		copyRewriteSnippetToClipboard,
		executeFixContradictionRewrite,
		executeSimplifyRewrite,
		getRewriteToolbarPosition,
		resolveActiveRewriteTarget
	} from '$lib/utils/docx/rewrite';
	import AmbiguityAnalysisIcon from '$lib/icons/AmbiguityAnalysisIcon.svelte';
	import ChatIcon from '$lib/icons/ChatIcon.svelte';
	import CloseIcon from '$lib/icons/CloseIcon.svelte';
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
	import { Switch } from '$lib/components/ui/switch/index.js';
	import * as Tooltip from '$lib/components/ui/tooltip/index.js';
	import './page.css';

	const initialInspectorState = createEmptyInspectorState();
	const nodeEditStateById = new Map<string, ParagraphEditState>();
	const paragraphElementById = new Map<string, HTMLElement>();
	const paragraphRelationHostById = new Map<string, HTMLElement>();
	const relationsCountByNodeId = new Map<string, number>();
	const simplifyAuditTrail: SimplifyAuditRecord[] = [];
	const RIGHT_TOOLBAR_COLLAPSED_WIDTH = 42;
	const RIGHT_TOOLBAR_EXPANDED_WIDTH = 162;
	const TOOL_BRAND_SHORT_NAME = 'ContractVis';
	const MANUAL_SCROLL_DRAG_SPEED = 100;
	const CONTRADICTION_EVIDENCE_MARKER_MIN_GAP_PX = 18;
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
	const PARAGRAPH_EXPLANATION_PARAGRAPH_GAP_PX = 10;
	const PARAGRAPH_EXPLANATION_COMPRESS_DURATION_MS = 560;
	const PARAGRAPH_EXPLANATION_COMPRESS_SNAP_EPSILON = 0.001;
	const PARAGRAPH_EXPLANATION_WHEEL_DIRECTION_DEADZONE = 2;
	const PARAGRAPH_EXPLANATION_COMPRESS_GAP_PX = 72;
	const PARAGRAPH_EXPLANATION_STACK_OFFSET_PX = 18;
	const PARAGRAPH_EXPLANATION_STACK_CARD_GAP_PX = 12;
	const PARAGRAPH_EXPLANATION_CONSECUTIVE_GAP_PX = 24;
	const ASSISTANT_CHAT_SUGGESTIONS = QUICK_ACTIONS.filter(
		(action) =>
			action !== QUICK_ACTION_WHY_CONTRADICTION_FREE && action !== QUICK_ACTION_WHY_CONTRADICTION_AI
	);
	type RelatedVisualKind = 'reference' | 'similarity';
	type RelatedScrollMarker = {
		paragraphId: string;
		topPercent: number;
		kind: RelatedVisualKind;
	};
	const RENDERED_PDF_PRINT_STYLE = `
		html,
		body {
			margin: 0 !important;
			padding: 0 !important;
			background: #fff !important;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}

		body {
			width: max-content;
			min-width: 0;
			overflow: visible !important;
		}

		.docx-rendered-pdf-export {
			display: block !important;
			width: max-content !important;
			min-width: 0 !important;
			margin: 0 !important;
			padding: 0 !important;
			background: #fff !important;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}

		.docx-rendered-pdf-export > div,
		.docx-rendered-pdf-export > div > div {
			display: block !important;
			width: max-content !important;
			max-width: none !important;
			min-height: 0 !important;
			margin: 0 !important;
			padding: 0 !important;
			gap: 0 !important;
		}

		.docx-rendered-pdf-export section {
			margin: 0 !important;
			box-shadow: none !important;
			break-after: page;
			page-break-after: always;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}

		.docx-rendered-pdf-export section:last-of-type {
			break-after: auto;
			page-break-after: auto;
		}

		.docx-rendered-pdf-export [contenteditable='true'] {
			caret-color: transparent !important;
		}

		.docx-rendered-pdf-export * {
			transition: none !important;
			-webkit-print-color-adjust: exact;
			print-color-adjust: exact;
		}
	`;

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
	let simplifyToolbarVisible = false;
	let simplifyToolbarTop = 0;
	let simplifyToolbarLeft = 0;
	let simplifyTarget: SimplifyTarget | null = null;
	let simplifyResult: SimplifyResultState | null = null;
	let latestRewriteSource: 'simplify' | 'fix' | null = null;
	let simplifyLoading = false;
	let fixContradictionLoading = false;
	let simplifyError: string | null = null;
	let llmEstimateToastOpen = false;
	let llmEstimateToast: LlmEstimateResponse | null = null;
	let llmEstimateToastResolver: ((approved: boolean) => void) | null = null;
	let llmTotalCost: LlmUsageTotalResponse | null = null;
	let llmCostLabel = 'Cost: 0.000000 $';

	let contradictionLoading = false;
	let contradictionError: string | null = null;
	let hasTriggeredContradictionCheck = false;
	let contradictionSource: string | null = null;
	let contradictionGraphMode: ContradictionGraphMode = 'without_kg';
	let globalAnalysisModel = 'gpt-4.1';
	let globalModelSelectWidthPx = GLOBAL_MODEL_MIN_WIDTH_PX;
	let contradictionResultsByParagraphId = new Map<string, ContradictionParagraphResult>();
	let contradictionScrollMarkers: ContradictionScrollMarker[] = [];
	let selectedContradictionEvidenceLink: {
		topPx: number;
		bottomPx: number;
		leftPx: number;
		showA: boolean;
		showB: boolean;
		aCenterPx: number;
		bCenterPx: number;
	} | null = null;
	let contradictionMarkerFrame: number | null = null;
	let contradictionMarkerResizeObserver: ResizeObserver | null = null;
	let selectedContradictionResult: ContradictionParagraphResult | null = null;
	let selectedContradictionEvidence: ContradictionParagraphResult['evidence'] = null;
	let selectedContradictionCategoryColor = CONTRADICTION_TAXONOMY_COLORS.specificity;
	let contradictionSummaryItems: Array<{
		paragraphId: string;
		label: string;
	}> = [];
	let paragraphExplanationLoading = false;
	let paragraphExplanationError: string | null = null;
	let paragraphExplanationShort = '';
	let paragraphExplanationDetailed = '';
	type ParagraphExplanationEntityHighlight = {
		label: string;
		key: string;
		color: string;
		softColor: string;
	};
	let paragraphExplanationEntities: ParagraphExplanationEntityHighlight[] = [];
	let hoveredParagraphExplanationEntityKey: string | null = null;
	let paragraphExplanationConnectors: Array<{
		topPx: number;
		bottomPx: number;
		leftPx: number;
		selectedCapTopPx: number;
		selectedCapWidthPx: number;
		relatedCapTopPx: number;
		relatedCapWidthPx: number;
		paragraphId: string;
		relationKind: RelatedVisualKind;
		relationLabel: string;
		labelLeftPx: number;
	}> = [];
	let paragraphExplanationFolds: Array<{
		topPx: number;
		leftPx: number;
	}> = [];
	let paragraphExplanationCompression = 0;
	let paragraphExplanationCompressionTarget = 0;
	let paragraphExplanationCompressionTweenFrame: number | null = null;
	let paragraphExplanationCompressionStart = 0;
	let paragraphExplanationCompressionStartTime = 0;
	let paragraphExplanationCollapsedCards: Array<{
		paragraphId: string;
		topPx: number;
		leftPx: number;
		widthPx: number;
		html: string;
	}> = [];
	let paragraphExplanationMovedNodeIds = new Set<string>();
	let paragraphExplanationPrimaryConnector: {
		topPx: number;
		bottomPx: number;
		leftPx: number;
		selectedCapTopPx: number;
		selectedCapWidthPx: number;
		paragraphId: string;
	} | null = null;
	$: paragraphExplanationPrimaryConnector =
		paragraphExplanationConnectors.length > 0 ? paragraphExplanationConnectors[0] : null;
	let paragraphExplanationScrollMarkers: RelatedScrollMarker[] = [];
	let paragraphExplanationFrame: number | null = null;
	let paragraphExplanationRelatedParagraphs: RelatedParagraph[] = [];
	let relatedScrollMarkers: RelatedScrollMarker[] = [];
	let relatedScrollMarkerFrame: number | null = null;
	let isManualScrollDragging = false;
	let manualScrollStartY = 0;
	let manualScrollStartTop = 0;
	let manualScrollMoved = false;
	let suppressMarkerClickUntil = 0;

	let activeRightPanelTab: RightPanelTab = 'analysis';
	let isRightDrawerOpen = true;
	let sidebarLabelsPinned = false;
	let isCompactLayout = false;
	let rightDrawerWidth = RIGHT_DRAWER_DEFAULT_WIDTH;
	let isResizingRightDrawer = false;
	let renderedPdfExporting = false;
	$: shouldShowContradictionDecorations = activeRightPanelTab === 'analysis' && isRightDrawerOpen;
	$: shouldShowParagraphExplanationDecorations =
		activeRightPanelTab === 'paragraph_explanation' && isRightDrawerOpen;
	$: shouldShowRelatedBridgeDecorations =
		(activeRightPanelTab === 'paragraph_explanation' || activeRightPanelTab === 'related') &&
		isRightDrawerOpen;
	$: activeDrawerWidth = !isCompactLayout && isRightDrawerOpen ? rightDrawerWidth : 0;
	$: activeSidebarWidth = sidebarLabelsPinned
		? RIGHT_TOOLBAR_EXPANDED_WIDTH
		: RIGHT_TOOLBAR_COLLAPSED_WIDTH;

	$: contradictionCount = Array.from(contradictionResultsByParagraphId.values()).filter(
		(row) => row.contradiction
	).length;
	$: {
		const items: Array<{ paragraphId: string; label: string; paragraphEnum: number }> = [];
		for (const [paragraphId, row] of contradictionResultsByParagraphId.entries()) {
			if (!row.contradiction) continue;
			const paragraphEnumMatch = paragraphId.match(/-p-(\d+)$/);
			const paragraphEnum = paragraphEnumMatch ? Number(paragraphEnumMatch[1]) : Number.POSITIVE_INFINITY;
			const label = paragraphEnumMatch ? `p-${paragraphEnumMatch[1]}` : paragraphId;
			items.push({ paragraphId, label, paragraphEnum });
		}
		items.sort(
			(left, right) =>
				left.paragraphEnum - right.paragraphEnum || left.paragraphId.localeCompare(right.paragraphId)
		);
		contradictionSummaryItems = items.map(({ paragraphId, label }) => ({ paragraphId, label }));
	}
	$: selectedContradictionResult = $selectedParagraph
		? (contradictionResultsByParagraphId.get($selectedParagraph.id) ?? null)
		: null;
	$: selectedContradictionCategoryColor =
		selectedContradictionResult?.contradiction_type &&
		CONTRADICTION_TAXONOMY_COLORS[selectedContradictionResult.contradiction_type]
			? CONTRADICTION_TAXONOMY_COLORS[selectedContradictionResult.contradiction_type]
			: CONTRADICTION_TAXONOMY_COLORS.specificity;
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
		.slice(activeRightPanelTab === 'related' ? 9999 : 5);
	$: {
		syncContradictionDecorations();
	}
	$: {
		const selectedId = $selectedParagraph?.id ?? '';
		const relatedIds = paragraphExplanationRelatedParagraphs
			.map((related) => related.node.id)
			.join('|');
		const entitiesSignature = paragraphExplanationEntities.map((entity) => entity.key).join('|');
		void selectedId;
		void relatedIds;
		void entitiesSignature;
		if (shouldShowRelatedBridgeDecorations) {
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
		scheduleRelatedScrollMarkerRefresh();
		if (activeRightPanelTab === 'related' && isRightDrawerOpen) {
			applyParagraphExplanationHighlights();
			scheduleParagraphExplanationConnectorRefresh();
		}
	}

	function getBridgeRelatedParagraphs(): RelatedParagraph[] {
		return activeRightPanelTab === 'related'
			? selectedRelatedParagraphs
			: paragraphExplanationRelatedParagraphs;
	}

	function toTitleCaseLabel(label: string): string {
		return label.toLowerCase().replace(/\b\w/g, (character) => character.toUpperCase());
	}

	function getRenderedPdfTitle(): string {
		const rawName = activeDocumentName || activeDocumentId || 'rendered-document';
		const stem = rawName.replace(/\.[^.]+$/i, '').trim() || 'rendered-document';
		const safeStem = stem
			.replace(/[\\/:*?"<>|]+/g, '_')
			.replace(/\s+/g, ' ')
			.trim();
		return `${safeStem || 'rendered-document'}__system-render.pdf`;
	}

	function getRenderedPdfExportClass(): string {
		const classes = [
			'docx-rendered-pdf-export',
			activeRightPanelTab === 'related' ? 'related-badges-on' : 'related-badges-off'
		];
		if (activeRightPanelTab === 'related' && get(selectedParagraph)?.id) {
			classes.push('related-focus-on');
		}
		return classes.join(' ');
	}

	function copyRenderedPdfExportStyles(printDocument: Document) {
		const base = printDocument.createElement('base');
		base.href = `${window.location.origin}/`;
		printDocument.head.appendChild(base);

		const styleNodes = document.querySelectorAll<HTMLLinkElement | HTMLStyleElement>(
			'link[rel="stylesheet"], style'
		);
		for (const node of styleNodes) {
			printDocument.head.appendChild(node.cloneNode(true));
		}

		const printStyle = printDocument.createElement('style');
		printStyle.textContent = `${getRenderedPdfPageRule()}\n${RENDERED_PDF_PRINT_STYLE}`;
		printDocument.head.appendChild(printStyle);
	}

	function getRenderedPdfPageRule(): string {
		const firstPage = viewer?.querySelector('section');
		if (!(firstPage instanceof HTMLElement)) {
			return '@page { size: auto; margin: 0; }';
		}

		const pageRect = firstPage.getBoundingClientRect();
		const widthPx =
			parsePxValue(firstPage.dataset.docxPageWidthPx) ??
			parsePxValue(firstPage.style.width) ??
			pageRect.width;
		const heightPx =
			parsePxValue(firstPage.dataset.docxPageHeightPx) ??
			parsePxValue(firstPage.style.minHeight) ??
			parsePxValue(firstPage.style.height) ??
			pageRect.height;
		if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
			return '@page { size: auto; margin: 0; }';
		}

		return `@page { size: ${widthPx / 96}in ${heightPx / 96}in; margin: 0; }`;
	}

	function normalizeRenderedPdfExportClone(exportRoot: HTMLElement) {
		const sections = exportRoot.querySelectorAll<HTMLElement>('section[data-docx-page-height-px]');
		for (const section of sections) {
			const widthPx = parsePxValue(section.dataset.docxPageWidthPx);
			const heightPx = parsePxValue(section.dataset.docxPageHeightPx);
			if (widthPx != null && widthPx > 0) {
				section.style.width = `${widthPx}px`;
			}
			if (heightPx != null && heightPx > 0) {
				section.style.height = `${heightPx}px`;
				section.style.minHeight = `${heightPx}px`;
				section.style.maxHeight = `${heightPx}px`;
				section.style.overflow = 'hidden';
			}
		}
	}

	function waitForImageLoad(image: HTMLImageElement): Promise<void> {
		if (image.complete) return Promise.resolve();

		return new Promise((resolve) => {
			const finish = () => {
				image.removeEventListener('load', finish);
				image.removeEventListener('error', finish);
				resolve();
			};
			image.addEventListener('load', finish, { once: true });
			image.addEventListener('error', finish, { once: true });
		});
	}

	async function waitForRenderedPdfExportAssets(printDocument: Document) {
		const fontSet = (printDocument as Document & { fonts?: FontFaceSet }).fonts;
		const fontPromise = fontSet?.ready.catch(() => undefined) ?? Promise.resolve();
		const imagePromises = Array.from(printDocument.images).map((image) => waitForImageLoad(image));
		const assetPromise = Promise.all([fontPromise, ...imagePromises]).then(() => undefined);
		const timeoutPromise = new Promise<void>((resolve) => window.setTimeout(resolve, 2500));

		await Promise.race([assetPromise, timeoutPromise]);
	}

	function removePrintFrame(printFrame: HTMLIFrameElement | null) {
		if (printFrame?.parentNode) {
			printFrame.parentNode.removeChild(printFrame);
		}
	}

	async function downloadRenderedPdf() {
		if (renderedPdfExporting) return;
		if (!viewer?.firstElementChild || !activeDocumentId) {
			localError = 'No rendered document is available to export.';
			return;
		}

		renderedPdfExporting = true;
		localError = null;
		let printFrame: HTMLIFrameElement | null = null;

		try {
			await tick();
			const sourceFontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
			await sourceFontSet?.ready.catch(() => undefined);

			printFrame = document.createElement('iframe');
			printFrame.title = 'Rendered document PDF export';
			printFrame.setAttribute('aria-hidden', 'true');
			printFrame.style.position = 'fixed';
			printFrame.style.left = '0';
			printFrame.style.top = '0';
			printFrame.style.width = `${Math.max(
				1,
				Math.ceil(viewer.scrollWidth || viewer.getBoundingClientRect().width || window.innerWidth)
			)}px`;
			printFrame.style.height = '1px';
			printFrame.style.border = '0';
			printFrame.style.opacity = '0';
			printFrame.style.pointerEvents = 'none';
			document.body.appendChild(printFrame);

			const printWindow = printFrame.contentWindow;
			const printDocument = printFrame.contentDocument ?? printWindow?.document;
			if (!printWindow || !printDocument) {
				throw new Error('Unable to prepare the rendered PDF export.');
			}

			printDocument.open();
			printDocument.write(
				'<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'
			);
			printDocument.close();
			printDocument.title = getRenderedPdfTitle();
			copyRenderedPdfExportStyles(printDocument);

			const exportRoot = printDocument.createElement('main');
			exportRoot.className = getRenderedPdfExportClass();
			exportRoot.appendChild(viewer.cloneNode(true));
			normalizeRenderedPdfExportClone(exportRoot);
			printDocument.body.appendChild(exportRoot);

			await waitForRenderedPdfExportAssets(printDocument);
			await new Promise<void>((resolve) => printWindow.requestAnimationFrame(() => resolve()));

			const cleanup = () => {
				removePrintFrame(printFrame);
				printFrame = null;
			};
			printWindow.addEventListener('afterprint', cleanup, { once: true });
			printWindow.focus();
			printWindow.print();
			window.setTimeout(cleanup, 60000);
		} catch (exportError) {
			removePrintFrame(printFrame);
			localError =
				exportError instanceof Error
					? exportError.message
					: 'Failed to prepare rendered PDF export.';
		} finally {
			renderedPdfExporting = false;
		}
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
		if (nodeWithCurrent?.id) {
			const selectedElement = paragraphElementById.get(nodeWithCurrent.id);
			if (selectedElement) fitShortParagraphSelectionBox(selectedElement);
		}
		void tick().then(() => {
			if (nodeWithCurrent?.id) {
				const selectedElement = paragraphElementById.get(nodeWithCurrent.id);
				if (selectedElement) fitShortParagraphSelectionBox(selectedElement);
			}
			refreshSimplifyTarget();
			syncContradictionDecorations();
		});
	}

	function clearRelatedSelectionHighlight() {
		for (const element of paragraphElementById.values()) {
			element.classList.remove(
				'docx-related-selected',
				'docx-related-linked',
				'docx-related-context',
				'docx-related-context--reference',
				'docx-related-context--similarity'
			);
		}
		for (const host of paragraphRelationHostById.values()) {
			host.classList.remove(
				'docx-related-badge-emphasis',
				'docx-related-badge--reference',
				'docx-related-badge--similarity'
			);
		}
	}

	function buildRelatedScrollMarkers(relatedParagraphs: RelatedParagraph[]): RelatedScrollMarker[] {
		if (!documentScrollHost) return [];

		const hostRect = documentScrollHost.getBoundingClientRect();
		const hostScrollHeight = documentScrollHost.scrollHeight;
		if (!Number.isFinite(hostScrollHeight) || hostScrollHeight <= 0) return [];

		const nextMarkers: RelatedScrollMarker[] = [];
		for (const related of relatedParagraphs) {
			const relatedElement = paragraphElementById.get(related.node.id);
			if (!relatedElement) continue;
			const relatedRect = relatedElement.getBoundingClientRect();
			const centerOffset =
				relatedRect.top - hostRect.top + documentScrollHost.scrollTop + relatedRect.height / 2;
			const rawTopPercent = (centerOffset / hostScrollHeight) * 100;
			const topPercent = Math.min(99.6, Math.max(0.4, rawTopPercent));
			nextMarkers.push({
				paragraphId: related.node.id,
				topPercent,
				kind: resolveRelatedVisualMeta(related).kind
			});
		}

		return nextMarkers.sort((left, right) => left.topPercent - right.topPercent);
	}

	function refreshRelatedScrollMarkers() {
		if (activeRightPanelTab !== 'related' || !get(selectedParagraph)?.id) {
			relatedScrollMarkers = [];
			return;
		}
		relatedScrollMarkers = buildRelatedScrollMarkers(selectedRelatedParagraphs);
	}

	function scheduleRelatedScrollMarkerRefresh() {
		if (typeof window === 'undefined') return;
		if (relatedScrollMarkerFrame != null) {
			window.cancelAnimationFrame(relatedScrollMarkerFrame);
		}
		relatedScrollMarkerFrame = window.requestAnimationFrame(() => {
			relatedScrollMarkerFrame = null;
			refreshRelatedScrollMarkers();
		});
	}

	function fitShortParagraphSelectionBox(element: HTMLElement) {
		if (element.querySelector('table,img,svg,canvas,video,audio,object,iframe')) return;
		const text = normalizeEditableText(element.textContent ?? '').trim();
		if (!text || text.length > 140) return;

		const computedStyle = window.getComputedStyle(element);
		if (computedStyle.textAlign === 'justify') return;

		element.dataset.docxShrinkToText = 'true';
		element.style.display =
			element.dataset.docxListLayout === 'hanging-grid' ? 'inline-grid' : 'inline-block';
		element.style.width = 'fit-content';
		element.style.maxWidth = '100%';
		element.style.verticalAlign = 'top';
	}

	function resolveRelatedVisualMeta(related: RelatedParagraph): {
		kind: RelatedVisualKind;
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
			return { kind: 'similarity' };
		}
		if (hasSimilarity) {
			return { kind: 'similarity' };
		}
		if (isReference) {
			return { kind: 'reference' };
		}
		return { kind: 'reference' };
	}

	function applyRelatedSelectionHighlight() {
		clearRelatedSelectionHighlight();
		if (activeRightPanelTab !== 'related') {
			relatedScrollMarkers = [];
			return;
		}
		const selected = get(selectedParagraph);
		if (!selected?.id) {
			relatedScrollMarkers = [];
			return;
		}
		const selectedElement = paragraphElementById.get(selected.id);
		if (selectedElement) fitShortParagraphSelectionBox(selectedElement);
		paragraphRelationHostById.get(selected.id)?.classList.add('docx-related-badge-emphasis');
		for (const related of selectedRelatedParagraphs) {
			const relatedElement = paragraphElementById.get(related.node.id);
			if (!relatedElement) continue;
			const visualMeta = resolveRelatedVisualMeta(related);
			relatedElement.classList.add('docx-related-linked', 'docx-related-context');
			relatedElement.classList.add(
				visualMeta.kind === 'reference'
					? 'docx-related-context--reference'
					: 'docx-related-context--similarity'
			);
			paragraphRelationHostById
				.get(related.node.id)
				?.classList.add(
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
		const targetNode = get(paragraphs).find((node) => node.id === nodeId) ?? null;
		if (targetNode) {
			// Ensure panel state updates even when the element can be focused without fallback.
			setSelectedParagraphNode(targetNode);
		}

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
		relatedScrollMarkers = [];
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
		paragraphExplanationShort = '';
		paragraphExplanationDetailed = '';
		paragraphExplanationEntities = [];
		paragraphExplanationLoading = false;
		paragraphExplanationConnectors = [];
		paragraphExplanationScrollMarkers = [];
	}

	function parseParagraphExplanationVariants(answer: string): {
		shortText: string;
		detailedText: string;
		entities: string[];
	} {
		const normalized = answer.trim();
		if (!normalized) {
			return { shortText: '', detailedText: '', entities: [] };
		}

		const normalizeEntities = (values: string[]): string[] => {
			const unique = new Set<string>();
			for (const value of values) {
				const cleaned = value.replace(/^[-*•]\s*/, '').trim();
				if (!cleaned) continue;
				if (cleaned.length < 2) continue;
				unique.add(cleaned);
			}
			return Array.from(unique).slice(0, 12);
		};

		const readExplanationField = (record: Record<string, unknown>, keys: string[]): string => {
			for (const key of keys) {
				const value = record[key];
				if (typeof value === 'string' && value.trim()) return value.trim();
			}
			return '';
		};

		const tryParseJsonExplanation = (
			raw: string
		): { shortText: string; detailedText: string; entities: string[] } | null => {
			const tryCandidates: string[] = [raw];
			const jsonBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
			if (jsonBlockMatch?.[1]) tryCandidates.unshift(jsonBlockMatch[1].trim());

			for (const candidate of tryCandidates) {
				try {
					const parsed = JSON.parse(candidate) as unknown;
					if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
					const record = parsed as Record<string, unknown>;
					const shortText = readExplanationField(record, [
						'SHORT_EXPLANATION',
						'short_explanation',
						'shortExplanation',
						'summary',
						'short'
					]);
					const detailedText = readExplanationField(record, [
						'DETAILED_EXPLANATION',
						'detailed_explanation',
						'detailedExplanation',
						'detail',
						'detailed'
					]);
					const entitiesRaw = record.ENTITIES ?? record.entities ?? record.entity_list;
					const entities = Array.isArray(entitiesRaw)
						? normalizeEntities(
								entitiesRaw.filter((entry): entry is string => typeof entry === 'string')
							)
						: typeof entitiesRaw === 'string'
							? normalizeEntities(
									entitiesRaw
										.split('\n')
										.map((line) => line.trim())
										.filter(Boolean)
								)
							: [];
					if (shortText || detailedText) {
						return {
							shortText: shortText || detailedText,
							detailedText: detailedText || shortText,
							entities
						};
					}
				} catch {
					// Keep trying other formats.
				}
			}
			return null;
		};

		const jsonParsed = tryParseJsonExplanation(normalized);
		if (jsonParsed) return jsonParsed;

		const structuredMatch = normalized.match(
			/SHORT_EXPLANATION:\s*([\s\S]*?)\s*DETAILED_EXPLANATION:\s*([\s\S]*)/i
		);
		if (structuredMatch) {
			const shortText = structuredMatch[1]?.trim() ?? '';
			const detailedRaw = structuredMatch[2]?.trim() ?? '';
			const entitiesMatch = detailedRaw.match(/ENTITIES:\s*([\s\S]*)/i);
			const detailedText = entitiesMatch
				? detailedRaw.slice(0, entitiesMatch.index ?? detailedRaw.length).trim()
				: detailedRaw;
			const entities = entitiesMatch
				? normalizeEntities(
						entitiesMatch[1]
							.split('\n')
							.map((line) => line.trim())
							.filter(Boolean)
					)
				: [];
			return { shortText, detailedText, entities };
		}

		const labeledMatch = normalized.match(
			/SHORT[\s_-]*EXPLANATION\s*:\s*([\s\S]*?)\s*DETAILED[\s_-]*EXPLANATION\s*:\s*([\s\S]*)/i
		);
		if (labeledMatch) {
			const shortText = labeledMatch[1]?.trim() ?? '';
			const detailedRaw = labeledMatch[2]?.trim() ?? '';
			const entitiesMatch = detailedRaw.match(/ENTITIES:\s*([\s\S]*)/i);
			const detailedText = entitiesMatch
				? detailedRaw.slice(0, entitiesMatch.index ?? detailedRaw.length).trim()
				: detailedRaw;
			const entities = entitiesMatch
				? normalizeEntities(
						entitiesMatch[1]
							.split('\n')
							.map((line) => line.trim())
							.filter(Boolean)
					)
				: [];
			return { shortText, detailedText, entities };
		}

		const paragraphChunks = normalized
			.split(/\n\s*\n/g)
			.map((chunk) => chunk.trim())
			.filter(Boolean);
		if (paragraphChunks.length >= 2) {
			return {
				shortText: paragraphChunks[0],
				detailedText: paragraphChunks.slice(1).join('\n\n'),
				entities: []
			};
		}

		return {
			shortText: normalized,
			detailedText: normalized,
			entities: []
		};
	}

	const PARAGRAPH_EXPLANATION_ENTITY_COLOR_PALETTE: Array<{ color: string; softColor: string }> = [
		{ color: '#2563eb', softColor: 'rgba(37,99,235,0.16)' },
		{ color: '#0d9488', softColor: 'rgba(13,148,136,0.16)' },
		{ color: '#7c3aed', softColor: 'rgba(124,58,237,0.16)' },
		{ color: '#ea580c', softColor: 'rgba(234,88,12,0.16)' },
		{ color: '#0284c7', softColor: 'rgba(2,132,199,0.16)' },
		{ color: '#be185d', softColor: 'rgba(190,24,93,0.16)' },
		{ color: '#15803d', softColor: 'rgba(21,128,61,0.16)' },
		{ color: '#b45309', softColor: 'rgba(180,83,9,0.16)' }
	];

	function normalizeParagraphExplanationEntityKey(value: string): string {
		return value
			.toLocaleLowerCase()
			.normalize('NFKD')
			.replace(/[^\w\s-]/g, '')
			.replace(/\s+/g, ' ')
			.trim();
	}

	function buildParagraphExplanationEntityHighlights(
		entities: string[]
	): ParagraphExplanationEntityHighlight[] {
		const uniqueByKey = new Map<string, string>();
		for (const rawEntity of entities) {
			const cleaned = rawEntity.trim();
			if (!cleaned) continue;
			const key = normalizeParagraphExplanationEntityKey(cleaned);
			if (!key) continue;
			if (!uniqueByKey.has(key)) uniqueByKey.set(key, cleaned);
		}
		return Array.from(uniqueByKey.entries()).map(([key, label], index) => {
			const palette =
				PARAGRAPH_EXPLANATION_ENTITY_COLOR_PALETTE[
					index % PARAGRAPH_EXPLANATION_ENTITY_COLOR_PALETTE.length
				];
			return {
				label,
				key,
				color: palette.color,
				softColor: palette.softColor
			};
		});
	}

	function setHoveredParagraphExplanationEntityKey(nextKey: string | null) {
		if (hoveredParagraphExplanationEntityKey === nextKey) return;
		if (typeof document === 'undefined') {
			hoveredParagraphExplanationEntityKey = nextKey;
			return;
		}

		for (const element of document.querySelectorAll<HTMLElement>('[data-entity-key]')) {
			const isActive = Boolean(nextKey) && element.dataset.entityKey === nextKey;
			element.classList.toggle('is-entity-hovered', isActive);
		}
		hoveredParagraphExplanationEntityKey = nextKey;
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

	function escapeRegex(value: string): string {
		return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}

	function clearParagraphExplanationEntityMarks(element: HTMLElement) {
		const marks = element.querySelectorAll<HTMLElement>('span.docx-paragraph-explanation-entity-link');
		for (const mark of marks) {
			const parent = mark.parentNode;
			if (!parent) continue;
			while (mark.firstChild) {
				parent.insertBefore(mark.firstChild, mark);
			}
			parent.removeChild(mark);
		}
	}

	function highlightParagraphExplanationEntitiesInElement(
		element: HTMLElement,
		entities: ParagraphExplanationEntityHighlight[]
	) {
		const normalizedEntities = entities
			.map((entity) => entity.label.trim())
			.filter((entity) => entity.length >= 2)
			.sort((left, right) => right.length - left.length);
		if (normalizedEntities.length === 0) return;
		const entityByNormalizedLabel = new Map(
			entities.map((entity) => [normalizeParagraphExplanationEntityKey(entity.label), entity])
		);

		const entityPattern = new RegExp(
			normalizedEntities.map((entity) => escapeRegex(entity)).join('|'),
			'gi'
		);
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		const nodes: Text[] = [];
		let current = walker.nextNode();
		while (current) {
			const textNode = current as Text;
			const parentElement = textNode.parentElement;
			const rawText = textNode.nodeValue ?? '';
			if (
				parentElement &&
				!parentElement.closest('.docx-paragraph-explanation-entity-link') &&
				!parentElement.closest('mark.docx-contradiction-snippet') &&
				rawText.trim()
			) {
				nodes.push(textNode);
			}
			current = walker.nextNode();
		}

		for (const textNode of nodes) {
			const originalText = textNode.nodeValue ?? '';
			entityPattern.lastIndex = 0;
			if (!entityPattern.test(originalText)) continue;

			entityPattern.lastIndex = 0;
			const fragment = document.createDocumentFragment();
			let cursor = 0;
			for (const match of originalText.matchAll(entityPattern)) {
				const value = match[0] ?? '';
				if (!value) continue;
				const start = match.index ?? 0;
				if (start > cursor) {
					fragment.appendChild(document.createTextNode(originalText.slice(cursor, start)));
				}
				const marker = document.createElement('span');
				marker.className = 'docx-paragraph-explanation-entity-link';
				const matchKey = normalizeParagraphExplanationEntityKey(value);
				const entityMeta = entityByNormalizedLabel.get(matchKey);
				if (entityMeta) {
					marker.dataset.entityKey = entityMeta.key;
					marker.style.setProperty('--entity-color', entityMeta.color);
					marker.style.setProperty('--entity-color-soft', entityMeta.softColor);
				}
				marker.textContent = value;
				fragment.appendChild(marker);
				cursor = start + value.length;
			}
			if (cursor < originalText.length) {
				fragment.appendChild(document.createTextNode(originalText.slice(cursor)));
			}
			textNode.parentNode?.replaceChild(fragment, textNode);
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

	function hexToRgba(hex: string, alpha: number): string {
		const normalized = hex.replace('#', '').trim();
		if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(132, 204, 22, ${alpha})`;
		const r = Number.parseInt(normalized.slice(0, 2), 16);
		const g = Number.parseInt(normalized.slice(2, 4), 16);
		const b = Number.parseInt(normalized.slice(4, 6), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	function highlightSnippetInElement(
		element: HTMLElement,
		rawSnippet: string,
		meta?: {
			ownerParagraphId?: string;
			role?: 'a' | 'b';
			contradictionType?: ContradictionTaxonomyType | null;
		}
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
		if (meta?.contradictionType) {
			mark.dataset.contradictionType = meta.contradictionType;
		}
		if (meta?.role === 'b') {
			const categoryColor = meta.contradictionType
				? (CONTRADICTION_TAXONOMY_COLORS[meta.contradictionType] ??
					CONTRADICTION_TAXONOMY_COLORS.specificity)
				: CONTRADICTION_TAXONOMY_COLORS.specificity;
			mark.style.setProperty('--contradiction-b-color', categoryColor);
			mark.style.setProperty('--contradiction-b-bg', hexToRgba(categoryColor, 0.22));
			mark.style.setProperty('--contradiction-b-bg-active', hexToRgba(categoryColor, 0.34));
			mark.style.setProperty('--contradiction-b-ring', categoryColor);
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
		meta?: {
			ownerParagraphId?: string;
			role?: 'a' | 'b';
			contradictionType?: ContradictionTaxonomyType | null;
		}
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
		if (typeof document === 'undefined') return;
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
			element.style.removeProperty('--tw-ring-color');
			element.style.removeProperty('--tw-ring-offset-shadow');
			element.style.removeProperty('--tw-ring-shadow');
			element.style.removeProperty('outline');
			clearSnippetMarks(element);
			delete element.dataset.contradictionConfidenceBand;
			delete element.dataset.contradictionConfidence;
			delete element.dataset.contradictionReason;
		}

		if (typeof document !== 'undefined') {
			// Hard cleanup for any stale contradiction decorations outside tracked paragraph map
			for (const element of document.querySelectorAll<HTMLElement>(
				'.docx-contradiction-highlight, .docx-contradiction-selected'
			)) {
				element.classList.remove('docx-contradiction-highlight', 'docx-contradiction-selected');
				element.style.removeProperty('--tw-ring-color');
				element.style.removeProperty('--tw-ring-offset-shadow');
				element.style.removeProperty('--tw-ring-shadow');
				element.style.removeProperty('outline');
				delete element.dataset.contradictionConfidenceBand;
				delete element.dataset.contradictionConfidence;
				delete element.dataset.contradictionReason;
			}
			for (const mark of document.querySelectorAll<HTMLElement>('mark.docx-contradiction-snippet')) {
				const parent = mark.parentNode;
				if (!parent) continue;
				while (mark.firstChild) {
					parent.insertBefore(mark.firstChild, mark);
				}
				parent.removeChild(mark);
			}
		}
	}

	function syncContradictionDecorations() {
		if (typeof document === 'undefined') return;
		if (shouldShowContradictionDecorations) {
			applyContradictionHighlights();
			return;
		}
		clearContradictionHighlights();
		contradictionScrollMarkers = [];
		selectedContradictionEvidenceLink = null;
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
		const hostScrollTop = documentScrollHost.scrollTop;
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
			const elementRect = element.getBoundingClientRect();
			const centerOffset = elementRect.top - hostRect.top + hostScrollTop + elementRect.height / 2;
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

		let displayACenterPx = Math.max(0, Math.min(hostRect.height, aCenterPx));
		let displayBCenterPx = Math.max(0, Math.min(hostRect.height, bCenterPx));
		if (showA && showB) {
			const currentGap = Math.abs(displayACenterPx - displayBCenterPx);
			if (currentGap < CONTRADICTION_EVIDENCE_MARKER_MIN_GAP_PX) {
				const aIsAbove = displayACenterPx <= displayBCenterPx;
				const center = (displayACenterPx + displayBCenterPx) / 2;
				let top = center - CONTRADICTION_EVIDENCE_MARKER_MIN_GAP_PX / 2;
				let bottom = center + CONTRADICTION_EVIDENCE_MARKER_MIN_GAP_PX / 2;
				if (hostRect.height >= CONTRADICTION_EVIDENCE_MARKER_MIN_GAP_PX) {
					if (top < 0) {
						bottom += -top;
						top = 0;
					}
					if (bottom > hostRect.height) {
						top -= bottom - hostRect.height;
						bottom = hostRect.height;
					}
				} else {
					top = 0;
					bottom = hostRect.height;
				}
				top = Math.max(0, top);
				bottom = Math.min(hostRect.height, bottom);
				if (aIsAbove) {
					displayACenterPx = top;
					displayBCenterPx = bottom;
				} else {
					displayACenterPx = bottom;
					displayBCenterPx = top;
				}
			}
		}

		const topPx = Math.min(displayACenterPx, displayBCenterPx);
		const bottomPx = Math.max(displayACenterPx, displayBCenterPx);
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
			aCenterPx: displayACenterPx,
			bCenterPx: displayBCenterPx
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
			element.style.setProperty('--tw-ring-color', 'transparent');
			element.style.setProperty('--tw-ring-offset-shadow', '0 0 #0000');
			element.style.setProperty('--tw-ring-shadow', '0 0 #0000');
			element.style.setProperty('outline', 'none');
			element.dataset.contradictionConfidenceBand = confidenceBand;
			element.dataset.contradictionConfidence = String(result.confidence);
			element.dataset.contradictionReason = result.brief_reason ?? '';

			const evidence = result.evidence;
			const contradictionType = result.contradiction_type ?? 'specificity';
			if (evidence?.snippet_a?.trim()) {
				if (evidence.source_a === 'context') {
					highlightSnippetAcrossDocument(evidence.snippet_a, element, {
						ownerParagraphId: paragraphId,
						role: 'a',
						contradictionType
					});
				} else {
					highlightSnippetInElement(element, evidence.snippet_a, {
						ownerParagraphId: paragraphId,
						role: 'a',
						contradictionType
					}) ||
						highlightSnippetAcrossDocument(evidence.snippet_a, element, {
							ownerParagraphId: paragraphId,
							role: 'a',
							contradictionType
						});
				}
			}
			if (evidence?.snippet_b?.trim()) {
				if (evidence.source_b === 'context') {
					highlightSnippetAcrossDocument(evidence.snippet_b, element, {
						ownerParagraphId: paragraphId,
						role: 'b',
						contradictionType
					});
				} else {
					highlightSnippetInElement(element, evidence.snippet_b, {
						ownerParagraphId: paragraphId,
						role: 'b',
						contradictionType
					}) ||
						highlightSnippetAcrossDocument(evidence.snippet_b, element, {
							ownerParagraphId: paragraphId,
							role: 'b',
							contradictionType
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
		paragraphExplanationFolds = [];
		paragraphExplanationScrollMarkers = [];
		paragraphExplanationCollapsedCards = [];
		paragraphExplanationMovedNodeIds = new Set<string>();
		setHoveredParagraphExplanationEntityKey(null);
		clearParagraphExplanationElementHighlights();
	}

	function clearParagraphExplanationElementHighlights() {
		for (const element of paragraphElementById.values()) {
			element.classList.remove(
				'docx-paragraph-explanation-selected',
				'docx-paragraph-explanation-related',
				'docx-paragraph-explanation-source-hidden',
				'docx-paragraph-explanation-muted'
			);
			clearParagraphExplanationEntityMarks(element);
		}
	}

	function applyParagraphExplanationHighlights() {
		clearParagraphExplanationElementHighlights();
		if (!shouldShowRelatedBridgeDecorations) return;
		const bridgeRelatedParagraphs = getBridgeRelatedParagraphs();
		const shouldMuteOutOfContext =
			paragraphExplanationCompression > 0.02 && paragraphExplanationMovedNodeIds.size > 0;
		if (shouldMuteOutOfContext) {
			for (const element of paragraphElementById.values()) {
				element.classList.add('docx-paragraph-explanation-muted');
			}
		}

		const selected = get(selectedParagraph);
		if (!selected?.id) return;
		const selectedElement = paragraphElementById.get(selected.id);
		if (selectedElement) fitShortParagraphSelectionBox(selectedElement);
		selectedElement?.classList.remove('docx-paragraph-explanation-muted');
		selectedElement?.classList.add('docx-paragraph-explanation-selected');
		if (selectedElement) {
			highlightParagraphExplanationEntitiesInElement(selectedElement, paragraphExplanationEntities);
		}
		for (const related of bridgeRelatedParagraphs) {
			const relatedElement = paragraphElementById.get(related.node.id);
			relatedElement?.classList.remove('docx-paragraph-explanation-muted');
			relatedElement?.classList.add('docx-paragraph-explanation-related');
			if (
				paragraphExplanationCompression > 0.02 &&
				paragraphExplanationMovedNodeIds.has(related.node.id)
			) {
				relatedElement?.classList.add('docx-paragraph-explanation-source-hidden');
			}
			if (relatedElement) {
				highlightParagraphExplanationEntitiesInElement(
					relatedElement,
					paragraphExplanationEntities
				);
			}
		}
	}

	function refreshParagraphExplanationConnectorPaths() {
		if (!documentScrollHost || !shouldShowRelatedBridgeDecorations) {
			paragraphExplanationConnectors = [];
			paragraphExplanationFolds = [];
			paragraphExplanationScrollMarkers = [];
			paragraphExplanationCollapsedCards = [];
			return;
		}

		const selected = get(selectedParagraph);
		if (!selected?.id) {
			paragraphExplanationConnectors = [];
			paragraphExplanationFolds = [];
			paragraphExplanationScrollMarkers = [];
			paragraphExplanationCollapsedCards = [];
			return;
		}

		const selectedElement = paragraphElementById.get(selected.id);
		if (!selectedElement) {
			paragraphExplanationConnectors = [];
			paragraphExplanationFolds = [];
			paragraphExplanationScrollMarkers = [];
			paragraphExplanationCollapsedCards = [];
			return;
		}

		const hostRect = documentScrollHost.getBoundingClientRect();
		const selectedRect = selectedElement.getBoundingClientRect();
		const selectedY = selectedRect.top - hostRect.top + selectedRect.height / 2;
		const selectedEdgeX = selectedRect.left - hostRect.left;
		const bridgeRelatedParagraphs = getBridgeRelatedParagraphs();

		const anchors: Array<{
			y: number;
			height: number;
			edgeX: number;
			paragraphId: string;
			paragraphEnum: number;
			relationKind: RelatedVisualKind;
			relationLabel: string;
			top: number;
			width: number;
			html: string;
		}> = [];
		for (const related of bridgeRelatedParagraphs) {
			const relatedElement = paragraphElementById.get(related.node.id);
			if (!relatedElement) continue;
			const relatedRect = relatedElement.getBoundingClientRect();
			const relatedY = relatedRect.top - hostRect.top + relatedRect.height / 2;
			const relatedClone = relatedElement.cloneNode(true) as HTMLElement;
			relatedClone.removeAttribute('contenteditable');
			relatedClone.removeAttribute('spellcheck');
			delete relatedClone.dataset.nodeId;
			delete relatedClone.dataset.paragraphKind;
			delete relatedClone.dataset.docxEditableRoot;
			relatedClone.classList.remove(
				'docx-paragraph-explanation-related',
				'docx-paragraph-explanation-source-hidden',
				'docx-related-context',
				'docx-related-linked',
				'docx-related-selected'
			);
			relatedClone.classList.add('docx-paragraph-explanation-cloned-node');
			const visualMeta = resolveRelatedVisualMeta(related);
			const relationKind: RelatedVisualKind = visualMeta.kind;
			const relationLabel = relationKind === 'similarity' ? 'Similarity' : 'Reference';
			anchors.push({
				y: relatedY,
				height: relatedRect.height,
				edgeX: relatedRect.left - hostRect.left,
				paragraphId: related.node.id,
				paragraphEnum: related.node.paragraph_enum,
				relationKind,
				relationLabel,
				top: relatedRect.top - hostRect.top,
				width: relatedRect.width,
				html: relatedClone.outerHTML
			});
		}

		if (anchors.length === 0) {
			paragraphExplanationConnectors = [];
			paragraphExplanationFolds = [];
			paragraphExplanationScrollMarkers = [];
			paragraphExplanationCollapsedCards = [];
			return;
		}

		const sortedAnchors = [...anchors].sort(
			(left, right) =>
				Math.abs(left.y - selectedY) - Math.abs(right.y - selectedY) || left.y - right.y
		);
		const selectedParagraphEnum =
			typeof selected.paragraph_enum === 'number'
				? selected.paragraph_enum
				: Number((selected.id.match(/-p-(\d+)$/)?.[1] ?? '0'));
		const selectedTop = selectedRect.top - hostRect.top;
		const selectedBottom = selectedTop + selectedRect.height;
		const stationaryByParagraphId = new Map<string, boolean>();
		for (const anchor of anchors) {
			const isConsecutive = Math.abs(anchor.paragraphEnum - selectedParagraphEnum) === 1;
			const anchorBottom = anchor.top + anchor.height;
			const verticalGap =
				anchor.top >= selectedBottom ? anchor.top - selectedBottom : selectedTop - anchorBottom;
			const isSideBySide = verticalGap <= PARAGRAPH_EXPLANATION_CONSECUTIVE_GAP_PX;
			stationaryByParagraphId.set(anchor.paragraphId, isConsecutive && isSideBySide);
		}

		const stationaryAnchors = anchors.filter(
			(anchor) => stationaryByParagraphId.get(anchor.paragraphId) === true
		);
		const movableAnchors = anchors.filter(
			(anchor) => stationaryByParagraphId.get(anchor.paragraphId) !== true
		);
		const beforeAnchors = movableAnchors
			.filter((anchor) => anchor.paragraphEnum < selectedParagraphEnum)
			.sort((left, right) => left.paragraphEnum - right.paragraphEnum);
		const afterAnchors = movableAnchors
			.filter((anchor) => anchor.paragraphEnum > selectedParagraphEnum)
			.sort((left, right) => left.paragraphEnum - right.paragraphEnum);
		const equalAnchors = movableAnchors
			.filter((anchor) => anchor.paragraphEnum === selectedParagraphEnum)
			.sort((left, right) => left.paragraphId.localeCompare(right.paragraphId));
		const compressedYByParagraphId = new Map<string, number>();
		const compressedTopByParagraphId = new Map<string, number>();
		for (const anchor of stationaryAnchors) {
			compressedYByParagraphId.set(anchor.paragraphId, anchor.y);
			compressedTopByParagraphId.set(anchor.paragraphId, anchor.top);
		}

		const stationaryAbove = stationaryAnchors.filter((anchor) => anchor.top < selectedTop);
		const stationaryBelow = stationaryAnchors.filter((anchor) => anchor.top >= selectedTop);
		let beforeCursor = selectedTop - PARAGRAPH_EXPLANATION_STACK_OFFSET_PX;
		if (stationaryAbove.length > 0) {
			const nearestStationaryAboveTop = Math.max(...stationaryAbove.map((anchor) => anchor.top));
			beforeCursor = Math.min(
				beforeCursor,
				nearestStationaryAboveTop - PARAGRAPH_EXPLANATION_STACK_CARD_GAP_PX
			);
		}
		for (const anchor of [...beforeAnchors].sort((left, right) => right.paragraphEnum - left.paragraphEnum)) {
			const stackedTop = beforeCursor - anchor.height;
			const stackedY = stackedTop + anchor.height / 2;
			const compressedY =
				anchor.y * (1 - paragraphExplanationCompression) + stackedY * paragraphExplanationCompression;
			const compressedTop =
				anchor.top * (1 - paragraphExplanationCompression) +
				stackedTop * paragraphExplanationCompression;
			compressedYByParagraphId.set(anchor.paragraphId, compressedY);
			compressedTopByParagraphId.set(anchor.paragraphId, compressedTop);
			beforeCursor = stackedTop - PARAGRAPH_EXPLANATION_STACK_CARD_GAP_PX;
		}

		let afterCursor = selectedBottom + PARAGRAPH_EXPLANATION_STACK_OFFSET_PX;
		if (stationaryBelow.length > 0) {
			const nearestStationaryBelowBottom = Math.min(
				...stationaryBelow.map((anchor) => anchor.top + anchor.height)
			);
			afterCursor = Math.max(
				afterCursor,
				nearestStationaryBelowBottom + PARAGRAPH_EXPLANATION_STACK_CARD_GAP_PX
			);
		}
		for (const anchor of [...equalAnchors, ...afterAnchors]) {
			const stackedTop = afterCursor;
			const stackedY = stackedTop + anchor.height / 2;
			const compressedY =
				anchor.y * (1 - paragraphExplanationCompression) + stackedY * paragraphExplanationCompression;
			const compressedTop =
				anchor.top * (1 - paragraphExplanationCompression) +
				stackedTop * paragraphExplanationCompression;
			compressedYByParagraphId.set(anchor.paragraphId, compressedY);
			compressedTopByParagraphId.set(anchor.paragraphId, compressedTop);
			afterCursor = stackedTop + anchor.height + PARAGRAPH_EXPLANATION_STACK_CARD_GAP_PX;
		}
		const edgeBaseX = Math.min(selectedEdgeX, ...sortedAnchors.map((anchor) => anchor.edgeX));
		const baseLeft = Math.max(4, edgeBaseX - 20);
		const trunkTop = Math.min(
			selectedY,
			...sortedAnchors.map(
				(anchor) => compressedYByParagraphId.get(anchor.paragraphId) ?? anchor.y
			)
		);
		const trunkBottom = Math.max(
			selectedY,
			...sortedAnchors.map(
				(anchor) => compressedYByParagraphId.get(anchor.paragraphId) ?? anchor.y
			)
		);
		const selectedCapWidthPx = Math.max(
			8,
			selectedEdgeX - baseLeft - PARAGRAPH_EXPLANATION_PARAGRAPH_GAP_PX
		);
		const nextConnectors: Array<{
			topPx: number;
			bottomPx: number;
			leftPx: number;
			selectedCapTopPx: number;
			selectedCapWidthPx: number;
			relatedCapTopPx: number;
			relatedCapWidthPx: number;
			paragraphId: string;
			relationKind: RelatedVisualKind;
			relationLabel: string;
			labelLeftPx: number;
		}> = [];
		for (const anchor of sortedAnchors) {
			// Keep connector anchors tied to real paragraph positions.
			// We intentionally avoid clamping to viewport edges so the line does not "snap"
			// when one paragraph goes out of view.
			const relatedCapWidthPx = Math.max(
				8,
				anchor.edgeX - baseLeft - PARAGRAPH_EXPLANATION_PARAGRAPH_GAP_PX
			);
			nextConnectors.push({
				topPx: trunkTop,
				bottomPx: trunkBottom,
				leftPx: baseLeft,
				selectedCapTopPx: selectedY,
				selectedCapWidthPx,
				relatedCapTopPx: compressedYByParagraphId.get(anchor.paragraphId) ?? anchor.y,
				relatedCapWidthPx,
				paragraphId: anchor.paragraphId,
				relationKind: anchor.relationKind,
				relationLabel: anchor.relationLabel,
				labelLeftPx: baseLeft - 50
			});
		}

		paragraphExplanationConnectors = nextConnectors;
		const movedNodeIds = new Set<string>();
		for (const anchor of anchors) {
			const movedTop = compressedTopByParagraphId.get(anchor.paragraphId) ?? anchor.top;
			if (Math.abs(movedTop - anchor.top) > 1.5) {
				movedNodeIds.add(anchor.paragraphId);
			}
		}
		paragraphExplanationMovedNodeIds = movedNodeIds;
		if (paragraphExplanationCompression > 0.03 && movedNodeIds.size > 0) {
			const foldSourceY = [
				selectedY,
				...sortedAnchors.map(
					(anchor) => compressedYByParagraphId.get(anchor.paragraphId) ?? anchor.y
				)
			]
				.sort((left, right) => left - right)
				.filter((value, index, list) => index === 0 || Math.abs(value - list[index - 1]) > 2);
			const nextFolds: Array<{ topPx: number; leftPx: number }> = [];
			for (let index = 0; index < foldSourceY.length - 1; index += 1) {
				const upper = foldSourceY[index];
				const lower = foldSourceY[index + 1];
				if (lower - upper < 26) continue;
				nextFolds.push({
					topPx: upper + (lower - upper) / 2,
					leftPx: baseLeft
				});
			}
			paragraphExplanationFolds = nextFolds;
		} else {
			paragraphExplanationFolds = [];
		}
		const cardsLeft = Math.max(14, selectedRect.left - hostRect.left);
		paragraphExplanationCollapsedCards =
			paragraphExplanationCompression > 0.02 && movedNodeIds.size > 0
				? anchors
						.filter((anchor) => movedNodeIds.has(anchor.paragraphId))
						.map((anchor) => ({
						paragraphId: anchor.paragraphId,
						topPx: compressedTopByParagraphId.get(anchor.paragraphId) ?? anchor.top,
						leftPx: cardsLeft,
						widthPx: Math.min(anchor.width, hostRect.width - cardsLeft - 20),
						html: anchor.html
					}))
						.sort((left, right) => left.topPx - right.topPx)
				: [];

		const hostScrollHeight = documentScrollHost.scrollHeight;
		if (!Number.isFinite(hostScrollHeight) || hostScrollHeight <= 0) {
			paragraphExplanationScrollMarkers = [];
			return;
		}
		const nextScrollMarkers: RelatedScrollMarker[] = [];
		for (const related of bridgeRelatedParagraphs) {
			const relatedElement = paragraphElementById.get(related.node.id);
			if (!relatedElement) continue;
			const relatedRect = relatedElement.getBoundingClientRect();
			const centerOffset =
				relatedRect.top - hostRect.top + documentScrollHost.scrollTop + relatedRect.height / 2;
			const rawTopPercent = (centerOffset / hostScrollHeight) * 100;
			const topPercent = Math.min(99.6, Math.max(0.4, rawTopPercent));
			nextScrollMarkers.push({
				paragraphId: related.node.id,
				topPercent,
				kind: resolveRelatedVisualMeta(related).kind
			});
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

	function handleParagraphExplanationShiftWheel(event: WheelEvent) {
		if (!shouldShowRelatedBridgeDecorations) return;
		if (!event.shiftKey) return;
		const wheelDelta =
			Math.abs(event.deltaY) >= PARAGRAPH_EXPLANATION_WHEEL_DIRECTION_DEADZONE
				? event.deltaY
				: event.deltaX;
		if (Math.abs(wheelDelta) < PARAGRAPH_EXPLANATION_WHEEL_DIRECTION_DEADZONE) return;
		event.preventDefault();
		const nextTarget = wheelDelta > 0 ? 1 : 0;
		if (
			nextTarget === paragraphExplanationCompressionTarget &&
			paragraphExplanationCompressionTweenFrame != null
		) {
			return;
		}

		paragraphExplanationCompressionTarget = nextTarget;
		paragraphExplanationCompressionStart = paragraphExplanationCompression;
		paragraphExplanationCompressionStartTime =
			typeof performance !== 'undefined' ? performance.now() : Date.now();

		if (paragraphExplanationCompressionTweenFrame != null) {
			window.cancelAnimationFrame(paragraphExplanationCompressionTweenFrame);
			paragraphExplanationCompressionTweenFrame = null;
		}

		const animateCompression = (timestamp: number) => {
			const elapsed = timestamp - paragraphExplanationCompressionStartTime;
			const linearProgress = Math.max(
				0,
				Math.min(1, elapsed / PARAGRAPH_EXPLANATION_COMPRESS_DURATION_MS)
			);
			const easedProgress =
				linearProgress < 0.5
					? 4 * linearProgress * linearProgress * linearProgress
					: 1 - Math.pow(-2 * linearProgress + 2, 3) / 2;
			paragraphExplanationCompression =
				paragraphExplanationCompressionStart +
				(paragraphExplanationCompressionTarget - paragraphExplanationCompressionStart) *
					easedProgress;

			applyParagraphExplanationHighlights();
			refreshParagraphExplanationConnectorPaths();

			const delta = Math.abs(
				paragraphExplanationCompressionTarget - paragraphExplanationCompression
			);
			if (linearProgress >= 1 || delta <= PARAGRAPH_EXPLANATION_COMPRESS_SNAP_EPSILON) {
				paragraphExplanationCompression = paragraphExplanationCompressionTarget;
				paragraphExplanationCompressionTweenFrame = null;
				applyParagraphExplanationHighlights();
				refreshParagraphExplanationConnectorPaths();
				return;
			}
			paragraphExplanationCompressionTweenFrame =
				window.requestAnimationFrame(animateCompression);
		};
		animateCompression(paragraphExplanationCompressionStartTime);
		paragraphExplanationCompressionTweenFrame = window.requestAnimationFrame(animateCompression);
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
		scheduleRelatedScrollMarkerRefresh();
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

	function setContradictionResults(results: ContradictionParagraphResult[], _source: string | null) {
		const next = new Map<string, ContradictionParagraphResult>();
		for (const row of results) {
			next.set(String(row.paragraph_id), row);
		}
		contradictionResultsByParagraphId = next;
		syncContradictionDecorations();
	}

	function setContradictionErrorMessage(message: string | null) {
		contradictionError = message;
	}

	function contradictionModeLabel(mode: ContradictionGraphMode): string {
		return mode === 'with_kg' ? 'KG' : 'No KG';
	}

	function buildContradictionAnalysisPayload(
		mode: ContradictionGraphMode
	): ContradictionAnalysisRequest | null {
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
			mode,
			graph: {
				nodes,
				edges: backendEdges
			}
		};
	}

	async function loadSavedContradictions() {
		activeRightPanelTab = 'analysis';
		isRightDrawerOpen = true;
		hasTriggeredContradictionCheck = true;

		if (!activeDocumentId) {
			setContradictionErrorMessage('No document is loaded.');
			return;
		}

		contradictionLoading = true;
		setContradictionErrorMessage(null);
		try {
			const response = await fetchSavedContradictions(activeDocumentId, contradictionGraphMode);
			setContradictionResults(
				response.paragraphResults ?? [],
				`${response.sourceFile} (${contradictionModeLabel(response.mode)})`
			);
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
		hasTriggeredContradictionCheck = true;

		if (backendGraphLoading) {
			setContradictionErrorMessage(
				'Wait until graph generation finishes before searching contradictions.'
			);
			return;
		}

		const payload = buildContradictionAnalysisPayload(contradictionGraphMode);
		if (!payload) {
			setContradictionErrorMessage('No paragraph context is available yet.');
			return;
		}

		contradictionLoading = true;
		setContradictionErrorMessage(null);
		try {
			const approved = await confirmLlmEstimate('contradictions_analyze', payload);
			if (!approved) return;
			const response = await fetchContradictionAnalysis(payload);
			const resolvedModel = response.model?.trim() || payload.model || 'default';
			setContradictionResults(
				response.paragraphResults ?? [],
				`llm:openai:${resolvedModel} (${contradictionModeLabel(response.mode)})`
			);
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

	function getEditableRootElement(element: HTMLElement): HTMLElement {
		if (element.matches('[data-docx-editable-root="true"]')) return element;
		return element.querySelector<HTMLElement>('[data-docx-editable-root="true"]') ?? element;
	}

	function freezeIgnoredParagraphElement(element: HTMLElement) {
		const editableRoot = getEditableRootElement(element);
		element.dataset.ignoredParagraph = 'true';
		editableRoot.dataset.ignoredParagraph = 'true';
		for (const target of new Set([element, editableRoot])) {
			target.removeAttribute('contenteditable');
			target.removeAttribute('spellcheck');
			target.removeAttribute('data-node-id');
			target.removeAttribute('data-paragraph-kind');
			target.removeAttribute('data-docx-editable-root');
			target.classList.remove(...EDITABLE_PARAGRAPH_CLASSES);
		}
	}

	function nextAssistantMessageId() {
		assistantMessageCounter += 1;
		return `assistant-${assistantMessageCounter}`;
	}

	function resolveLlmEstimateToast(approved: boolean) {
		if (!llmEstimateToastResolver) return;
		llmEstimateToastResolver(approved);
		llmEstimateToastResolver = null;
		llmEstimateToast = null;
		llmEstimateToastOpen = false;
	}

	function formatAccumulatedCostLabel(): string {
		const formatted = llmTotalCost?.totalCostUsdFormatted;
		if (formatted && formatted !== 'unknown') {
			return `Cost: ${formatted} $`;
		}
		const amount = llmTotalCost?.totalCostUsd ?? 0;
		return `Cost: ${amount.toFixed(8)} $`;
	}

	async function refreshAccumulatedLlmCost() {
		try {
			llmTotalCost = await fetchLlmTotalCost();
			console.log('[COST_DEBUG][client] /llm/cost/total payload:', llmTotalCost);
			llmCostLabel = formatAccumulatedCostLabel();
		} catch (err) {
			console.error('[COST_DEBUG][client] failed to load /llm/cost/total:', err);
		}
	}

	async function confirmLlmEstimate(
		callType:
			| 'assistant_chat'
			| 'assistant_simplify'
			| 'assistant_fix_contradiction'
			| 'contradictions_analyze',
		payload: AssistantChatRequest | SimplifySelectionRequest | ContradictionAnalysisRequest
	): Promise<boolean> {
		const estimatePayload =
			callType === 'assistant_chat'
				? { callType, assistantChat: payload as AssistantChatRequest }
				: callType === 'contradictions_analyze'
					? { callType, contradictionAnalysis: payload as ContradictionAnalysisRequest }
					: { callType, simplifySelection: payload as SimplifySelectionRequest };
		const estimate = await fetchLlmEstimate(estimatePayload);
		if (llmEstimateToastResolver) {
			resolveLlmEstimateToast(false);
		}
		llmEstimateToast = estimate;
		llmEstimateToastOpen = true;
		return await new Promise<boolean>((resolve) => {
			llmEstimateToastResolver = resolve;
		});
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

	type QuickActionResponseOptions = {
		citationId?: string;
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

		if (
			question === QUICK_ACTION_WHY_CONTRADICTION_FREE ||
			question === QUICK_ACTION_WHY_CONTRADICTION_AI
		) {
			assistantInput = questionOverride ? assistantInput : '';
			await askQuickAction(question);
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
			const approved = await confirmLlmEstimate('assistant_chat', payload);
			if (!approved) {
				assistantLoading = false;
				return;
			}
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
			'Use related paragraphs only as supporting context; do not invent facts.',
			'CRITICAL OUTPUT RULES:',
			'- Do NOT return JSON.',
			'- Do NOT use code fences.',
			'- Do NOT include citations, arrays, or metadata.',
			'- Return ONLY these three text blocks, in this exact order and labels:',
			'SHORT_EXPLANATION:',
			'<2-4 sentences, concise, plain language, max ~90 words>',
			'DETAILED_EXPLANATION:',
			'<in-depth explanation, 4-8 sentences, ~180-320 words>',
			'QUALITY REQUIREMENTS FOR DETAILED_EXPLANATION:',
			'1) precise legal meaning of the clause;',
			'2) obligations/duties by party and practical consequences;',
			'3) conditions, exceptions, dependencies, and timeline cues;',
			'4) legal/commercial risks and ambiguities;',
			'5) one concrete real-world scenario showing impact.',
			'Keep legal accuracy while reducing jargon.',
			'ENTITIES:',
			'- list 3 to 8 key legal/business entities or terms copied exactly from the clause/context when possible.',
			'- one entity per line, prefixed with "- ".'
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
			const approved = await confirmLlmEstimate('assistant_chat', payload);
			if (!approved) return;
			const response = await fetchAssistantResponse(payload);
			const parsed = parseParagraphExplanationVariants(response.answer);
			paragraphExplanationShort = parsed.shortText;
			paragraphExplanationDetailed = parsed.detailedText;
			paragraphExplanationEntities = buildParagraphExplanationEntityHighlights(parsed.entities);
			applyParagraphExplanationHighlights();
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
			const approved = await confirmLlmEstimate('assistant_chat', payload);
			if (!approved) {
				assistantLoading = false;
				return;
			}
			const response = await fetchAssistantResponse(payload);

			assistantMessages = [
				...assistantMessages,
				{
					id: nextAssistantMessageId(),
					role: 'assistant',
					content: response.answer,
					citations: response.citations,
					suggestedQuestions: resolveAssistantSuggestedQuestions(response.suggestedQuestions, {
						mode: 'explain',
						scope: 'selected',
						contradiction: true
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

	function appendAssistantQuickActionMessage(
		content: string,
		optionsOrCitation?: QuickActionResponseOptions | string
	) {
		const options: QuickActionResponseOptions =
			typeof optionsOrCitation === 'string'
				? { citationId: optionsOrCitation }
				: (optionsOrCitation ?? {});
		assistantMessages = [
			...assistantMessages,
			{
				id: nextAssistantMessageId(),
				role: 'assistant',
				content,
				citations: options.citationId
					? [{ id: options.citationId, excerpt: '(selected paragraph)' }]
					: undefined
			}
		];
	}

	function truncateFixChangeText(text: string, maxLength = 120): string {
		const compact = text.replace(/\s+/g, ' ').trim();
		if (compact.length <= maxLength) return compact;
		return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
	}

	function buildFixSuggestionChangeNotes(original: string, rewritten: string): string[] {
		const changeLog = buildChangeLog(original, rewritten);
		if (!changeLog.hasChanges) {
			return ['Review wording alignment with related clauses and payment/obligation timing.'];
		}

		const removed = changeLog.oldSegments
			.filter((segment) => segment.changed)
			.map((segment) => truncateFixChangeText(segment.value))
			.filter(Boolean);
		const added = changeLog.newSegments
			.filter((segment) => segment.changed)
			.map((segment) => truncateFixChangeText(segment.value))
			.filter(Boolean);

		const notes: string[] = [];
		const maxPairs = Math.min(3, Math.max(removed.length, added.length));
		for (let index = 0; index < maxPairs; index += 1) {
			const removedText = removed[index];
			const addedText = added[index];
			if (removedText && addedText) {
				notes.push(`Replace "${removedText}" with "${addedText}".`);
				continue;
			}
			if (addedText) {
				notes.push(`Add "${addedText}".`);
				continue;
			}
			if (removedText) {
				notes.push(`Remove "${removedText}".`);
			}
		}

		if (notes.length === 0) {
			notes.push('Refine language to keep one consistent legal statement and remove ambiguity.');
		}
		return notes;
	}

	function appendFixContradictionSuggestionMessage(suggestion: FixContradictionSuggestion) {
		assistantMessages = [
			...assistantMessages,
			{
				id: nextAssistantMessageId(),
				role: 'assistant',
				content: `Structured contradiction-fix suggestion for paragraph ${suggestion.paragraphId}.`,
				citations: [{ id: suggestion.paragraphId, excerpt: '(selected paragraph)' }],
				fixContradictionSuggestion: suggestion
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
				const footerMessage =
					'Use "Why is it a contradiction? (AI cost)" for deeper evidence with richer legal reasoning.';
				const evidenceLines =
					evidence?.snippet_a?.trim() && evidence?.snippet_b?.trim()
						? [
								`Snippet A (${evidence.source_a?.trim() || 'paragraph'}): "${evidence.snippet_a.trim()}"`,
								`Snippet B (${evidence.source_b?.trim() || 'paragraph'}): "${evidence.snippet_b.trim()}"`
							]
						: [
								'No structured evidence snippets were returned by the classifier.'
							];
				appendAssistantQuickActionMessage(
					[
						`Free explanation for paragraph ${selected.id}:`,
						reason,
						`Confidence: ${confidence}%`,
						...evidenceLines,
						footerMessage
					].join('\n\n'),
					{
						citationId: selected.id
					}
				);
				await scrollAssistantToBottom();
				return;
			}

			await submitStructuredContradictionWhy(selected, contradiction);
			return;
		}

		await submitAssistantQuestion(prompt);
	}

	function onSuggestedQuestionClick(question: string) {
		void submitAssistantQuestion(question);
	}

	function handleAssistantQuickActionSuggestion(question: string) {
		void askQuickAction(question);
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
		void runContradictionFixSuggestionFromChat();
	}

	async function runContradictionFixSuggestionFromChat() {
		if (fixContradictionLoading || assistantLoading || simplifyLoading) return;
		assistantError = null;
		assistantMessages = [
			...assistantMessages,
			{
				id: nextAssistantMessageId(),
				role: 'user',
				content:
					'Suggest a contradiction fix and structure the response with the key changes and a ready-to-apply rewrite.'
			}
		];
		await scrollAssistantToBottom();

		const target = resolveActiveSimplifyTarget();
		const paragraphNode = target
			? (get(paragraphs).find((node) => node.id === target.paragraphId) ?? null)
			: null;
		if (paragraphNode) setSelectedParagraphNode(paragraphNode);

		fixContradictionLoading = true;
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
				resolveErrorMessage: getAxiosErrorMessage,
				confirmLlmEstimate: (callType, requestPayload) =>
					confirmLlmEstimate(callType, requestPayload)
			});
			if (!execution.ok) {
				appendAssistantQuickActionMessage(
					`I could not generate a contradiction-fix suggestion: ${execution.error}`
				);
				return;
			}

			const contradiction = contradictionResultsByParagraphId.get(execution.target.paragraphId);
			appendFixContradictionSuggestionMessage({
				paragraphId: execution.target.paragraphId,
				reason: contradiction?.brief_reason?.trim() || undefined,
				changeNotes: buildFixSuggestionChangeNotes(
					execution.result.payload.originalSnippet,
					execution.result.payload.simplifiedSnippet
				),
				rewriteResult: execution.result,
				status: 'pending'
			});

			simplifyAuditTrail.unshift(execution.auditRecord);
			if (simplifyAuditTrail.length > MAX_SIMPLIFY_AUDIT_TRAIL) {
				simplifyAuditTrail.length = MAX_SIMPLIFY_AUDIT_TRAIL;
			}
		} finally {
			fixContradictionLoading = false;
			refreshSimplifyTarget();
			await scrollAssistantToBottom();
		}
	}

	async function acceptFixSuggestionFromChat(messageId: string) {
		const message = assistantMessages.find((entry) => entry.id === messageId);
		const suggestion = message?.fixContradictionSuggestion;
		if (!suggestion || suggestion.status === 'applied') return;

		const applied = applyRewriteToParagraph({
			simplifyResult: suggestion.rewriteResult,
			paragraphElementById
		});
		if (!applied.ok) {
			const failureReason = applied.error ?? 'Failed to apply suggestion.';
			assistantMessages = [
				...assistantMessages,
				{
					id: nextAssistantMessageId(),
					role: 'assistant',
					content: `Could not apply the suggestion: ${failureReason}`
				}
			];
			assistantError = failureReason;
			await scrollAssistantToBottom();
			return;
		}

		const appliedParagraphId = applied.paragraphId ?? suggestion.paragraphId;
		const selectedNode = get(paragraphs).find((node) => node.id === appliedParagraphId) ?? null;
		if (selectedNode) setSelectedParagraphNode(selectedNode);

		assistantMessages = assistantMessages.map((entry) =>
			entry.id === messageId && entry.fixContradictionSuggestion
				? {
						...entry,
						fixContradictionSuggestion: {
							...entry.fixContradictionSuggestion,
							status: 'applied'
						}
					}
				: entry
		);
		assistantMessages = [
			...assistantMessages,
			{
				id: nextAssistantMessageId(),
				role: 'assistant',
				content: `Suggestion applied directly to paragraph ${appliedParagraphId}.`,
				citations: [{ id: appliedParagraphId, excerpt: '(updated paragraph)' }]
			}
		];
		assistantError = null;
		refreshSimplifyTarget();
		await scrollAssistantToBottom();
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
				resolveErrorMessage: getAxiosErrorMessage,
				confirmLlmEstimate: (callType, requestPayload) =>
					confirmLlmEstimate(callType, requestPayload)
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

	type RunSimplifyOptions = {
		openRevisionsPanel?: boolean;
	};

	async function runSimplify(options?: RunSimplifyOptions) {
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
				resolveErrorMessage: getAxiosErrorMessage,
				confirmLlmEstimate: (callType, requestPayload) =>
					confirmLlmEstimate(callType, requestPayload)
			});
			if (!execution.ok) {
				simplifyError = execution.error;
				return;
			}

			simplifyResult = execution.result;
			latestRewriteSource = 'simplify';
			if (options?.openRevisionsPanel ?? true) {
				activeRightPanelTab = 'revisions';
				isRightDrawerOpen = true;
			}

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
		contradictionError = null;
		hasTriggeredContradictionCheck = false;
		contradictionScrollMarkers = [];
		selectedContradictionEvidenceLink = null;
		relatedScrollMarkers = [];
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
	type DocxTabStop = {
		positionPx: number;
		style: string;
		leader: string;
	};

	function normalizeDocxTabStyle(rawStyle: string | undefined): string {
		const style = (rawStyle ?? 'left').toLowerCase();
		switch (style) {
			case 'start':
				return 'left';
			case 'end':
				return 'right';
			default:
				return style;
		}
	}

	function parsePxValue(rawValue?: string | null): number | null {
		if (!rawValue) return null;
		const parsed = Number.parseFloat(rawValue);
		return Number.isFinite(parsed) ? parsed : null;
	}

	function isIgnorableTextNode(node: Node): boolean {
		return node.nodeType === Node.TEXT_NODE && !(node.textContent ?? '').trim();
	}

	function isPageChromeNode(node: Node): boolean {
		return node instanceof HTMLElement && node.dataset.docxPageChrome === 'true';
	}

	function isIgnorablePageNode(node: Node): boolean {
		return isIgnorableTextNode(node) || isPageChromeNode(node);
	}

	function getMeaningfulNodes(parent: HTMLElement): Node[] {
		return Array.from(parent.childNodes).filter((child) => !isIgnorablePageNode(child));
	}

	function countMeaningfulChildren(parent: HTMLElement): number {
		let count = 0;
		for (const child of Array.from(parent.childNodes)) {
			if (isIgnorablePageNode(child)) continue;
			count += 1;
		}
		return count;
	}

	function getLastMeaningfulNode(parent: HTMLElement): Node | null {
		const children = Array.from(parent.childNodes);
		for (let i = children.length - 1; i >= 0; i -= 1) {
			const node = children[i];
			if (isIgnorablePageNode(node)) continue;
			return node;
		}
		return null;
	}

	function getLastMeaningfulElement(parent: HTMLElement): HTMLElement | null {
		const node = getLastMeaningfulNode(parent);
		return node instanceof HTMLElement ? node : null;
	}

	function getPreviousMeaningfulSibling(node: Node | null): HTMLElement | null {
		let current = node?.previousSibling ?? null;
		while (current) {
			if (!isIgnorablePageNode(current)) {
				return current instanceof HTMLElement ? current : null;
			}
			current = current.previousSibling;
		}
		return null;
	}

	function parseDocxTabStops(rawStops: string | undefined): DocxTabStop[] {
		if (!rawStops) return [];
		return rawStops
			.split(/[;,]/)
			.map((entry) => entry.trim())
			.filter(Boolean)
			.map((entry) => {
				const [rawPos, rawStyle, rawLeader] = entry.split('|');
				const positionPx = Number.parseFloat(rawPos);
				if (!Number.isFinite(positionPx) || positionPx < 0) return null;
				return {
					positionPx,
					style: normalizeDocxTabStyle(rawStyle),
					leader: (rawLeader ?? 'none').toLowerCase()
				} as DocxTabStop;
			})
			.filter((stop): stop is DocxTabStop => stop !== null)
			.sort((left, right) => left.positionPx - right.positionPx);
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

	function buildDocxTabGridTemplate(stops: DocxTabStop[], segmentsCount: number): string {
		const requiredFixedCols = Math.max(segmentsCount - 1, 1);
		const fixedCols: number[] = [];
		let previousStop = 0;
		for (const stop of stops) {
			const width = Math.max(stop.positionPx - previousStop, 2);
			fixedCols.push(width);
			previousStop = stop.positionPx;
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
		stops: DocxTabStop[],
		segments: Node[][]
	): boolean {
		if (container.dataset.docxListItem === 'true') return false;
		if (stops.length === 0 || segments.length < 2) return false;
		if (stops[0].positionPx < 120) return false;
		if (stops.some((stop) => stop.style === 'right' || stop.style === 'center')) return false;

		const leadingText = segmentText(segments[0]);
		const rightText = segmentText(segments[1]);
		if (!leadingText && !rightText) return false;

		const tabCount = segments.length - 1;
		if (tabCount > 10) return false;
		return true;
	}

	function applyDocxTabGridLayout(
		container: HTMLElement,
		stops: DocxTabStop[],
		segments: Node[][]
	) {
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

	function applyDocxTabLeaderStyle(tab: HTMLElement, leader: string) {
		tab.style.textDecoration = 'inherit';
		tab.style.textDecorationStyle = '';
		switch (leader) {
			case 'dot':
			case 'middledot':
				tab.style.textDecoration = 'underline';
				tab.style.textDecorationStyle = 'dotted';
				break;
			case 'hyphen':
			case 'heavy':
			case 'underscore':
				tab.style.textDecoration = 'underline';
				break;
		}
	}

	function collectDocxTabContainers(targetViewer: HTMLElement): HTMLElement[] {
		const containers = new Set<HTMLElement>();
		const tabs = targetViewer.querySelectorAll<HTMLElement>('span[data-docx-tab="1"]');
		for (const tab of tabs) {
			const container = tab.closest<HTMLElement>(
				'[data-docx-editable-root="true"], [data-node-id]'
			);
			if (container) containers.add(container);
		}
		return Array.from(containers);
	}

	function applyDocxTabStops(targetViewer: HTMLElement) {
		const containers = collectDocxTabContainers(targetViewer);
		for (const container of containers) {
			const stops = parseDocxTabStops(container.dataset.docxTabStops);

			const tabs = container.querySelectorAll<HTMLElement>('span[data-docx-tab=\"1\"]');
			if (tabs.length === 0) continue;

			const segments = splitNodesByDocxTabs(container);
			if (shouldUseDocxTabGridLayout(container, stops, segments)) {
				applyDocxTabGridLayout(container, stops, segments);
				continue;
			}

			const containerRect = container.getBoundingClientRect();
			const containerStyle = window.getComputedStyle(container);
			const marginLeftPx = parsePxValue(containerStyle.marginLeft) ?? 0;
			const textFrameStart = containerRect.left + marginLeftPx;
			const tabSequence = Array.from(tabs);
			for (const tab of tabs) {
				tab.style.display = 'inline-block';
				tab.style.minWidth = '0';
				tab.style.width = '0';
				tab.style.verticalAlign = 'baseline';

				const tabRect = tab.getBoundingClientRect();
				const currentX = Math.max(0, tabRect.left - textFrameStart);
				const targetStop = stops.find(
					(stop) => stop.style !== 'clear' && stop.positionPx > currentX + 0.5
				);
				let targetX =
					targetStop?.positionPx ??
					(Math.floor(currentX / DOCX_DEFAULT_TAB_INTERVAL_PX) + 1) * DOCX_DEFAULT_TAB_INTERVAL_PX;

				if (targetStop && (targetStop.style === 'right' || targetStop.style === 'center')) {
					const tabIndex = tabSequence.indexOf(tab);
					const nextTab = tabIndex >= 0 ? tabSequence[tabIndex + 1] : null;
					const measureRange = document.createRange();
					measureRange.setStartAfter(tab);
					if (nextTab && nextTab.parentNode === container) {
						measureRange.setEndBefore(nextTab);
					} else {
						measureRange.setEnd(container, container.childNodes.length);
					}
					const measured = measureRange.getBoundingClientRect();
					const textWidth = Math.max(0, measured.width);
					if (targetStop.style === 'center') {
						targetX = targetStop.positionPx - textWidth / 2;
					} else {
						targetX = targetStop.positionPx - textWidth;
					}
				}

				const width = Math.max(1, targetX - currentX);
				tab.style.width = `${width}px`;
				tab.style.minWidth = `${width}px`;
				tab.textContent = '\u00a0';
				applyDocxTabLeaderStyle(tab, targetStop?.leader ?? 'none');
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
		for (const chromeNode of section.querySelectorAll<HTMLElement>(
			':scope > [data-docx-page-chrome="true"]'
		)) {
			continuation.appendChild(chromeNode.cloneNode(true));
		}
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
				const lastNode = getLastMeaningfulNode(current);
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
			activeDocumentName = metadata?.display_name || metadata?.name || `${docId}.docx`;

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

			type DocxRenderFactory = ReturnType<typeof createRenderer>;
			type DocxOfficeDocument = {
				renderNode: (
					node: XmlNode,
					createElement: DocxRenderFactory,
					identifyNode: typeof identify
				) => unknown;
			};
			type DocxPartQuery = {
				children: () => { toArray: () => XmlNode[] };
			};
			type DocxPart = (selector: string) => DocxPartQuery;

			const officeDocument = (
				parsedDoc as typeof parsedDoc & { officeDocument?: DocxOfficeDocument }
			).officeDocument;
			let renderer: DocxRenderFactory;
			const renderExternalPart = (part: unknown, rootLocalName: 'hdr' | 'ftr') => {
				if (!officeDocument || typeof part !== 'function') return null;
				const root = (part as DocxPart)(`w\\:${rootLocalName}`);
				const nodes = root.children().toArray();
				return nodes.map((node) => officeDocument.renderNode(node, renderer, identify));
			};

			renderer = createRenderer(
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
				},
				{ renderExternalPart }
			);

			const renderedRoot = parsedDoc.render(renderer, identify);
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
			syncContradictionDecorations();
			scheduleRelatedScrollMarkerRefresh();
			scheduleParagraphExplanationConnectorRefresh();

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

	$: if (!shouldShowContradictionDecorations) {
		// Defensive: keep contradiction visuals fully off outside analysis tab.
		clearContradictionHighlights();
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

		const paddingAndIconsPx = Math.max(
			GLOBAL_MODEL_TRIGGER_EXTRA_PX,
			GLOBAL_MODEL_ITEM_CHECK_EXTRA_PX
		);
		return Math.max(GLOBAL_MODEL_MIN_WIDTH_PX, Math.ceil(longestLabelPx + paddingAndIconsPx));
	}

	onMount(() => {
		let llmCostTimer: ReturnType<typeof setInterval> | null = null;
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
			scheduleRelatedScrollMarkerRefresh();
		};
		const handleDocumentScroll = () => {
			scheduleContradictionScrollMarkerRefresh();
			scheduleParagraphExplanationConnectorRefresh();
			scheduleRelatedScrollMarkerRefresh();
		};
		const handleViewportResize = () => {
			refreshViewportMode();
			scheduleContradictionScrollMarkerRefresh();
			scheduleParagraphExplanationConnectorRefresh();
			scheduleRelatedScrollMarkerRefresh();
			setRightDrawerWidth(rightDrawerWidth);
		};
		const isEntityTokenElement = (value: EventTarget | null): HTMLElement | null => {
			if (!(value instanceof Element)) return null;
			const target = value.closest(
				'.docx-paragraph-explanation-entity-link, .docx-paragraph-explanation-entity-token'
			);
			return target instanceof HTMLElement ? target : null;
		};
		const handleEntityPointerOver = (event: PointerEvent) => {
			const token = isEntityTokenElement(event.target);
			if (!token) return;
			setHoveredParagraphExplanationEntityKey(token.dataset.entityKey ?? null);
		};
		const handleEntityPointerOut = (event: PointerEvent) => {
			const token = isEntityTokenElement(event.target);
			if (!token) return;
			const entityKey = token.dataset.entityKey ?? null;
			const relatedToken = isEntityTokenElement(event.relatedTarget);
			if (entityKey && relatedToken?.dataset.entityKey === entityKey) return;
			if (hoveredParagraphExplanationEntityKey === entityKey) {
				setHoveredParagraphExplanationEntityKey(null);
			}
		};

		document.addEventListener('selectionchange', handleDocumentSelectionChange);
		document.addEventListener('mouseup', handleDocumentSelectionChange);
		document.addEventListener('keyup', handleDocumentSelectionChange);
		document.addEventListener('mousedown', handleGlobalPointerDown, true);
		document.addEventListener('pointerover', handleEntityPointerOver, true);
		document.addEventListener('pointerout', handleEntityPointerOut, true);
		window.addEventListener('resize', handleViewportResize);
		documentScrollHost?.addEventListener('scroll', handleDocumentScroll, {
			passive: true
		});
		documentScrollHost?.addEventListener('wheel', handleParagraphExplanationShiftWheel, {
			passive: false
		});
		refreshViewportMode();
		setRightDrawerWidth(rightDrawerWidth);
		globalModelSelectWidthPx = measureGlobalModelSelectWidthPx();
		void refreshAccumulatedLlmCost();
		llmCostTimer = setInterval(() => {
			void refreshAccumulatedLlmCost();
		}, 5000);
		const fontSet = (document as Document & { fonts?: FontFaceSet }).fonts;
		if (fontSet) {
			void fontSet.ready.then(() => {
				globalModelSelectWidthPx = measureGlobalModelSelectWidthPx();
			});
		}

		if (typeof ResizeObserver !== 'undefined') {
			contradictionMarkerResizeObserver = new ResizeObserver(() => {
				scheduleContradictionScrollMarkerRefresh();
				scheduleParagraphExplanationConnectorRefresh();
				scheduleRelatedScrollMarkerRefresh();
			});
			if (documentScrollHost) contradictionMarkerResizeObserver.observe(documentScrollHost);
			if (viewer) contradictionMarkerResizeObserver.observe(viewer);
		}

		const unsubscribe = page.subscribe(($page) => {
			void openFromRoute($page.url.searchParams.get('id'));
		});
		scheduleContradictionScrollMarkerRefresh();
		scheduleRelatedScrollMarkerRefresh();

		return () => {
			renderToken += 1;
			if (relatedScrollMarkerFrame != null) {
				window.cancelAnimationFrame(relatedScrollMarkerFrame);
				relatedScrollMarkerFrame = null;
			}
			unsubscribe();
			document.removeEventListener('selectionchange', handleDocumentSelectionChange);
			document.removeEventListener('mouseup', handleDocumentSelectionChange);
			document.removeEventListener('keyup', handleDocumentSelectionChange);
			document.removeEventListener('mousedown', handleGlobalPointerDown, true);
			document.removeEventListener('pointerover', handleEntityPointerOver, true);
			document.removeEventListener('pointerout', handleEntityPointerOut, true);
			window.removeEventListener('resize', handleViewportResize);
			documentScrollHost?.removeEventListener('scroll', handleDocumentScroll);
			documentScrollHost?.removeEventListener('wheel', handleParagraphExplanationShiftWheel);
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
			if (paragraphExplanationCompressionTweenFrame != null) {
				window.cancelAnimationFrame(paragraphExplanationCompressionTweenFrame);
				paragraphExplanationCompressionTweenFrame = null;
			}
			if (llmCostTimer) {
				clearInterval(llmCostTimer);
				llmCostTimer = null;
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
			<div class="flex min-w-0 flex-1 items-center gap-2">
				<p class="shrink-0 text-[11px] text-gray-500">Document</p>
				<div class="min-w-0 truncate text-sm font-medium text-gray-800">
					{activeDocumentName || 'No document selected'}
				</div>
			</div>
			<!-- <div class="shrink-0">
				<Button
					variant="outline"
					size="sm"
					class="h-7 border-gray-200 bg-white px-2 text-[10px] text-gray-600 hover:border-gray-300 hover:bg-gray-100 hover:text-gray-800"
					disabled={!Boolean(activeDocumentId) || $loading || renderedPdfExporting}
					onclick={() => void downloadRenderedPdf()}
					title="Export the current system-rendered document as a PDF"
				>
					{renderedPdfExporting ? 'Preparing PDF...' : 'Download rendered PDF'}
				</Button>
			</div> -->
			<div class="shrink-0 flex items-center gap-3">
				<div
					class="text-[12px] font-medium text-gray-500"
					title="Total accumulated real LLM usage cost"
				>
					{llmCostLabel}
				</div>
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
							<Select.Item
								value={option.value}
								label={option.label}
								class="text-[10px] whitespace-nowrap"
							>
								{option.label}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
		</header>

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

			<!-- Temporarily hidden: Knowledge Graph related visual markers -->
			<!-- {#if activeRightPanelTab === 'related' && relatedScrollMarkers.length > 0}
				<div class="absolute top-2 right-1 bottom-2 z-20 w-2">
					{#each relatedScrollMarkers as marker (`related-panel-marker-${marker.paragraphId}`)}
						<span
							class={`docx-related-scroll-marker docx-related-scroll-marker--${marker.kind}`}
							style={`top: ${marker.topPercent}%;`}
							role="button"
							tabindex="0"
							aria-label={`Go to ${marker.kind} paragraph ${marker.paragraphId}`}
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
			{/if} -->

			{#if shouldShowContradictionDecorations && selectedContradictionEvidenceLink}
				<div
					class="pointer-events-none absolute inset-0 z-20 overflow-hidden"
					style={`--contradiction-a-color: #dc2626; --contradiction-b-color: ${selectedContradictionCategoryColor};`}
				>
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

			{#if shouldShowRelatedBridgeDecorations && paragraphExplanationConnectors.length > 0}
				<div class="pointer-events-none absolute inset-0 z-20 overflow-hidden">
					{#if paragraphExplanationPrimaryConnector}
						<span
							class="docx-paragraph-explanation-bracket docx-paragraph-explanation-bracket--interactive"
							style={`left: ${paragraphExplanationPrimaryConnector.leftPx}px; top: ${paragraphExplanationPrimaryConnector.topPx}px; height: ${Math.max(
								6,
								paragraphExplanationPrimaryConnector.bottomPx -
									paragraphExplanationPrimaryConnector.topPx
							)}px;`}
							role="button"
							tabindex="0"
							aria-label={`Go to related paragraph ${paragraphExplanationPrimaryConnector.paragraphId}`}
							on:click={() =>
								jumpToRelatedParagraphMarker(paragraphExplanationPrimaryConnector.paragraphId)}
							on:keydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									jumpToRelatedParagraphMarker(paragraphExplanationPrimaryConnector.paragraphId);
								}
							}}
						></span>
						<span
							class="docx-paragraph-explanation-cap"
							style={`left: ${paragraphExplanationPrimaryConnector.leftPx}px; top: ${paragraphExplanationPrimaryConnector.selectedCapTopPx}px; width: ${paragraphExplanationPrimaryConnector.selectedCapWidthPx}px;`}
						></span>
					{/if}
					{#each paragraphExplanationConnectors as connector, index (`connector-${index}`)}
						<span
							class="docx-paragraph-explanation-cap docx-paragraph-explanation-cap--interactive"
							style={`left: ${connector.leftPx}px; top: ${connector.relatedCapTopPx}px; width: ${connector.relatedCapWidthPx}px;`}
							role="button"
							tabindex="0"
							aria-label={`Go to related paragraph (${connector.relationLabel})`}
							on:click={() => jumpToRelatedParagraphMarker(connector.paragraphId)}
							on:keydown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									jumpToRelatedParagraphMarker(connector.paragraphId);
								}
							}}
						></span>
						<span
							class={`docx-paragraph-explanation-cap-label ${
								connector.relationKind === 'similarity'
									? 'docx-paragraph-explanation-cap-label--similarity'
									: 'docx-paragraph-explanation-cap-label--reference'
							}`}
							style={`left: ${connector.labelLeftPx}px; top: ${connector.relatedCapTopPx}px;`}
						>
							{connector.relationLabel}
						</span>
					{/each}
					{#each paragraphExplanationFolds as fold, index (`fold-${index}`)}
						<svg
							class="docx-paragraph-explanation-line-fold"
							style={`left: ${fold.leftPx}px; top: ${fold.topPx}px;`}
							viewBox="0 0 12 20"
							aria-hidden="true"
						>
							<path d="M6 1 L3 5 L9 9 L3 13 L6 19"></path>
						</svg>
					{/each}
					{#if paragraphExplanationCollapsedCards.length > 0}
						{#each paragraphExplanationCollapsedCards as card (`compressed-card-${card.paragraphId}`)}
							<div
								class="docx-paragraph-explanation-collapsed-card"
								style={`left: ${card.leftPx}px; top: ${card.topPx}px; width: ${card.widthPx}px;`}
							>
								{@html card.html}
							</div>
						{/each}
					{/if}
				</div>
			{/if}

			{#if shouldShowRelatedBridgeDecorations && paragraphExplanationScrollMarkers.length > 0}
				<div class="absolute top-2 right-1 bottom-2 z-20 w-2" on:mousedown={startManualScrollDrag}>
					{#each paragraphExplanationScrollMarkers as marker (`related-marker-${marker.paragraphId}`)}
						<span
							class={`docx-related-scroll-marker docx-related-scroll-marker--${marker.kind}`}
							style={`top: ${marker.topPercent}%;`}
							role="button"
							tabindex="0"
							aria-label={`Go to ${marker.kind} paragraph ${marker.paragraphId}`}
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
		<header
			class="flex items-center justify-between border-b border-gray-200/90 bg-white/90 px-4 py-2.5"
		>
			<div class="flex min-w-0 flex-1 items-center gap-2">
				<h2
					class="inline-flex min-w-0 flex-1 items-center gap-2 truncate text-sm font-semibold text-gray-700"
				>
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
							<ChatIcon className="h-4 w-4" strokeWidth={1.9} />
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
						<!-- <div
							class="flex h-7 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2"
							title="Switch contradiction analysis mode"
						>
							<label
								for="analysis-mode-kg-switch"
								class={`text-[10px] font-semibold ${contradictionGraphMode === 'without_kg' ? 'text-blue-700' : 'text-gray-500'}`}
							>
								No KG
							</label>
							<Switch
								id="analysis-mode-kg-switch"
								class="data-checked:bg-blue-600 dark:data-checked:bg-blue-500"
								checked={contradictionGraphMode === 'with_kg'}
								onCheckedChange={(checked) =>
									(contradictionGraphMode = checked ? 'with_kg' : 'without_kg')}
							/>
							<label
								for="analysis-mode-kg-switch"
								class={`text-[10px] font-semibold ${contradictionGraphMode === 'with_kg' ? 'text-blue-700' : 'text-gray-500'}`}
							>
								KG
							</label>
						</div> -->
						<Button
							variant="outline"
							size="sm"
							class="h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
							disabled={!Boolean(activeDocumentId) || contradictionLoading || $loading}
							onclick={() => void loadSavedContradictions()}
						>
							Saved
						</Button>
						<Button
							variant="outline"
							size="sm"
							class="h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
							disabled={!Boolean(activeDocumentId) ||
								contradictionLoading ||
								$loading ||
								backendGraphLoading}
							onclick={() => void searchContradictionsWithLlm()}
						>
							Search
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
						<Button
							variant="outline"
							size="sm"
							class="h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
							disabled={!$selectedParagraph || simplifyLoading || fixContradictionLoading}
							onclick={() => void runSimplify({ openRevisionsPanel: false })}
						>
							{simplifyLoading ? 'Simplifying...' : 'Simplify'}
						</Button>
					</div>
				{:else if activeRightPanelTab === 'assistant'}
					<div class="flex shrink-0 items-center gap-1.5">
						<Select.Root type="single" bind:value={assistantProvider}>
							<Select.Trigger
								size="sm"
								class="h-7 shrink-0 border-gray-200 bg-white px-1.5 text-[10px] text-gray-600"
								style="width: 92px;"
								title="Assistant provider"
							>
								{PROVIDER_OPTIONS.find((option) => option.value === assistantProvider)?.label ??
									assistantProvider}
							</Select.Trigger>
							<Select.Content class="min-w-0" style="width: 92px; min-width: 0;">
								{#each PROVIDER_OPTIONS as option}
									<Select.Item
										value={option.value}
										label={option.label}
										class="text-[10px] whitespace-nowrap"
									>
										{option.label}
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>

						<div
							class="flex h-7 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2"
						>
							<label for="" class="text-[10px] font-semibold text-gray-600"> Parapraph </label>
							<Switch
								id="assistant-header-full-contract-scope"
								class="data-checked:bg-blue-600 dark:data-checked:bg-blue-500"
								checked={assistantScope === 'full_contract'}
								onCheckedChange={(checked) =>
									(assistantScope = checked ? 'full_contract' : 'selected')}
							/>
							<label
								for="assistant-header-full-contract-scope"
								class="text-[10px] font-semibold text-gray-600"
							>
								Full contract
							</label>
						</div>
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
				{contradictionLoading}
				{backendGraphLoading}
				{hasTriggeredContradictionCheck}
				{contradictionError}
				{contradictionCount}
				{contradictionSummaryItems}
				{relatedProcessingSteps}
				{revisionProcessingSteps}
				{selectedContradictionResult}
				{selectedContradictionEvidence}
				bind:assistantInput
				bind:assistantThread
				{assistantMessages}
				{assistantLoading}
				{assistantError}
				contradictionQuickActionFreeLabel={QUICK_ACTION_WHY_CONTRADICTION_FREE}
				contradictionQuickActionAiLabel={QUICK_ACTION_WHY_CONTRADICTION_AI}
				contradictionTaxonomyOrder={CONTRADICTION_TAXONOMY_ORDER}
				contradictionTaxonomyLabels={CONTRADICTION_TAXONOMY_LABELS}
				contradictionTaxonomyColors={CONTRADICTION_TAXONOMY_COLORS}
				contradictionClaimSideColors={CONTRADICTION_CLAIM_SIDE_COLORS}
				onSuggestContradictionFix={suggestContradictionFixFromChat}
				onAcceptFixSuggestion={acceptFixSuggestionFromChat}
				onRunContradictionQuickAction={(prompt) => void askQuickAction(prompt)}
				onSubmitAssistantQuestion={submitContradictionAssistantQuestion}
				onHandleAssistantInputKeydown={handleContradictionAssistantInputKeydown}
				rewriteBusy={simplifyLoading || fixContradictionLoading}
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
				{selectedChangeLog}
				{simplifyResult}
				{simplifyError}
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
				{backendGraphLoading}
				{relatedProcessingSteps}
				{selectedRelatedParagraphs}
				{nodeEditStateById}
				onFocusNodeFromPanel={jumpToNodeWithoutSelecting}
			/>
		{:else if activeRightPanelTab === 'paragraph_explanation'}
			<RightPanelParagraphExplanation
				selectedParagraph={$selectedParagraph}
				loading={paragraphExplanationLoading}
				error={paragraphExplanationError}
				explanationShort={paragraphExplanationShort}
				explanationDetailed={paragraphExplanationDetailed}
				explanationEntities={paragraphExplanationEntities}
				simplifyResult={latestRewriteSource === 'simplify' ? simplifyResult : null}
				simplifyError={latestRewriteSource === 'simplify' ? simplifyError : null}
				rewriteSource={latestRewriteSource === 'simplify' ? 'simplify' : null}
				rewriteBusy={simplifyLoading || fixContradictionLoading}
				onReplaceRewrite={replaceSelectionWithSimplifiedText}
				onCopyRewrite={copySimplifiedSnippet}
				onRejectRewrite={cancelSimplifyResult}
				onFocusParagraph={focusNodeFromPanel}
			/>
		{:else}
			<RightPanelAssistant
				bind:assistantInput
				bind:assistantThread
				quickActionSuggestions={ASSISTANT_CHAT_SUGGESTIONS}
				{assistantMessages}
				{assistantLoading}
				{assistantError}
				contradictionTaxonomyOrder={CONTRADICTION_TAXONOMY_ORDER}
				contradictionTaxonomyLabels={CONTRADICTION_TAXONOMY_LABELS}
				contradictionTaxonomyColors={CONTRADICTION_TAXONOMY_COLORS}
				contradictionClaimSideColors={CONTRADICTION_CLAIM_SIDE_COLORS}
				onQuickActionSuggestionClick={handleAssistantQuickActionSuggestion}
				{onSuggestedQuestionClick}
				onFocusNodeFromPanel={focusNodeFromPanel}
				onAcceptFixSuggestion={acceptFixSuggestionFromChat}
				onSubmitAssistantQuestion={submitAssistantQuestion}
				onHandleAssistantInputKeydown={handleAssistantInputKeydown}
				rewriteBusy={simplifyLoading || fixContradictionLoading}
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
				<div
					class={`mb-3 flex w-full items-center ${sidebarLabelsPinned ? 'justify-between' : 'justify-center'}`}
				>
					{#if sidebarLabelsPinned}
						<span class="ml-1 text-[17px] font-semibold tracking-wide text-gray-600"
							>{TOOL_BRAND_SHORT_NAME}</span
						>
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
								<path
									d="M5 6v12M8 12h10m0 0-3-3m3 3-3 3"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
							{:else}
								<path
									d="M19 6v12M16 12H6m0 0 3-3m-3 3 3 3"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>
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
									<ChatIcon className="h-[17px] w-[17px]" />
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
												<ChatIcon className="h-[17px] w-[17px]" />
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

	{#if llmEstimateToastOpen && llmEstimateToast}
		<div class="pointer-events-none fixed right-5 bottom-5 z-[120]">
			<div
				class="pointer-events-auto w-[min(92vw,420px)] rounded-xl border border-blue-100 bg-white/98 p-4 shadow-[0_14px_34px_rgba(30,64,175,0.2)] backdrop-blur"
			>
				<p class="text-sm font-semibold text-slate-900">Confirm LLM request</p>
				<p class="mt-1 text-xs text-slate-600">
					Estimated cost: <span class="font-semibold text-blue-700"
						>{llmEstimateToast.estimatedCostUsdFormatted}</span
					>
					({llmEstimateToast.estimatedTotalTokens} tokens)
				</p>
				<p class="mt-1 text-[11px] text-slate-500">
					{llmEstimateToast.provider} · {llmEstimateToast.model}
				</p>
				<div class="mt-3 flex items-center justify-end gap-2">
					<Button
						variant="outline"
						size="sm"
						class="border-blue-200 text-blue-700 hover:bg-blue-50"
						onclick={() => resolveLlmEstimateToast(false)}
					>
						Cancel
					</Button>
					<Button
						size="sm"
						class="bg-blue-600 text-white hover:bg-blue-700"
						onclick={() => resolveLlmEstimateToast(true)}
					>
						Send
					</Button>
				</div>
			</div>
		</div>
	{/if}
</main>
