'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDocumentStore } from '@/stores/document';
import { fetchAssistantResponse } from '@/services/assistant';
import { getAxiosErrorMessage } from '@/features/docx/utils/http-error';
import {
	buildAssistantHistoryPayload,
	buildAssistantNodeSnapshot,
	buildAssistantRelatedContext,
	buildContradictionAiCostQuestion,
	buildContradictionRiskQuestion,
	resolveAssistantSuggestedQuestions,
} from '@/features/docx/utils/assistant';
import { getNodeCurrentText } from '@/features/docx/utils/edit';
import { buildParagraphExplanationEntityHighlights } from '@/features/docx/utils/paragraph-explanation';
import {
	buildFallbackContradictionEntities,
	buildFixSuggestionChangeNotes,
	extractAnswerEntities,
} from '@/features/docx/utils/contradiction-chat';
import { applyRewriteToParagraph, executeFixContradictionRewrite } from '@/features/docx/utils/rewrite';
import {
	QUICK_ACTION_CONTRADICTION_RISKS,
	QUICK_ACTION_WHY_CONTRADICTION_AI,
	QUICK_ACTION_WHY_CONTRADICTION_FREE,
} from '@/constants/docx-viewer';
import type {
	AssistantChatMessage,
	AssistantChatRequest,
	AssistantMode,
	AssistantProvider,
	AssistantScope,
	ContradictionAnalysisRequest,
	ContradictionParagraphResult,
	FixContradictionSuggestion,
	LlmEstimateCallType,
	Node as ParagraphNode,
	ParagraphEditState,
	RelatedParagraph,
	SimplifySelectionRequest,
} from '@/types/document';

type ConfirmLlmEstimate = (
	callType: LlmEstimateCallType,
	payload: AssistantChatRequest | SimplifySelectionRequest | ContradictionAnalysisRequest
) => Promise<boolean>;

/** Top-N de párrafos relacionados que se envían como contexto al fix. */
const FIX_CONTRADICTION_TOP_RELATED = 3;

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

type QuickActionResponseOptions = {
	citationId?: string;
};

