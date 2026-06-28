'use client';

import { useCallback, useRef, useState } from 'react';
import { fetchLlmEstimate } from '@/services/llm';
import type {
	AssistantChatRequest,
	ContradictionAnalysisRequest,
	LlmEstimateCallType,
	LlmEstimateRequest,
	LlmEstimateResponse,
	SimplifySelectionRequest,
} from '@/types/document';

type ConfirmPayload =
	| AssistantChatRequest
	| SimplifySelectionRequest
	| ContradictionAnalysisRequest;

function buildEstimateRequest(
	callType: LlmEstimateCallType,
	payload: ConfirmPayload
): LlmEstimateRequest {
	if (callType === 'assistant_chat') {
		return { callType, assistantChat: payload as AssistantChatRequest };
	}
	if (callType === 'contradictions_analyze') {
		return { callType, contradictionAnalysis: payload as ContradictionAnalysisRequest };
	}
	return { callType, simplifySelection: payload as SimplifySelectionRequest };
}

/**
 * Confirmación de coste LLM: ante cada llamada se pide una estimación al backend
 * (`/llm/estimate`), se muestra un toast y se espera la decisión del usuario.
 * `confirm` devuelve una promesa que resuelve `true`/`false`. Port del
 * `confirmLlmEstimate` + toast del Svelte `+page.svelte`.
 */
export function useLlmEstimate() {
	const [estimate, setEstimate] = useState<LlmEstimateResponse | null>(null);
	const [isOpen, setIsOpen] = useState(false);
	const resolverRef = useRef<((approved: boolean) => void) | null>(null);

	const resolve = useCallback((approved: boolean) => {
		if (!resolverRef.current) return;
		resolverRef.current(approved);
		resolverRef.current = null;
		setEstimate(null);
		setIsOpen(false);
	}, []);

	const confirm = useCallback(
		async (callType: LlmEstimateCallType, payload: ConfirmPayload): Promise<boolean> => {
			const next = await fetchLlmEstimate(buildEstimateRequest(callType, payload));
			// Si había una confirmación pendiente, se cancela antes de abrir la nueva.
			if (resolverRef.current) {
				resolverRef.current(false);
				resolverRef.current = null;
			}
			setEstimate(next);
			setIsOpen(true);
			return new Promise<boolean>((res) => {
				resolverRef.current = res;
			});
		},
		[]
	);

	return { estimate, isOpen, confirm, resolve };
}
