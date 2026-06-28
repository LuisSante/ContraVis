'use client';

import type { MouseEvent } from 'react';
import type { RelatedBridge } from '@/features/docx/utils/related/related-bridge';

interface RelatedBridgeOverlayProps {
	bridge: RelatedBridge;
	onJumpToParagraph: (paragraphId: string) => void;
	/** Arrastrar el rail scrollea el documento (scrub). */
	onRailMouseDown?: (event: MouseEvent) => void;
}

/**
 * Capa visual del puente de párrafos relacionados: la línea/conector con el
 * párrafo seleccionado, los caps y etiquetas reference/similarity, los pliegues,
 * las tarjetas colapsadas (al acercar con Shift+Scroll) y el rail de marcadores
 * de scroll. Port del bloque de plantilla del Svelte `RightPanelAnalysis`/page.
 */
export function RelatedBridgeOverlay({
	bridge,
	onJumpToParagraph,
	onRailMouseDown,
}: RelatedBridgeOverlayProps) {
	const { connectors, primaryConnector, folds, collapsedCards, scrollMarkers } = bridge;

	return (
		<>
			{connectors.length > 0 ? (
				<div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
					{primaryConnector ? (
						<>
							<span
								className="docx-paragraph-explanation-bracket docx-paragraph-explanation-bracket--interactive"
								style={{
									left: primaryConnector.leftPx,
									top: primaryConnector.topPx,
									height: Math.max(6, primaryConnector.bottomPx - primaryConnector.topPx),
								}}
								role="button"
								tabIndex={0}
								aria-label={`Go to related paragraph ${primaryConnector.paragraphId}`}
								onClick={() => onJumpToParagraph(primaryConnector.paragraphId)}
								onKeyDown={(event) => {
									if (event.key === 'Enter' || event.key === ' ') {
										event.preventDefault();
										onJumpToParagraph(primaryConnector.paragraphId);
									}
								}}
							/>
							<span
								className="docx-paragraph-explanation-cap"
								style={{
									left: primaryConnector.leftPx,
									top: primaryConnector.selectedCapTopPx,
									width: primaryConnector.selectedCapWidthPx,
								}}
							/>
						</>
					) : null}

					{connectors.map((connector, index) => (
						<span
							key={`connector-cap-${connector.paragraphId}-${index}`}
							className="docx-paragraph-explanation-cap docx-paragraph-explanation-cap--interactive"
							style={{
								left: connector.leftPx,
								top: connector.relatedCapTopPx,
								width: connector.relatedCapWidthPx,
							}}
							role="button"
							tabIndex={0}
							aria-label={`Go to related paragraph (${connector.relationLabel})`}
							onClick={() => onJumpToParagraph(connector.paragraphId)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									onJumpToParagraph(connector.paragraphId);
								}
							}}
						/>
					))}

					{connectors.map((connector, index) => (
						<span
							key={`connector-label-${connector.paragraphId}-${index}`}
							className={`docx-paragraph-explanation-cap-label ${
								connector.relationKind === 'similarity'
									? 'docx-paragraph-explanation-cap-label--similarity'
									: 'docx-paragraph-explanation-cap-label--reference'
							}`}
							style={{ left: connector.labelLeftPx, top: connector.relatedCapTopPx }}
						>
							{connector.relationLabel}
						</span>
					))}

					{folds.map((fold, index) => (
						<svg
							key={`fold-${index}`}
							className="docx-paragraph-explanation-line-fold"
							style={{ left: fold.leftPx, top: fold.topPx }}
							viewBox="0 0 12 20"
							aria-hidden="true"
						>
							<path d="M6 1 L3 5 L9 9 L3 13 L6 19" />
						</svg>
					))}

					{collapsedCards.map((card) => (
						<div
							key={`collapsed-card-${card.paragraphId}`}
							className="docx-paragraph-explanation-collapsed-card"
							style={{ left: card.leftPx, top: card.topPx, width: card.widthPx }}
							// El HTML proviene del DOM ya renderizado del propio documento (clon estático).
							dangerouslySetInnerHTML={{ __html: card.html }}
						/>
					))}
				</div>
			) : null}

			{scrollMarkers.length > 0 ? (
				<div className="absolute top-2 right-1 bottom-2 z-20 w-2" onMouseDown={onRailMouseDown}>
					{scrollMarkers.map((marker) => (
						<span
							key={`related-marker-${marker.paragraphId}`}
							className={`docx-related-scroll-marker docx-related-scroll-marker--${marker.kind}`}
							style={{ top: `${marker.topPercent}%` }}
							role="button"
							tabIndex={0}
							aria-label={`Go to ${marker.kind} paragraph ${marker.paragraphId}`}
							onClick={() => onJumpToParagraph(marker.paragraphId)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault();
									onJumpToParagraph(marker.paragraphId);
								}
							}}
						/>
					))}
				</div>
			) : null}
		</>
	);
}
