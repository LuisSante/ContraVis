'use client';

import type { AssistantCitation } from '@/types/document';

interface CitationChipsProps {
	citations: AssistantCitation[];
	onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void;
}

/**
 * Clickable citation chips rendered under an assistant message. Each chip
 * focuses the referenced paragraph node. Ported from the `message.citations`
 * block of the Svelte `RightPanelAssistant` component.
 */
export function CitationChips({ citations, onFocusNodeFromPanel }: CitationChipsProps) {
	if (!citations.length) return null;

	return (
		<div className="mt-2 flex flex-wrap gap-1">
			{citations.map((citation, index) => (
				<button
					key={`${citation.id}-${index}`}
					type="button"
					className="docx-reference-chip"
					title={citation.excerpt}
					onClick={() => onFocusNodeFromPanel(citation.id, true)}
				>
					{citation.id}
				</button>
			))}
		</div>
	);
}
