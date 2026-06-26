'use client';

import { useRef, type CSSProperties, type RefObject } from 'react';
import type { DocumentViewerStatus } from '@/features/docx/hooks/useDocumentViewer';
import { useContradictionScrollMarkers } from '@/features/docx/hooks/useContradictionScrollMarkers';
import type { ContradictionParagraphResult } from '@/types/document';

interface DocumentViewerProps {
	containerRef: RefObject<HTMLDivElement | null>;
	status: DocumentViewerStatus;
	/** Atenúa y desactiva el documento mientras se forma el grafo. */
	dimmed?: boolean;
	/** Visualización de contradicciones (rail + link A↔B). */
	contradictionActive: boolean;
	renderEpoch: number;
	resultsByParagraphId: Map<string, ContradictionParagraphResult>;
	paragraphElementById: Map<string, HTMLElement>;
	selectedParagraphId: string | null;
	categoryColor: string;
	onMarkerClick: (paragraphId: string) => void;
}

/**
 * Área central del visor: scroll-host con el DOM renderizado por docx4js
 * (gestionado por ref) + las capas absolutas de visualización de contradicciones
 * (rail de marcadores y link de evidencia A↔B).
 */
export function DocumentViewer({
	containerRef,
	status,
	dimmed,
	contradictionActive,
	renderEpoch,
	resultsByParagraphId,
	paragraphElementById,
	selectedParagraphId,
	categoryColor,
	onMarkerClick,
}: DocumentViewerProps) {
	const scrollHostRef = useRef<HTMLElement>(null);

	const { markers, link } = useContradictionScrollMarkers({
		active: contradictionActive,
		renderEpoch,
		scrollHostRef,
		paragraphElementById,
		resultsByParagraphId,
		selectedParagraphId,
	});

	const linkVars = {
		'--contradiction-a-color': categoryColor,
		'--contradiction-b-color': categoryColor,
	} as CSSProperties;

	return (
		<div className="relative flex min-h-0 flex-1">
			<section
				ref={scrollHostRef}
				inert={dimmed || undefined}
				className={`flex min-h-0 flex-1 flex-col items-center overflow-auto px-2 py-4 shadow-inner transition-opacity duration-300 ${
					dimmed ? 'pointer-events-none opacity-60 select-none' : ''
				}`}
			>
				{status === 'error' && (
					<p className="text-destructive py-4 text-center text-sm">
						No se pudo renderizar el documento.
					</p>
				)}
				{/* Contenedor del documento renderizado (DOM imperativo de docx4js). */}
				<div ref={containerRef} className="docx-viewer-root min-h-full w-full" />
			</section>

			{contradictionActive && markers.length > 0 && (
				<div className="absolute top-2 right-1 bottom-2 z-20 w-2">
					{markers.map((marker) => (
						<span
							key={marker.paragraphId}
							className={`docx-contradiction-scroll-marker docx-contradiction-scroll-marker--${marker.confidenceBand}`}
							style={{ top: `${marker.topPercent}%` }}
							role="button"
							tabIndex={0}
							aria-label={`Go to contradiction in paragraph ${marker.paragraphId}`}
							onClick={() => onMarkerClick(marker.paragraphId)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									onMarkerClick(marker.paragraphId);
								}
							}}
						/>
					))}
				</div>
			)}

			{contradictionActive && link && (
				<div
					className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
					style={linkVars}
				>
					<span
						className="docx-contradiction-evidence-bracket"
						style={{
							left: link.leftPx,
							top: link.topPx,
							height: Math.max(6, link.bottomPx - link.topPx),
						}}
					/>
					{link.showA && (
						<>
							<span
								className="docx-contradiction-evidence-cap"
								style={{ left: link.leftPx, top: link.aCenterPx }}
							/>
							<span
								className="docx-contradiction-evidence-dot docx-contradiction-evidence-dot--a"
								style={{ left: link.leftPx, top: link.aCenterPx }}
							/>
							<span
								className="docx-contradiction-evidence-label docx-contradiction-evidence-label--a"
								style={{ left: link.leftPx, top: link.aCenterPx }}
							>
								A
							</span>
						</>
					)}
					{link.showB && (
						<>
							<span
								className="docx-contradiction-evidence-cap"
								style={{ left: link.leftPx, top: link.bCenterPx }}
							/>
							<span
								className="docx-contradiction-evidence-dot docx-contradiction-evidence-dot--b"
								style={{ left: link.leftPx, top: link.bCenterPx }}
							/>
							<span
								className="docx-contradiction-evidence-label docx-contradiction-evidence-label--b"
								style={{ left: link.leftPx, top: link.bCenterPx }}
							>
								B
							</span>
						</>
					)}
				</div>
			)}
		</div>
	);
}
