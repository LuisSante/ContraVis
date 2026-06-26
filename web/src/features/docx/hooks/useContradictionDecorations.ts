'use client';

import { useEffect } from 'react';
import {
	applyContradictionHighlights,
	clearContradictionHighlights,
} from '@/features/docx/utils/contradiction-decorations';
import type { ContradictionParagraphResult } from '@/types/document';

interface UseContradictionDecorationsParams {
	/** El panel de análisis está visible (tab 'analysis' abierta). */
	active: boolean;
	/** Se incrementa al terminar cada render del documento. */
	renderEpoch: number;
	resultsByParagraphId: Map<string, ContradictionParagraphResult>;
	paragraphElementById: Map<string, HTMLElement>;
	selectedParagraphId: string | null;
}

/**
 * Aplica/limpia las decoraciones de contradicción sobre el DOM renderizado
 * (clases de resaltado en párrafos + `<mark>` de snippets). Re-corre cuando
 * cambia el render, los resultados, la selección o la visibilidad del panel.
 *
 * Difiere: rail de marcadores laterales, animación de compresión y link SVG.
 */
export function useContradictionDecorations({
	active,
	renderEpoch,
	resultsByParagraphId,
	paragraphElementById,
	selectedParagraphId,
}: UseContradictionDecorationsParams) {
	useEffect(() => {
		if (!active || renderEpoch === 0) {
			clearContradictionHighlights(paragraphElementById);
			return;
		}

		applyContradictionHighlights({
			resultsByParagraphId,
			paragraphElementById,
			selectedParagraphId,
		});

		return () => {
			clearContradictionHighlights(paragraphElementById);
		};
	}, [active, renderEpoch, resultsByParagraphId, selectedParagraphId, paragraphElementById]);
}