/**
 * Chat del asistente sobre el contrato. Un único array `messages` alimenta tanto
 * el Contract Chat Assistant como el chat embebido en Contradiction Analysis, por
 * lo que lo que se escribe en uno aparece en el otro (paridad con el Svelte).
 *
 * Cubre: pregunta de texto libre, quick-actions de contradicción (why estructurado
 * con entidades, evaluación de riesgos) y la sugerencia de fix estructurada con su
 * tarjeta de "Accept suggestion".
 *
 * Difiere: confirmación de coste LLM y el resaltado de entidades dentro del cuerpo
 * del documento (hoy el toggle solo afecta al render de los mensajes).
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
	const [entityHighlightsEnabled, setEntityHighlightsEnabled] = useState(true);
	const [rewriteBusy, setRewriteBusy] = useState(false);

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

	const appendAssistantQuickActionMessage = (
		content: string,
		optionsOrCitation?: QuickActionResponseOptions | string
	) => {
		const options: QuickActionResponseOptions =
			typeof optionsOrCitation === 'string'
				? { citationId: optionsOrCitation }
				: (optionsOrCitation ?? {});
		setMessages((prev) => [
			...prev,
			{
				id: nextMessageId(),
				role: 'assistant',
				content,
				citations: options.citationId
					? [{ id: options.citationId, excerpt: '(selected paragraph)' }]
					: undefined,
			},
		]);
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
			{ id: nextMessageId(), role: 'user', content: question },
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

	/** Why estructurado (coste AI): respuesta con entidades resaltables. */
	const submitStructuredContradictionWhy = async (
		selected: ParagraphNode,
		contradiction: ContradictionParagraphResult,
		baseMessages: AssistantChatMessage[]
	) => {
		if (loading) return;
		if (!docId) {
			setError('No document is loaded.');
			return;
		}
		const { paragraphs } = useDocumentStore.getState();
		const paragraphNodes = buildAssistantNodeSnapshot(paragraphs, nodeEditStateById);
		if (paragraphNodes.length === 0) {
			setError('The contract is still loading.');
			return;
		}

		const selectedText = getNodeCurrentText(nodeEditStateById, selected);
		const question = buildContradictionAiCostQuestion(selected.id, selectedText, contradiction);

		setLoading(true);
		setError(null);

		const payload: AssistantChatRequest = {
			documentId: docId,
			question,
			mode: 'explain',
			scope: 'selected',
			provider,
			model: model?.trim() || undefined,
			selectedParagraphId: selected.id,
			relatedParagraphs: buildAssistantRelatedContext(selectedRelatedParagraphs),
			paragraphNodes,
			history: buildAssistantHistoryPayload(baseMessages),
		};

		try {
			if (confirmLlmEstimate) {
				const approved = await confirmLlmEstimate('assistant_chat', payload);
				if (!approved) return;
			}
			const response = await fetchAssistantResponse(payload);
			const parsed = extractAnswerEntities(response.answer);
			const fallbackEntities = buildFallbackContradictionEntities(selectedText, contradiction);
			const entityHighlights = buildParagraphExplanationEntityHighlights(
				parsed.entities.length > 0 ? parsed.entities : fallbackEntities
			);
			setEntityHighlightsEnabled(true);
			setMessages((prev) => [
				...prev,
				{
					id: nextMessageId(),
					role: 'assistant',
					content: parsed.content || response.answer,
					citations: response.citations,
					entityHighlights,
					suggestedQuestions: resolveAssistantSuggestedQuestions(response.suggestedQuestions, {
						mode: 'explain',
						scope: 'selected',
						contradiction: true,
					}),
				},
			]);
		} catch (err) {
			const message = getAxiosErrorMessage(err, 'Failed to generate a response.');
			setError(message);
			setMessages((prev) => [
				...prev,
				{ id: nextMessageId(), role: 'assistant', content: `I could not complete this request: ${message}` },
			]);
		} finally {
			setLoading(false);
		}
	};

	/** Evaluación de riesgos: respuesta estructurada (Context/Risks/…) con entidades. */
	const submitContradictionRiskAssessment = async (
		selected: ParagraphNode,
		contradiction: ContradictionParagraphResult,
		baseMessages: AssistantChatMessage[]
	) => {
		if (loading) return;
		if (!docId) {
			setError('No document is loaded.');
			return;
		}
		const { paragraphs } = useDocumentStore.getState();
		const paragraphNodes = buildAssistantNodeSnapshot(paragraphs, nodeEditStateById);
		if (paragraphNodes.length === 0) {
			setError('The contract is still loading.');
			return;
		}

		const selectedText = getNodeCurrentText(nodeEditStateById, selected);
		const question = buildContradictionRiskQuestion(selected.id, selectedText, contradiction);

		setLoading(true);
		setError(null);

		const payload: AssistantChatRequest = {
			documentId: docId,
			question,
			mode: 'explain',
			scope: 'selected',
			provider,
			model: model?.trim() || undefined,
			selectedParagraphId: selected.id,
			relatedParagraphs: buildAssistantRelatedContext(selectedRelatedParagraphs),
			paragraphNodes,
			history: buildAssistantHistoryPayload(baseMessages),
		};

		try {
			if (confirmLlmEstimate) {
				const approved = await confirmLlmEstimate('assistant_chat', payload);
				if (!approved) return;
			}
			const response = await fetchAssistantResponse(payload);
			const parsed = extractAnswerEntities(response.answer);
			const fallbackEntities = buildFallbackContradictionEntities(selectedText, contradiction);
			const entityHighlights = buildParagraphExplanationEntityHighlights(
				parsed.entities.length > 0 ? parsed.entities : fallbackEntities
			);
			setEntityHighlightsEnabled(true);
			setMessages((prev) => [
				...prev,
				{
					id: nextMessageId(),
					role: 'assistant',
					content: parsed.content || response.answer,
					citations: response.citations,
					entityHighlights,
					suggestedQuestions: resolveAssistantSuggestedQuestions(response.suggestedQuestions, {
						mode: 'explain',
						scope: 'selected',
						contradiction: true,
					}),
				},
			]);
		} catch (err) {
			const message = getAxiosErrorMessage(err, 'Failed to generate a response.');
			setError(message);
			setMessages((prev) => [
				...prev,
				{ id: nextMessageId(), role: 'assistant', content: `I could not complete this request: ${message}` },
			]);
		} finally {
			setLoading(false);
		}
	};

	/** Despacha un quick-action: why (free/AI), riesgos, o texto libre. */
	const askQuickAction = async (prompt: string) => {
		if (loading) return;
		const isContradictionQuickAction =
			prompt === QUICK_ACTION_WHY_CONTRADICTION_FREE ||
			prompt === QUICK_ACTION_WHY_CONTRADICTION_AI ||
			prompt === QUICK_ACTION_CONTRADICTION_RISKS;

		if (!isContradictionQuickAction) {
			await submitContradictionQuestion(prompt);
			return;
		}

		const { selectedParagraph } = useDocumentStore.getState();
		setError(null);
		const withUser: AssistantChatMessage[] = [
			...messagesRef.current,
			{ id: nextMessageId(), role: 'user', content: prompt },
		];
		setMessages(withUser);

		if (!selectedParagraph) {
			appendAssistantQuickActionMessage(
				'Select a highlighted paragraph first, then run this contradiction quick action.'
			);
			return;
		}

		const contradiction = contradictionResultsByParagraphId?.get(selectedParagraph.id);
		if (!contradiction) {
			appendAssistantQuickActionMessage(
				'No contradiction result is available for this paragraph yet. Run "Search contradictions" first.',
				selectedParagraph.id
			);
			return;
		}
		if (!contradiction.contradiction) {
			appendAssistantQuickActionMessage(
				'This paragraph is not currently classified as contradiction.',
				selectedParagraph.id
			);
			return;
		}

		if (prompt === QUICK_ACTION_WHY_CONTRADICTION_FREE) {
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
			appendAssistantQuickActionMessage(
				[
					`Free explanation for paragraph ${selectedParagraph.id}:`,
					reason,
					`Confidence: ${confidence}%`,
					...evidenceLines,
					footerMessage,
				].join('\n\n'),
				{ citationId: selectedParagraph.id }
			);
			return;
		}

		if (prompt === QUICK_ACTION_CONTRADICTION_RISKS) {
			await submitContradictionRiskAssessment(selectedParagraph, contradiction, withUser);
			return;
		}

		await submitStructuredContradictionWhy(selectedParagraph, contradiction, withUser);
	};

	const appendFixContradictionSuggestionMessage = (suggestion: FixContradictionSuggestion) => {
		setMessages((prev) => [
			...prev,
			{
				id: nextMessageId(),
				role: 'assistant',
				content: `Structured contradiction-fix suggestion for paragraph ${suggestion.paragraphId}.`,
				citations: [{ id: suggestion.paragraphId, excerpt: '(selected paragraph)' }],
				fixContradictionSuggestion: suggestion,
			},
		]);
	};

	/** Pide y muestra una sugerencia de fix estructurada para la contradicción activa. */
	const suggestContradictionFix = async () => {
		if (rewriteBusy || loading) return;
		setError(null);
		setMessages((prev) => [
			...prev,
			{
				id: nextMessageId(),
				role: 'user',
				content:
					'Suggest a contradiction fix and structure the response with the key changes and a ready-to-apply rewrite.',
			},
		]);

		setRewriteBusy(true);
		try {
			const { selectedParagraph } = useDocumentStore.getState();
			const execution = await executeFixContradictionRewrite({
				activeDocumentId: docId || null,
				assistantProvider: provider,
				contradictionResultsByParagraphId: contradictionResultsByParagraphId ?? new Map(),
				selectedRelatedParagraphs,
				nodeEditStateById,
				fixRelatedLimit: FIX_CONTRADICTION_TOP_RELATED,
				viewer: getViewerElement?.() ?? null,
				selectedParagraphId: selectedParagraph?.id ?? null,
				paragraphElementById: paragraphElementById ?? new Map(),
				fallbackTarget: null,
				resolveErrorMessage: getAxiosErrorMessage,
				confirmLlmEstimate,
			});

			if (!execution.ok) {
				appendAssistantQuickActionMessage(
					`I could not generate a contradiction-fix suggestion: ${execution.error}`
				);
				return;
			}

			const contradiction = contradictionResultsByParagraphId?.get(execution.target.paragraphId);
			appendFixContradictionSuggestionMessage({
				paragraphId: execution.target.paragraphId,
				reason: contradiction?.brief_reason?.trim() || undefined,
				changeNotes: buildFixSuggestionChangeNotes(
					execution.result.payload.originalSnippet,
					execution.result.payload.simplifiedSnippet
				),
				rewriteResult: execution.result,
				status: 'pending',
			});
		} finally {
			setRewriteBusy(false);
		}
	};

	/** Aplica una sugerencia de fix al párrafo y marca el mensaje como "applied". */
	const acceptFixSuggestion = async (messageId: string) => {
		const message = messagesRef.current.find((entry) => entry.id === messageId);
		const suggestion = message?.fixContradictionSuggestion;
		if (!suggestion || suggestion.status === 'applied') return;

		const applied = applyRewriteToParagraph({
			simplifyResult: suggestion.rewriteResult,
			paragraphElementById: paragraphElementById ?? new Map(),
		});
		if (!applied.ok) {
			const failureReason = applied.error ?? 'Failed to apply suggestion.';
			setMessages((prev) => [
				...prev,
				{
					id: nextMessageId(),
					role: 'assistant',
					content: `Could not apply the suggestion: ${failureReason}`,
				},
			]);
			setError(failureReason);
			return;
		}

		const appliedParagraphId = applied.paragraphId ?? suggestion.paragraphId;
		const selectedNode =
			useDocumentStore.getState().paragraphs.find((node) => node.id === appliedParagraphId) ?? null;
		if (selectedNode) useDocumentStore.getState().setSelectedParagraph(selectedNode);

		setMessages((prev) => [
			...prev.map((entry) =>
				entry.id === messageId && entry.fixContradictionSuggestion
					? {
							...entry,
							fixContradictionSuggestion: {
								...entry.fixContradictionSuggestion,
								status: 'applied' as const,
							},
						}
					: entry
			),
			{
				id: nextMessageId(),
				role: 'assistant',
				content: `Suggestion applied directly to paragraph ${appliedParagraphId}.`,
				citations: [{ id: appliedParagraphId, excerpt: '(updated paragraph)' }],
			},
		]);
		setError(null);
	};

	const toggleEntityHighlights = () => setEntityHighlightsEnabled((prev) => !prev);

	// Entidades activas del chat de contradicción (último mensaje con highlights),
	// para resaltarlas también en el cuerpo del documento mientras el toggle esté on.
	const contradictionEntities = useMemo(() => {
		if (!entityHighlightsEnabled) return [];
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const highlights = messages[index].entityHighlights;
			if (highlights && highlights.length > 0) return highlights;
		}
		return [];
	}, [messages, entityHighlightsEnabled]);

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
		entityHighlightsEnabled,
		contradictionEntities,
		rewriteBusy,
		setScope,
		setProvider,
		setInput,
		submit,
		handleKeydown,
		// Chat de contradicción (compartido):
		askQuickAction,
		suggestContradictionFix,
		acceptFixSuggestion,
		toggleEntityHighlights,
		submitContradictionQuestion,
		handleContradictionKeydown,
	};
}
