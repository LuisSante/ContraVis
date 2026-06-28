// Builders puros de mensajes del chat del asistente (sin React/estado). El hook
// solo genera el id y hace `setMessages(prev => [...prev, build(...)])`.

import type {
	AssistantChatMessage,
	ContradictionParagraphResult,
	FixContradictionSuggestion,
} from '@/types/document';

export function buildUserMessage(id: string, content: string): AssistantChatMessage {
	return { id, role: 'user', content };
}

export function buildAssistantMessage(id: string, content: string): AssistantChatMessage {
	return { id, role: 'assistant', content };
}

/** Mensaje de asistente de un quick-action, con cita opcional al párrafo. */
export function buildQuickActionMessage(
	id: string,
	content: string,
	citationId?: string
): AssistantChatMessage {
	return {
		id,
		role: 'assistant',
		content,
		citations: citationId ? [{ id: citationId, excerpt: '(selected paragraph)' }] : undefined,
	};
}

/** Mensaje con la tarjeta de fix estructurado. */
export function buildFixSuggestionMessage(
	id: string,
	suggestion: FixContradictionSuggestion
): AssistantChatMessage {
	return {
		id,
		role: 'assistant',
		content: `Structured contradiction-fix suggestion for paragraph ${suggestion.paragraphId}.`,
		citations: [{ id: suggestion.paragraphId, excerpt: '(selected paragraph)' }],
		fixContradictionSuggestion: suggestion,
	};
}

/** Texto de la explicación "free" (sin coste LLM) de una contradicción. */
export function buildFreeContradictionText(
	paragraphId: string,
	contradiction: ContradictionParagraphResult
): string {
	const reason = (contradiction.brief_reason || 'No brief reason is available.').trim();
	const confidence = Number.isFinite(contradiction.confidence) ? contradiction.confidence : 0;
	const evidence = contradiction.evidence;
	const footerMessage =
		'Use "Why is it a contradiction? (AI cost)" for deeper evidence with richer legal reasoning.';
	const evidenceLines =
		evidence?.snippet_a?.trim() && evidence?.snippet_b?.trim()
			? [
					`Snippet A (${evidence.source_a?.trim() || 'paragraph'}): "${evidence.snippet_a.trim()}"`,
					`Snippet B (${evidence.source_b?.trim() || 'paragraph'}): "${evidence.snippet_b.trim()}"`,
				]
			: ['No structured evidence snippets were returned by the classifier.'];
	return [
		`Free explanation for paragraph ${paragraphId}:`,
		reason,
		`Confidence: ${confidence}%`,
		...evidenceLines,
		footerMessage,
	].join('\n\n');
}

/** Entidades del último mensaje del asistente que las tenga (para el documento). */
export function selectLatestEntityHighlights(
	messages: AssistantChatMessage[]
): NonNullable<AssistantChatMessage['entityHighlights']> {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const highlights = messages[index].entityHighlights;
		if (highlights && highlights.length > 0) return highlights;
	}
	return [];
}
