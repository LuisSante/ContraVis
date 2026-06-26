import type { Node as ParagraphNode, ParagraphEditState } from '@/types/document';
import { normalizeEditableText } from './dom';

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

export function getNodeCurrentText(
	nodeEditStateById: Map<string, ParagraphEditState>,
	node: ParagraphNode
): string {
	return nodeEditStateById.get(node.id)?.current ?? node.text;
}

export function updateSelectionHighlight(
	paragraphElementById: Map<string, HTMLElement>,
	nextNodeId: string | null
) {
	for (const [nodeId, element] of paragraphElementById.entries()) {
		const isSelected = Boolean(nextNodeId && nodeId === nextNodeId);
		element.classList.toggle('z-10', isSelected);
		element.classList.toggle('bg-blue-50/50', isSelected);
		element.classList.toggle('ring-2', isSelected);
		element.classList.toggle('ring-blue-700', isSelected);
	}
}
