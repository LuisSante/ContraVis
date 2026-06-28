'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { DocxPageHeader } from './DocxPageHeader';
import { DocumentViewer } from './DocumentViewer';
import { RightPanel } from './RightPanel';
import { ToolRail } from './ToolRail';
import { RightPanelAnalysis } from './RightPanelAnalysis';
import { RightPanelAssistant } from './RightPanelAssistant';
import { ContradictionChatPanel } from './ContradictionChatPanel';
import { LlmEstimateDialog } from './LlmEstimateDialog';
import { RightPanelParagraphExplanation } from './RightPanelParagraphExplanation';
import { RightPanelRelated } from './RightPanelRelated';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ProcessingIndicator, type ProcessingStep } from '@/components/common/ProcessingIndicator';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { useRightDrawer } from '@/features/docx/hooks/useRightDrawer';
import { useLlmEstimate } from '@/features/docx/hooks/useLlmEstimate';
import { useDocumentEntityHighlights } from '@/features/docx/hooks/useDocumentEntityHighlights';
import { useRelatedBadges } from '@/features/docx/hooks/useRelatedBadges';
import { useDocumentViewer } from '@/features/docx/hooks/useDocumentViewer';
import { useContradictionAnalysis } from '@/features/docx/hooks/useContradictionAnalysis';
import { useContradictionDecorations } from '@/features/docx/hooks/useContradictionDecorations';
import { useAssistantChat } from '@/features/docx/hooks/useAssistantChat';
import { useParagraphExplanation } from '@/features/docx/hooks/useParagraphExplanation';
import { useRelatedGraph } from '@/features/docx/hooks/useRelatedGraph';
import { useDocumentStore } from '@/stores/document';
import { fetchLlmTotalCost } from '@/services/llm';
import {
	PROVIDER_OPTIONS,
	QUICK_ACTIONS,
	QUICK_ACTION_CONTRADICTION_RISKS,
	QUICK_ACTION_WHY_CONTRADICTION_AI,
	QUICK_ACTION_WHY_CONTRADICTION_FREE,
	RIGHT_DRAWER_KEYBOARD_STEP,
} from '@/constants/docx-viewer';
import { buildBridgeRelatedParagraphs } from '@/features/docx/utils/related-bridge';
import type { AssistantProvider } from '@/types/document';

