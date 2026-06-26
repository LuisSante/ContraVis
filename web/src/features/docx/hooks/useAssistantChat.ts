'use client';

import { useRef, useState } from 'react';
import { useDocumentStore } from '@/stores/document';
import { fetchAssistantResponse } from '@/services/assistant';
import { getAxiosErrorMessage } from '@/features/docx/utils/http-error';
import {
	buildAssistantHistoryPayload,
	buildAssistantNodeSnapshot,
	buildAssistantRelatedContext,
	resolveAssistantSuggestedQuestions,
} from '@/features/docx/utils/assistant';
import type {
	AssistantChatMessage,
	AssistantChatRequest,
	AssistantMode,
	AssistantProvider,
	AssistantScope,
	ParagraphEditState,
} from '@/types/document';

interface UseAssistantChatParams {
	docId: string;
	nodeEditStateById: Map<string, ParagraphEditState>;
}

/**
 * Chat del asistente sobre el contrato. Slice actual: pregunta de texto libre
 * (scope contrato/seleccionado) → respuesta con citas y preguntas sugeridas.
 *
 * Difiere: confirmación de coste LLM, quick-actions de contradicción
 * (estructuradas), related context (hoy vacío) y las action-cards de fix.
 */
export function useAssistantChat({ docId, nodeEditStateById }: UseAssistantChatParams) {
	const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
	const [input, setInput] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [mode] = useState<AssistantMode>('explain');
	const [scope, setScope] = useState<AssistantScope>('full_contract');
	const [provider, setProvider] = useState<AssistantProvider>('openai');

	const messageCounter = useRef(0);
	const nextMessageId = () => {
		messageCounter.current += 1;
		return `assistant-msg-${messageCounter.current}`;
	};

	const submit = async (questionOverride?: string) => {
		if (loading) return;
		const question = (questionOverride ?? input).trim();
		if (!question) return;
		if (!docId) {
			setError('No document is loaded.');
			return;
		}

		const { paragraphs, selectedParagraph } = useDocumentStore.getState();
		const paragraphNodes = buildAssistantNodeSnapshot(paragraphs, nodeEditStateById);
		if (paragraphNodes.length === 0) {
			setError('The contract is still loading.');
			return;
		}
		if (scope === 'selected' && !selectedParagraph) {
			setError('Select a paragraph before asking in selected-paragraph mode.');
			return;
		}

		setError(null);
		const historyBeforeAnswer: AssistantChatMessage[] = [
			...messages,
			{ id: nextMessageId(), role: 'user', content: question },
		];
		setMessages(historyBeforeAnswer);
		if (!questionOverride) setInput('');
		setLoading(true);

		const payload: AssistantChatRequest = {
			documentId: docId,
			question,
			mode,
			scope,
			provider,
			selectedParagraphId: selectedParagraph?.id ?? null,
			relatedParagraphs: buildAssistantRelatedContext([]),
			paragraphNodes,
			history: buildAssistantHistoryPayload(historyBeforeAnswer),
		};

		try {
			const response = await fetchAssistantResponse(payload);
			setMessages((prev) => [
				...prev,
				{
					id: nextMessageId(),
					role: 'assistant',
					content: response.answer,
					citations: response.citations,
					suggestedQuestions: resolveAssistantSuggestedQuestions(response.suggestedQuestions, {
						mode,
						scope,
					}),
				},
			]);
		} catch (err) {
			const message = getAxiosErrorMessage(err, 'Failed to generate a response.');
			setError(message);
			setMessages((prev) => [
				...prev,
				{ id: nextMessageId(), role: 'assistant', content: message },
			]);
		} finally {
			setLoading(false);
		}
	};

	const handleKeydown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void submit();
		}
	};

	return {
		messages,
		input,
		loading,
		error,
		scope,
		provider,
		setScope,
		setProvider,
		setInput,
		submit,
		handleKeydown,
	};
}
