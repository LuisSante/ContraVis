'use client';

import { useQuery } from '@tanstack/react-query';
import { listDocuments } from '@/services/documents';

export const DOCUMENTS_QUERY_KEY = ['documents'] as const;

/** Lista de documentos del dataset (cacheada y deduplicada por TanStack Query). */
export function useDocuments() {
	return useQuery({
		queryKey: DOCUMENTS_QUERY_KEY,
		queryFn: listDocuments,
	});
}
