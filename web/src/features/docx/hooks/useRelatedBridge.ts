'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import {
	computeRelatedBridge,
	EMPTY_RELATED_BRIDGE,
	type RelatedBridge,
} from '@/features/docx/utils/related-bridge';
import type { Node as ParagraphNode, RelatedParagraph } from '@/types/document';

const COMPRESS_DURATION_MS = 560;
const COMPRESS_SNAP_EPSILON = 0.001;
const WHEEL_DIRECTION_DEADZONE = 2;

const NODE_CLASSES = [
	'docx-paragraph-explanation-selected',
	'docx-paragraph-explanation-related',
	'docx-paragraph-explanation-source-hidden',
	'docx-paragraph-explanation-muted',
];

interface UseRelatedBridgeParams {
	active: boolean;
	renderEpoch: number;
	scrollHostRef: RefObject<HTMLElement | null>;
	paragraphElementById: Map<string, HTMLElement>;
	selectedParagraph: ParagraphNode | null;
	related: RelatedParagraph[];
}

/**
 * Mantiene el "puente" de párrafos relacionados: la línea/conector con el
 * párrafo seleccionado, las etiquetas reference/similarity y la compresión por
 * **Shift + Scroll** que acerca los relacionados (con su tarjeta colapsada).
 * Recalcula con RAF en scroll/resize y aplica las clases de estado a los nodos.
 * Port del sistema `paragraphExplanationConnectors` del Svelte `+page.svelte`.
 */
export function useRelatedBridge({
	active,
	renderEpoch,
	scrollHostRef,
	paragraphElementById,
	selectedParagraph,
	related,
}: UseRelatedBridgeParams) {
	const [bridge, setBridge] = useState<RelatedBridge>(EMPTY_RELATED_BRIDGE);

	const compressionRef = useRef(0);
	const compressionTargetRef = useRef(0);
	const tweenRef = useRef<number | null>(null);
	const frameRef = useRef<number | null>(null);

	const clearNodeClasses = () => {
		for (const element of paragraphElementById.values()) {
			element.classList.remove(...NODE_CLASSES);
		}
	};

	const applyNodeClasses = (movedNodeIds: Set<string>) => {
		clearNodeClasses();
		if (!selectedParagraph?.id) return;
		const compression = compressionRef.current;
		const shouldMute = compression > 0.02 && movedNodeIds.size > 0;
		if (shouldMute) {
			for (const element of paragraphElementById.values()) {
				element.classList.add('docx-paragraph-explanation-muted');
			}
		}

		const selectedElement = paragraphElementById.get(selectedParagraph.id);
		selectedElement?.classList.remove('docx-paragraph-explanation-muted');
		selectedElement?.classList.add('docx-paragraph-explanation-selected');

		for (const item of related) {
			const relatedElement = paragraphElementById.get(item.node.id);
			relatedElement?.classList.remove('docx-paragraph-explanation-muted');
			relatedElement?.classList.add('docx-paragraph-explanation-related');
			if (compression > 0.02 && movedNodeIds.has(item.node.id)) {
				relatedElement?.classList.add('docx-paragraph-explanation-source-hidden');
			}
		}
	};

	useEffect(() => {
		const host = scrollHostRef.current;
		if (!active || !host || renderEpoch === 0 || !selectedParagraph) {
			setBridge(EMPTY_RELATED_BRIDGE);
			compressionRef.current = 0;
			compressionTargetRef.current = 0;
			clearNodeClasses();
			return;
		}

		const refresh = () => {
			const currentHost = scrollHostRef.current;
			if (!currentHost || !selectedParagraph) return;
			const result = computeRelatedBridge({
				scrollHost: currentHost,
				paragraphElementById,
				selectedParagraph,
				related,
				compression: compressionRef.current,
			});
			applyNodeClasses(result.movedNodeIds);
			setBridge(result);
		};

		const schedule = () => {
			if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
			frameRef.current = requestAnimationFrame(() => {
				frameRef.current = null;
				refresh();
			});
		};

		const animateCompression = (timestamp: number, startValue: number, startTime: number) => {
			const elapsed = timestamp - startTime;
			const linearProgress = Math.max(0, Math.min(1, elapsed / COMPRESS_DURATION_MS));
			const easedProgress =
				linearProgress < 0.5
					? 4 * linearProgress * linearProgress * linearProgress
					: 1 - Math.pow(-2 * linearProgress + 2, 3) / 2;
			compressionRef.current =
				startValue + (compressionTargetRef.current - startValue) * easedProgress;
			refresh();

			const delta = Math.abs(compressionTargetRef.current - compressionRef.current);
			if (linearProgress >= 1 || delta <= COMPRESS_SNAP_EPSILON) {
				compressionRef.current = compressionTargetRef.current;
				tweenRef.current = null;
				refresh();
				return;
			}
			tweenRef.current = requestAnimationFrame((next) =>
				animateCompression(next, startValue, startTime)
			);
		};

		const handleWheel = (event: WheelEvent) => {
			if (!event.shiftKey) return;
			const wheelDelta =
				Math.abs(event.deltaY) >= WHEEL_DIRECTION_DEADZONE ? event.deltaY : event.deltaX;
			if (Math.abs(wheelDelta) < WHEEL_DIRECTION_DEADZONE) return;
			event.preventDefault();
			const nextTarget = wheelDelta > 0 ? 1 : 0;
			if (nextTarget === compressionTargetRef.current && tweenRef.current != null) return;

			compressionTargetRef.current = nextTarget;
			const startValue = compressionRef.current;
			const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
			if (tweenRef.current != null) {
				cancelAnimationFrame(tweenRef.current);
				tweenRef.current = null;
			}
			tweenRef.current = requestAnimationFrame((next) =>
				animateCompression(next, startValue, startTime)
			);
		};

		schedule();
		host.addEventListener('scroll', schedule, { passive: true });
		window.addEventListener('resize', schedule);
		host.addEventListener('wheel', handleWheel, { passive: false });
		const observer = new ResizeObserver(schedule);
		observer.observe(host);

		return () => {
			host.removeEventListener('scroll', schedule);
			window.removeEventListener('resize', schedule);
			host.removeEventListener('wheel', handleWheel);
			observer.disconnect();
			if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
			if (tweenRef.current != null) cancelAnimationFrame(tweenRef.current);
			clearNodeClasses();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [active, renderEpoch, scrollHostRef, paragraphElementById, selectedParagraph, related]);

	return bridge;
}
