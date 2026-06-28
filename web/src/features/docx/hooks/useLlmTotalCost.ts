'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchLlmTotalCost } from '@/services/llm';

export const LLM_TOTAL_COST_QUERY_KEY = ['llm', 'total-cost'] as const;

/** Coste acumulado de LLM (cacheado; se muestra en el header del visor). */
export function useLlmTotalCost() {
	return useQuery({
		queryKey: LLM_TOTAL_COST_QUERY_KEY,
		queryFn: fetchLlmTotalCost,
	});
}
