import { normalizeEditableText } from './dom';
import type { ParagraphEditState } from './types';

/**
 * Garantiza una entrada de estado de edición para un párrafo (idempotente).
 * Helper de modelo del motor: opera sobre el mapa que le inyecta el consumidor.
 */
export function ensureNodeEditState(
	nodeEditStateById: Map<string, ParagraphEditState>,
	nodeId: string,
	fallbackText: string
): ParagraphEditState {
	const normalizedFallback = normalizeEditableText(fallbackText ?? '');
	const existing = nodeEditStateById.get(nodeId);
	if (existing) return existing;

	const state: ParagraphEditState = {
		committed: normalizedFallback,
		current: normalizedFallback,
		editedSinceCommit: false
	};
	nodeEditStateById.set(nodeId, state);
	return state;
}
