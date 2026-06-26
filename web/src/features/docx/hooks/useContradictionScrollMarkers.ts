'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import {
	computeContradictionMarkers,
	type ContradictionEvidenceLink,
} from '@/features/docx/utils/contradiction-markers';
import type { ContradictionParagraphResult, ContradictionScrollMarker } from '@/types/document';

interface UseContradictionScrollMarkersParams {
	active: boolean;
	renderEpoch: number;
	scrollHostRef: RefObject<HTMLElement | null>;
	paragraphElementById: Map<string, HTMLElement>;
	resultsByParagraphId: Map<string, ContradictionParagraphResult>;
	selectedParagraphId: string | null;
}

/**
 * Calcula y mantiene actualizados el rail de marcadores de contradicción y el
 * link de evidencia A↔B, recalculando con RAF en scroll/resize del host del
 * documento. La animación de compresión (B→A entre páginas) se difiere.
 */
export function useContradictionScrollMarkers({
	active,
	renderEpoch,
	scrollHostRef,
	paragraphElementById,
	resultsByParagraphId,
	selectedParagraphId,
}: UseContradictionScrollMarkersParams) {
	const [markers, setMarkers] = useState<ContradictionScrollMarker[]>([]);
	const [link, setLink] = useState<ContradictionEvidenceLink | null>(null);
	const frameRef = useRef<number | null>(null);

	useEffect(() => {
		const host = scrollHostRef.current;
		if (!active || !host || renderEpoch === 0) {
			setMarkers([]);
			setLink(null);
			return;
		}

		const refresh = () => {
			const currentHost = scrollHostRef.current;
			if (!currentHost) return;
			const result = computeContradictionMarkers({
				scrollHost: currentHost,
				paragraphElementById,
				resultsByParagraphId,
				selectedParagraphId,
			});
			setMarkers(result.markers);
			setLink(result.link);
		};

		const schedule = () => {
			if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = null;
				refresh();
			});
		};

		schedule();
		host.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		const observer = new ResizeObserver(schedule);
		observer.observe(host);

		return () => {
			host.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			observer.disconnect();
			if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
		};
	}, [active, renderEpoch, scrollHostRef, paragraphElementById, resultsByParagraphId, selectedParagraphId]);

	return { markers, link };
}