interface DocxViewerProps {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const ACTION_BTN =
	'h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100';

// Preguntas rápidas iniciales del Contract Chat Assistant (sin las de contradicción).
const ASSISTANT_CHAT_SUGGESTIONS = QUICK_ACTIONS.filter(
	(action) =>
		action !== QUICK_ACTION_WHY_CONTRADICTION_FREE && action !== QUICK_ACTION_WHY_CONTRADICTION_AI
);

// Pasos mostrados mientras se forma el grafo de relaciones (bloqueo inicial).
const GRAPH_PROCESSING_STEPS: ProcessingStep[] = [
	{ label: 'Scanning document structure', active: true },
	{ label: 'Analyzing paragraph relations', active: false },
	{ label: 'Searching linked context', active: false },
];

/**
 * Orquestador (cliente) del visor docx: render del documento, contradicciones
 * (panel + decoraciones + rail/link), chat del asistente y explicación de
 * párrafo. Layout fiel al original: contenido + panel deslizante + rail de iconos.
 */
export function DocxViewer({ searchParams }: DocxViewerProps) {
	const params = use(searchParams);
	const id = typeof params.id === 'string' ? params.id : null;
	const docId = id ?? '';

	const drawer = useRightDrawer();
	const llmEstimate = useLlmEstimate();
	// Al confirmar (Ctrl/Cmd+Enter) una edición de párrafo se recalcula el grafo.
	const onParagraphCommitRef = useRef<(() => void) | null>(null);
	const viewer = useDocumentViewer(id, { onParagraphCommitRef });
	const { paragraphElementById, nodeEditStateById } = viewer.maps;

	const selectedParagraph = useDocumentStore((s) => s.selectedParagraph);
	const setSelectedParagraph = useDocumentStore((s) => s.setSelectedParagraph);

	const [model, setModel] = useState('gpt-4.1');
	const [costLabel, setCostLabel] = useState<string | null>(null);

	const related = useRelatedGraph({ docId, maps: viewer.maps });

	const contradiction = useContradictionAnalysis({
		docId,
		nodeEditStateById: nodeEditStateById.current,
		backendEdges: related.edges,
		model,
		confirmLlmEstimate: llmEstimate.confirm,
	});
	const explanation = useParagraphExplanation({
		docId,
		nodeEditStateById: nodeEditStateById.current,
	});

	const analysisActive = drawer.isOpen && drawer.activeTab === 'analysis';
	const explanationActive = drawer.isOpen && drawer.activeTab === 'paragraph_explanation';
	const relatedActive = drawer.isOpen && drawer.activeTab === 'related';

	// Chat compartido: un único hilo alimenta el Contract Chat Assistant y el chat
	// embebido en Contradiction Analysis (quick-actions + fix estructurado).
	const assistant = useAssistantChat({
		docId,
		nodeEditStateById: nodeEditStateById.current,
		getViewerElement: () => viewer.containerRef.current,
		paragraphElementById: paragraphElementById.current,
		contradictionResultsByParagraphId: contradiction.resultsByParagraphId,
		selectedRelatedParagraphs: related.selectedRelatedParagraphs,
		model,
		confirmLlmEstimate: llmEstimate.confirm,
	});

	// Puente de relacionados: activo en Related y en Paragraph Explanation. La lista
	// difiere por pestaña (todos vs la cola tras el top-5 que ya muestra el panel).
	const relatedBridgeActive = relatedActive || explanationActive;
	const relatedBridgeParagraphs = useMemo(
		() =>
			relatedActive
				? related.selectedRelatedParagraphs
				: explanationActive
					? buildBridgeRelatedParagraphs(related.selectedRelatedParagraphs, 'paragraph_explanation')
					: [],
		[relatedActive, explanationActive, related.selectedRelatedParagraphs]
	);

	// Resaltado de entidades en el cuerpo del documento: de Paragraph Explanation o
	// del why/risk de contradicción (toggle on). Se aplican al párrafo seleccionado
	// y a sus relacionados.
	const documentEntities = explanationActive
		? explanation.entities
		: analysisActive
			? assistant.contradictionEntities
			: [];
	const entityTargetIds = useMemo(
		() =>
			selectedParagraph
				? Array.from(
						new Set([selectedParagraph.id, ...relatedBridgeParagraphs.map((item) => item.node.id)])
					)
				: [],
		[selectedParagraph, relatedBridgeParagraphs]
	);
	useDocumentEntityHighlights({
		active: documentEntities.length > 0 && (explanationActive || analysisActive),
		renderEpoch: viewer.renderEpoch,
		paragraphElementById: paragraphElementById.current,
		targetIds: entityTargetIds,
		entities: documentEntities,
	});

	// Badges de relación: énfasis + dirección (reference/similarity) al seleccionar
	// en la pestaña Related.
	const relatedFocusOn = relatedActive && selectedParagraph != null;
	useRelatedBadges({
		active: relatedFocusOn,
		paragraphRelationHostById: viewer.maps.paragraphRelationHostById.current,
		selectedParagraphId: selectedParagraph?.id ?? null,
		related: related.selectedRelatedParagraphs,
	});

	useContradictionDecorations({
		active: analysisActive,
		renderEpoch: viewer.renderEpoch,
		resultsByParagraphId: contradiction.resultsByParagraphId,
		paragraphElementById: paragraphElementById.current,
		selectedParagraphId: selectedParagraph?.id ?? null,
	});

	// Coste acumulado de LLM (header).
	useEffect(() => {
		let active = true;
		fetchLlmTotalCost()
			.then((cost) => {
				if (active) setCostLabel(`Cost: ${cost.totalCostUsdFormatted} $`);
			})
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);

	// El grafo de relaciones se forma en cuanto el documento termina de renderizar
	// (no al abrir Related). Mientras se forma, se bloquea la navegación (abajo).
	const { computed: relatedComputed, loading: relatedLoading, recompute: recomputeRelated } = related;
	useEffect(() => {
		if (id && viewer.renderEpoch > 0 && !relatedComputed && !relatedLoading) {
			void recomputeRelated();
		}
	}, [id, viewer.renderEpoch, relatedComputed, relatedLoading, recomputeRelated]);

	// Confirmar una edición de párrafo (Ctrl/Cmd+Enter) recalcula el grafo.
	useEffect(() => {
		onParagraphCommitRef.current = () => void recomputeRelated();
		return () => {
			onParagraphCommitRef.current = null;
		};
	}, [recomputeRelated]);

	// Bloqueo global mientras se forma/recalcula el grafo: documento atenuado + sin
	// navegación + animación de pasos en el panel. (Se libera si el render falla.)
	const graphBlocking =
		id != null && (!relatedComputed || relatedLoading) && viewer.status !== 'error';

	// Las contradicciones se cargan solo bajo demanda: "Saved" (guardadas) o
	// "Search" (búsqueda con LLM). No se auto-cargan al formarse el grafo.

	// Pide la explicación al abrir su tab con un párrafo seleccionado aún no explicado.
	const selectedParagraphId = selectedParagraph?.id ?? null;
	const {
		loadedForParagraphId: explanationLoadedId,
		loading: explanationLoading,
		submit: submitExplanation,
	} = explanation;
	useEffect(() => {
		if (
			explanationActive &&
			selectedParagraphId &&
			explanationLoadedId !== selectedParagraphId &&
			!explanationLoading
		) {
			void submitExplanation();
		}
	}, [explanationActive, selectedParagraphId, explanationLoadedId, explanationLoading, submitExplanation]);

	// Resize del drawer derecho por arrastre del separador vertical.
	const startDrawerResize = (event: React.MouseEvent) => {
		if (window.innerWidth < 1024 || !drawer.isOpen) return;
		event.preventDefault();
		document.body.style.userSelect = 'none';
		const sidebarWidth = drawer.sidebarWidth;
		const onMove = (moveEvent: MouseEvent) => {
			drawer.setWidth(window.innerWidth - sidebarWidth - moveEvent.clientX);
		};
		const onUp = () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			document.body.style.userSelect = '';
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	};

	const handleDrawerResizeKeydown = (event: React.KeyboardEvent) => {
		if (!drawer.isOpen) return;
		if (event.key === 'ArrowRight') {
			event.preventDefault();
			drawer.setWidth(drawer.width + RIGHT_DRAWER_KEYBOARD_STEP);
		} else if (event.key === 'ArrowLeft') {
			event.preventDefault();
			drawer.setWidth(drawer.width - RIGHT_DRAWER_KEYBOARD_STEP);
		}
	};

	const onFocusNodeFromPanel = (nodeId: string, emphasize = false) => {
		const node = useDocumentStore.getState().paragraphs.find((n) => n.id === nodeId) ?? null;
		setSelectedParagraph(node);
		const element = paragraphElementById.current.get(nodeId);
		element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
		if (emphasize && element) flashElement(element);
	};

	const onFocusEvidenceSnippet = (paragraphId: string, role: 'a' | 'b') => {
		const mark = document.querySelector<HTMLElement>(
			`mark.docx-contradiction-snippet[data-contradiction-owner="${paragraphId}"][data-contradiction-role="${role}"]`
		);
		if (mark) {
			mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
			flashElement(mark);
		} else {
			onFocusNodeFromPanel(paragraphId, true);
		}
	};

	if (!id) {
		return (
			<div className="flex min-h-screen items-center justify-center">
				<p className="text-muted-foreground text-sm">
					Falta el parámetro <code>id</code> del documento.
				</p>
			</div>
		);
	}

	const leftWidth = `calc(100% - ${drawer.sidebarWidth + (drawer.isOpen ? drawer.width : 0)}px)`;

	const headerActions =
		drawer.activeTab === 'analysis' ? (
			<div className="flex shrink-0 items-center gap-1.5">
				<Button
					variant="outline"
					size="sm"
					className={ACTION_BTN}
					disabled={contradiction.loading || graphBlocking}
					onClick={() => void contradiction.loadSavedContradictions()}
				>
					Saved
				</Button>
				<Button
					variant="outline"
					size="sm"
					className={ACTION_BTN}
					disabled={contradiction.loading || relatedLoading || graphBlocking}
					title="Search contradictions with LLM"
					onClick={() => void contradiction.searchContradictions()}
				>
					Search
				</Button>
			</div>
		) : drawer.activeTab === 'paragraph_explanation' ? (
			<div className="flex shrink-0 items-center gap-1.5">
				<Button
					variant="outline"
					size="sm"
					className={ACTION_BTN}
					disabled={!selectedParagraph || explanation.loading}
					onClick={() => void explanation.submit()}
				>
					Explain paragraph
				</Button>
				<Button variant="outline" size="sm" className={ACTION_BTN} disabled title="Simplify — próximamente">
					Simplify
				</Button>
			</div>
		) : drawer.activeTab === 'assistant' ? (
			<div className="flex shrink-0 items-center gap-1.5">
				<Select
					value={assistant.provider}
					onValueChange={(value) => assistant.setProvider(value as AssistantProvider)}
				>
					<SelectTrigger
						size="sm"
						className="h-7 w-[92px] shrink-0 border-gray-200 bg-white px-1.5 text-[10px] text-gray-600"
						title="Assistant provider"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="min-w-0">
						{PROVIDER_OPTIONS.map((option) => (
							<SelectItem
								key={option.value}
								value={option.value}
								className="text-[10px] whitespace-nowrap"
							>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<div className="flex h-7 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2">
					<span className="text-[10px] font-semibold text-gray-600">Paragraph</span>
					<Switch
						className="data-[state=checked]:bg-blue-600"
						checked={assistant.scope === 'full_contract'}
						onCheckedChange={(checked) => assistant.setScope(checked ? 'full_contract' : 'selected')}
					/>
					<span className="text-[10px] font-semibold text-gray-600">Full contract</span>
				</div>
			</div>
		) : null;

	return (
		<main
			className={`relative flex h-screen w-screen overflow-hidden bg-gray-100 font-sans ${
				relatedActive ? 'related-badges-on' : 'related-badges-off'
			} ${relatedFocusOn ? 'related-focus-on' : ''}`}
		>
			<div className="relative flex min-w-0 flex-col border-r border-gray-300" style={{ width: leftWidth }}>
				<DocxPageHeader
					documentName={viewer.documentName}
					costLabel={costLabel}
					model={model}
					onModelChange={setModel}
					modelDisabled={contradiction.loading || explanation.loading}
				/>
				<DocumentViewer
					containerRef={viewer.containerRef}
					status={viewer.status}
					dimmed={graphBlocking}
					contradictionActive={analysisActive}
					renderEpoch={viewer.renderEpoch}
					resultsByParagraphId={contradiction.resultsByParagraphId}
					paragraphElementById={paragraphElementById.current}
					selectedParagraphId={selectedParagraphId}
					categoryColor={contradiction.selectedContradictionCategoryColor}
					onMarkerClick={(paragraphId) => onFocusNodeFromPanel(paragraphId, true)}
						relatedBridgeActive={relatedBridgeActive}
						selectedParagraph={selectedParagraph}
						relatedBridgeParagraphs={relatedBridgeParagraphs}
				/>
			</div>

			<RightPanel
				activeTab={drawer.activeTab}
				isOpen={drawer.isOpen}
				width={drawer.width}
				sidebarWidth={drawer.sidebarWidth}
				headerActions={graphBlocking ? null : headerActions}
				onClose={drawer.close}
				closeDisabled={graphBlocking}
			>
				{graphBlocking && (
					<div className="p-3">
						<ProcessingIndicator steps={GRAPH_PROCESSING_STEPS} />
					</div>
				)}
				{!graphBlocking && drawer.activeTab === 'analysis' && (
					<RightPanelAnalysis
						selectedParagraph={selectedParagraph}
						contradictionLoading={contradiction.loading}
						hasTriggeredContradictionCheck={contradiction.hasTriggered}
						contradictionError={contradiction.error}
						contradictionCount={contradiction.contradictionCount}
						contradictionSummaryItems={contradiction.summaryItems}
						selectedContradictionResult={contradiction.selectedContradictionResult}
						selectedContradictionEvidence={contradiction.selectedContradictionEvidence}
						onFocusEvidenceSnippet={onFocusEvidenceSnippet}
						onFocusNodeFromPanel={onFocusNodeFromPanel}
						chatSlot={
							<ContradictionChatPanel
								messages={assistant.messages}
								input={assistant.input}
								loading={assistant.loading}
								error={assistant.error}
								rewriteBusy={assistant.rewriteBusy}
								entityHighlightsEnabled={assistant.entityHighlightsEnabled}
								onInputChange={assistant.setInput}
								onSubmit={() => void assistant.submitContradictionQuestion()}
								onKeydown={assistant.handleContradictionKeydown}
								onWhy={() => void assistant.askQuickAction(QUICK_ACTION_WHY_CONTRADICTION_AI)}
								onRisks={() => void assistant.askQuickAction(QUICK_ACTION_CONTRADICTION_RISKS)}
								onSuggestFix={() => void assistant.suggestContradictionFix()}
								onToggleEntityHighlights={assistant.toggleEntityHighlights}
								onAcceptFixSuggestion={assistant.acceptFixSuggestion}
								onSuggestedQuestionClick={(question) => void assistant.askQuickAction(question)}
								onFocusNodeFromPanel={onFocusNodeFromPanel}
							/>
						}
					/>
				)}
				{!graphBlocking && drawer.activeTab === 'assistant' && (
					<RightPanelAssistant
						messages={assistant.messages}
						input={assistant.input}
						loading={assistant.loading}
						error={assistant.error}
						entityHighlightsEnabled={assistant.entityHighlightsEnabled}
						rewriteBusy={assistant.rewriteBusy}
						onInputChange={assistant.setInput}
						onSubmit={() => void assistant.submit()}
						onKeydown={assistant.handleKeydown}
						onSuggestedQuestionClick={(question) => void assistant.submit(question)}
						onFocusNodeFromPanel={onFocusNodeFromPanel}
						onToggleEntityHighlights={assistant.toggleEntityHighlights}
						onAcceptFixSuggestion={assistant.acceptFixSuggestion}
						initialSuggestions={ASSISTANT_CHAT_SUGGESTIONS}
						onInitialSuggestionClick={(question) => void assistant.submit(question)}
					/>
				)}
				{!graphBlocking && drawer.activeTab === 'paragraph_explanation' && (
					<RightPanelParagraphExplanation
						selectedParagraph={selectedParagraph}
						loading={explanation.loading}
						error={explanation.error}
						explanationShort={explanation.short}
						explanationDetailed={explanation.detailed}
						explanationEntities={explanation.entities}
						onFocusParagraph={(paragraphId) => onFocusNodeFromPanel(paragraphId, true)}
					/>
				)}
				{!graphBlocking && drawer.activeTab === 'related' && (
					<RightPanelRelated
						selectedParagraph={selectedParagraph}
						loading={related.loading}
						selectedRelatedParagraphs={related.selectedRelatedParagraphs}
						nodeEditStateById={nodeEditStateById.current}
						onFocusNodeFromPanel={onFocusNodeFromPanel}
					/>
				)}
			</RightPanel>

			{drawer.isOpen && !graphBlocking && (
				<div
					role="separator"
					aria-orientation="vertical"
					aria-label="Resize side panel"
					tabIndex={0}
					className="absolute top-0 bottom-0 z-50 w-1 cursor-col-resize bg-gray-200/80 transition hover:bg-teal-300 focus:bg-teal-400 focus:outline-none"
					style={{ right: drawer.sidebarWidth + drawer.width }}
					onMouseDown={startDrawerResize}
					onKeyDown={handleDrawerResizeKeydown}
				>
					<span className="pointer-events-none absolute top-1/2 left-1/2 h-10 w-[2px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-400/70" />
				</div>
			)}

			<ToolRail
				width={drawer.sidebarWidth}
				labelsPinned={drawer.labelsPinned}
				activeTab={drawer.activeTab}
				isOpen={drawer.isOpen}
				disabled={graphBlocking}
				onSelectTool={drawer.selectTool}
				onToggleLabels={drawer.toggleLabels}
			/>

			<LlmEstimateDialog
				estimate={llmEstimate.estimate}
				isOpen={llmEstimate.isOpen}
				onResolve={llmEstimate.resolve}
			/>
		</main>
	);
}

/** Parpadeo breve para llamar la atención sobre un elemento al navegar. */
function flashElement(element: HTMLElement) {
	element.classList.remove('docx-citation-flash');
	// Forzar reflow para reiniciar la animación.
	void element.offsetWidth;
	element.classList.add('docx-citation-flash');
	window.setTimeout(() => element.classList.remove('docx-citation-flash'), 1300);
}
