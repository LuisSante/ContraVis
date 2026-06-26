'use client';

import { use, useEffect, useState } from 'react';
import { DocxPageHeader } from './DocxPageHeader';
import { DocumentViewer } from './DocumentViewer';
import { RightPanel } from './RightPanel';
import { ToolRail } from './ToolRail';
import { RightPanelAnalysis } from './RightPanelAnalysis';
import { RightPanelAssistant } from './RightPanelAssistant';
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
import { useDocumentViewer } from '@/features/docx/hooks/useDocumentViewer';
import { useContradictionAnalysis } from '@/features/docx/hooks/useContradictionAnalysis';
import { useContradictionDecorations } from '@/features/docx/hooks/useContradictionDecorations';
import { useAssistantChat } from '@/features/docx/hooks/useAssistantChat';
import { useParagraphExplanation } from '@/features/docx/hooks/useParagraphExplanation';
import { useRelatedGraph } from '@/features/docx/hooks/useRelatedGraph';
import { useDocumentStore } from '@/stores/document';
import { fetchLlmTotalCost } from '@/services/llm';
import { PROVIDER_OPTIONS } from '@/constants/docx-viewer';
import type { AssistantProvider } from '@/types/document';

interface DocxViewerProps {
	searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

const ACTION_BTN =
	'h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100';

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
	const viewer = useDocumentViewer(id);
	const { paragraphElementById, nodeEditStateById } = viewer.maps;

	const selectedParagraph = useDocumentStore((s) => s.selectedParagraph);
	const setSelectedParagraph = useDocumentStore((s) => s.setSelectedParagraph);

	const [model, setModel] = useState('gpt-4.1');
	const [costLabel, setCostLabel] = useState<string | null>(null);

	const contradiction = useContradictionAnalysis({
		docId,
		nodeEditStateById: nodeEditStateById.current,
	});
	const assistant = useAssistantChat({ docId, nodeEditStateById: nodeEditStateById.current });
	const explanation = useParagraphExplanation({
		docId,
		nodeEditStateById: nodeEditStateById.current,
	});

	const analysisActive = drawer.isOpen && drawer.activeTab === 'analysis';
	const explanationActive = drawer.isOpen && drawer.activeTab === 'paragraph_explanation';
	const relatedActive = drawer.isOpen && drawer.activeTab === 'related';

	const related = useRelatedGraph({ docId, maps: viewer.maps });

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

	// Bloqueo global desde que se selecciona el documento hasta que el grafo está
	// formado: documento atenuado + sin navegación + animación de pasos en el panel.
	// (Se libera también si el render falla, para no bloquear indefinidamente.)
	const graphBlocking = id != null && !relatedComputed && viewer.status !== 'error';

	// Carga las contradicciones guardadas cuando el grafo ya está formado.
	const { hasTriggered, loadSavedContradictions } = contradiction;
	useEffect(() => {
		if (id && analysisActive && relatedComputed && !hasTriggered) {
			void loadSavedContradictions();
		}
	}, [id, analysisActive, relatedComputed, hasTriggered, loadSavedContradictions]);

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
					disabled={contradiction.loading}
					onClick={() => void contradiction.loadSavedContradictions()}
				>
					Saved
				</Button>
				<Button
					variant="outline"
					size="sm"
					className={ACTION_BTN}
					disabled
					title="Búsqueda con LLM — próximamente"
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
			}`}
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
					/>
				)}
				{!graphBlocking && drawer.activeTab === 'assistant' && (
					<RightPanelAssistant
						messages={assistant.messages}
						input={assistant.input}
						loading={assistant.loading}
						error={assistant.error}
						onInputChange={assistant.setInput}
						onSubmit={() => void assistant.submit()}
						onKeydown={assistant.handleKeydown}
						onSuggestedQuestionClick={(question) => void assistant.submit(question)}
						onFocusNodeFromPanel={onFocusNodeFromPanel}
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

			<ToolRail
				width={drawer.sidebarWidth}
				labelsPinned={drawer.labelsPinned}
				activeTab={drawer.activeTab}
				isOpen={drawer.isOpen}
				disabled={graphBlocking}
				onSelectTool={drawer.selectTool}
				onToggleLabels={drawer.toggleLabels}
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
