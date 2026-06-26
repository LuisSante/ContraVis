import type {
	ContradictionParagraphResult,
	ContradictionScrollMarker
} from '@/types/document';
import { resolveContradictionConfidenceBand } from './contradiction';

const CONTRADICTION_EVIDENCE_MARKER_MIN_GAP_PX = 18;

export interface ContradictionEvidenceLink {
	topPx: number;
	bottomPx: number;
	leftPx: number;
	showA: boolean;
	showB: boolean;
	aCenterPx: number;
	bCenterPx: number;
}

export function computeContradictionMarkers(params: {
	scrollHost: HTMLElement;
	paragraphElementById: Map<string, HTMLElement>;
	resultsByParagraphId: Map<string, ContradictionParagraphResult>;
	selectedParagraphId: string | null;
}): { markers: ContradictionScrollMarker[]; link: ContradictionEvidenceLink | null } {
	const { scrollHost, paragraphElementById, resultsByParagraphId, selectedParagraphId } = params;

	if (resultsByParagraphId.size === 0) {
		return { markers: [], link: null };
	}

	const hostRect = scrollHost.getBoundingClientRect();
	const hostScrollHeight = scrollHost.scrollHeight;
	const hostScrollTop = scrollHost.scrollTop;
	if (!Number.isFinite(hostScrollHeight) || hostScrollHeight <= 0) {
		return { markers: [], link: null };
	}

	const nextMarkers: ContradictionScrollMarker[] = [];

	for (const [paragraphId, result] of resultsByParagraphId.entries()) {
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

	if (!selectedParagraphId || !resultsByParagraphId.get(selectedParagraphId)?.contradiction) {
		return { markers: nextMarkers, link: null };
	}

	let markA: HTMLElement | null = null;
	let markB: HTMLElement | null = null;
	const allMarks = Array.from(
		document.querySelectorAll<HTMLElement>('mark.docx-contradiction-snippet')
	);
	for (const mark of allMarks) {
		if (mark.dataset.contradictionOwner !== selectedParagraphId) continue;
		if (!markA && mark.dataset.contradictionRole === 'a') {
			markA = mark;
		}
		if (!markB && mark.dataset.contradictionRole === 'b') {
			markB = mark;
		}
		if (markA && markB) break;
	}

	if (!markA || !markB) {
		return { markers: nextMarkers, link: null };
	}

	const markARect = markA.getBoundingClientRect();
	const markBRect = markB.getBoundingClientRect();
	const aCenterPx = markARect.top - hostRect.top + markARect.height / 2;
	const bCenterPx = markBRect.top - hostRect.top + markBRect.height / 2;
	const showA = aCenterPx >= 0 && aCenterPx <= hostRect.height;
	const showB = bCenterPx >= 0 && bCenterPx <= hostRect.height;

	let displayACenterPx = Math.max(0, Math.min(hostRect.height, aCenterPx));
	let displayBCenterPx = Math.max(0, Math.min(hostRect.height, bCenterPx));
	{
		const currentGap = Math.abs(displayACenterPx - displayBCenterPx);
		if (showA && showB && currentGap < CONTRADICTION_EVIDENCE_MARKER_MIN_GAP_PX) {
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
		return { markers: nextMarkers, link: null };
	}
	const rightEdge = Math.max(markARect.right, markBRect.right);
	const leftPx = Math.max(8, rightEdge - hostRect.left + 16);

	const link: ContradictionEvidenceLink = {
		topPx,
		bottomPx,
		leftPx,
		showA,
		showB,
		aCenterPx: displayACenterPx,
		bCenterPx: displayBCenterPx
	};

	return { markers: nextMarkers, link };
}
