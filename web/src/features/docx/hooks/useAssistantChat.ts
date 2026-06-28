'use client';

import { useEffect, useRef, useState } from 'react';
import { useDocumentStore } from '@/stores/document';
import { fetchAssistantResponse } from '@/services/assistant';
import { getAxiosErrorMessage } from '@/features/docx/utils/docx-engine/http-error';
import {
	buildAssistantHistoryPayload,
	buildAssistantNodeSnapshot,
	buildAssistantRelatedContext,
	resolveAssistantSuggestedQuestions,
} from '@/features/docx/utils/assistant/assistant';
import { buildUserMessage } from '@/features/docx/utils/assistant/message-builders';
import {
	useContradictionQuickActions,
	type ConfirmLlmEstimate,
} from '@/features/docx/hooks/useContradictionQuickActions';
import type {
	AssistantChatMessage,
	AssistantChatRequest,
	AssistantMode,
	AssistantProvider,
	AssistantScope,
	ContradictionParagraphResult,
	ParagraphEditState,
	RelatedParagraph,
} from '@/types/document';

interface UseAssistantChatParams {
	docId: string;
	nodeEditStateById: Map<string, ParagraphEditState>;
	/** Devuelve el contenedor del documento renderizado (target del fix). */
	getViewerElement?: () => HTMLElement | null;
	/** Mapa id de párrafo → elemento DOM (para aplicar la reescritura). */
	paragraphElementById?: Map<string, HTMLElement>;
	/** Resultados de contradicción por párrafo (alimentan los quick-actions). */
	contradictionResultsByParagraphId?: Map<string, ContradictionParagraphResult>;
	/** Párrafos relacionados del seleccionado (contexto del fix). */
	selectedRelatedParagraphs?: RelatedParagraph[];
	/** Modelo de análisis global (opcional, se reenvía al backend). */
	model?: string;
	/** Confirmación de coste LLM antes de cada llamada (si se omite, no se pide). */
	confirmLlmEstimate?: ConfirmLlmEstimate;
}

/**
 * Chat del asistente sobre el contrato. Un único array `messages` alimenta tanto
 * el Contract Chat Assistant como el chat embebido en Contradiction Analysis, por
 * lo que lo que se escribe en uno aparece en el otro (paridad con el Svelte).
 *
 * Este hook es el **núcleo** (pregunta de texto libre + estado del hilo) y compone
 * `useContradictionQuickActions` (why/riesgos/fix/entidades) sobre el mismo hilo,
 * exponiendo una única API. Los builders de mensajes viven en `utils/assistant`.
 */
export function useAssistantChat({
	docId,
	nodeEditStateById,
	getViewerElement,
	paragraphElementById,
	contradictionResultsByParagraphId,
	selectedRelatedParagraphs = [],
	model,
	confirmLlmEstimate,
}: UseAssistantChatParams) {
	const [messages, setMessages] = useState<AssistantChatMessage[]>([]);
	const [input, setInput] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [mode] = useState<AssistantMode>('explain');
	const [scope, setScope] = useState<AssistantScope>('full_contract');
	const [provider, setProvider] = useState<AssistantProvider>('openai');

	// Espejo de `messages` para construir el historial sin depender del re-render.
	const messagesRef = useRef<AssistantChatMessage[]>([]);
	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);

	const messageCounter = useRef(0);
	const nextMessageId = () => {
		messageCounter.current += 1;
		return `assistant-msg-${messageCounter.current}`;
	};

	/** Núcleo de una pregunta de chat (texto libre o quick-action de texto). */
	const submitAssistantQuestion = async (
		questionOverride?: string,
		opts?: { scope?: AssistantScope }
	) => {
		if (loading) return;
		const question = (questionOverride ?? input).trim();
		if (!question) return;
		if (!docId) {
			setError('No document is loaded.');
			return;
		}

		const effectiveScope = opts?.scope ?? scope;
		const { paragraphs, selectedParagraph } = useDocumentStore.getState();
		const paragraphNodes = buildAssistantNodeSnapshot(paragraphs, nodeEditStateById);
		if (paragraphNodes.length === 0) {
			setError('The contract is still loading.');
			return;
		}
		if (effectiveScope === 'selected' && !selectedParagraph) {
			setError('Select a paragraph before asking in selected-paragraph mode.');
			return;
		}

		setError(null);
		const historyBeforeAnswer: AssistantChatMessage[] = [
			...messagesRef.current,
			buildUserMessage(nextMessageId(), question),
		];
		setMessages(historyBeforeAnswer);
		if (!questionOverride) setInput('');
		setLoading(true);

		const payload: AssistantChatRequest = {
			documentId: docId,
			question,
			mode,
			scope: effectiveScope,
			provider,
			model: model?.trim() || undefined,
			selectedParagraphId: selectedParagraph?.id ?? null,
			relatedParagraphs: buildAssistantRelatedContext(selectedRelatedParagraphs),
			paragraphNodes,
			history: buildAssistantHistoryPayload(historyBeforeAnswer),
		};

		try {
			if (confirmLlmEstimate) {
				const approved = await confirmLlmEstimate('assistant_chat', payload);
				if (!approved) return;
			}
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
						scope: effectiveScope,
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

	const submit = (questionOverride?: string) => submitAssistantQuestion(questionOverride);

	/** Pregunta libre dentro del chat de contradicción (siempre scope seleccionado). */
	const submitContradictionQuestion = (questionOverride?: string) =>
		submitAssistantQuestion(questionOverride, { scope: 'selected' });

	// Quick-actions de contradicción (why/riesgos/fix/entidades) sobre el mismo hilo.
	const quickActions = useContradictionQuickActions({
		docId,
		nodeEditStateById,
		provider,
		model,
		selectedRelatedParagraphs,
		contradictionResultsByParagraphId,
		paragraphElementById,
		getViewerElement,
		confirmLlmEstimate,
		messages,
		messagesRef,
		setMessages,
		loading,
		setLoading,
		setError,
		nextMessageId,
		submitContradictionQuestion,
	});

	const handleKeydown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			void submit();
		}
	};

	/** Cmd/Ctrl+Enter envía en el chat de contradicción (scope seleccionado). */
	const handleContradictionKeydown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
			event.preventDefault();
			void submitContradictionQuestion();
		}
	};

	return {
		messages,
		input,
		loading,
		error,
		scope,
		provider,
		entityHighlightsEnabled: quickActions.entityHighlightsEnabled,
		contradictionEntities: quickActions.contradictionEntities,
		rewriteBusy: quickActions.rewriteBusy,
		setScope,
		setProvider,
		setInput,
		submit,
		handleKeydown,
		// Chat de contradicción (compartido):
		askQuickAction: quickActions.askQuickAction,
		suggestContradictionFix: quickActions.suggestContradictionFix,
		acceptFixSuggestion: quickActions.acceptFixSuggestion,
		toggleEntityHighlights: quickActions.toggleEntityHighlights,
		submitContradictionQuestion,
		handleContradictionKeydown,
	};
}
