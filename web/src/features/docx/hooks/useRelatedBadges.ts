'use client';

import { useEffect } from 'react';
import { resolveRelatedVisualKind } from '@/features/docx/utils/related/related-bridge';
import type { RelatedParagraph } from '@/types/document';

const BADGE_EMPHASIS_CLASSES = [
	'docx-related-badge-emphasis',
	'docx-related-badge--reference',
	'docx-related-badge--similarity',
];

interface UseRelatedBadgesParams {
	active: boolean;
	paragraphRelationHostById: Map<string, HTMLElement>;
	selectedParagraphId: string | null;
	related: RelatedParagraph[];
}

/**
 * Resalta los badges de relación al seleccionar en la pestaña Related: enfatiza
 * el del párrafo seleccionado y los de sus relacionados, coloreándolos por
 * dirección (azul reference / verde similarity). El atenuado del resto lo hace el
 * CSS via la clase `related-focus-on` del contenedor. Port de la parte de badges
 * de `applyRelatedSelectionHighlight` / `clearRelatedSelectionHighlight` del Svelte.
 */
export function useRelatedBadges({
	active,
	paragraphRelationHostById,
	selectedParagraphId,
	related,
}: UseRelatedBadgesParams) {
	useEffect(() => {
		const clear = () => {
			for (const host of paragraphRelationHostById.values()) {
				host.classList.remove(...BADGE_EMPHASIS_CLASSES);
			}
		};
		clear();

		if (!active || !selectedParagraphId) return clear;

		paragraphRelationHostById.get(selectedParagraphId)?.classList.add('docx-related-badge-emphasis');
		for (const item of related) {
			const directionClass =
				resolveRelatedVisualKind(item) === 'reference'
					? 'docx-related-badge--reference'
					: 'docx-related-badge--similarity';
			paragraphRelationHostById
				.get(item.node.id)
				?.classList.add('docx-related-badge-emphasis', directionClass);
		}

		return clear;
	}, [active, selectedParagraphId, related, paragraphRelationHostById]);
}
