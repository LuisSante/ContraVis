'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useDocumentStore } from '@/stores/document';
import { fetchBackendGraph } from '@/services/graph';
import { updateRelationBadge } from '@/features/docx/utils/docx-engine/docx-page';
import { buildRelatedParagraphs } from '@/features/docx/utils/edit/edit';
import type { DocumentViewerMaps } from '@/features/docx/hooks/useDocumentViewer';
import type { Edge as GraphEdge, RelatedParagraph } from '@/types/document';

interface UseRelatedGraphParams {
	docId: string;
	maps: DocumentViewerMaps;
}

/**
 * Grafo de relaciones de párrafos: pide `/process` al backend (referencias +
 * similitud semántica), aplica el badge de conteo a cada párrafo del documento y
 * deriva la lista de relacionados del párrafo seleccionado.
 *
 * Difiere: las líneas conectoras y los marcadores laterales de related.
 */
export function useRelatedGraph({ docId, maps }: UseRelatedGraphParams) {
	const nodes = useDocumentStore((s) => s.paragraphs);
	const selectedParagraph = useDocumentStore((s) => s.selectedParagraph);
	const setParagraphs = useDocumentStore((s) => s.setParagraphs);

	const [edges, setEdges] = useState<GraphEdge[]>([]);
	const [loading, setLoading] = useState(false);
	const [computed, setComputed] = useState(false);
	const tokenRef = useRef(0);

	const recompute = useCallback(async () => {
		const token = ++tokenRef.current;
		const snapshot = useDocumentStore.getState().paragraphs;
		if (!docId || snapshot.length === 0) {
			setEdges([]);
			return;
		}
		setLoading(true);
		try {
			const { edges: nextEdges, relationsByNodeId } = await fetchBackendGraph(
				docId,
				snapshot,
				maps.nodeEditStateById.current
			);
			if (token !== tokenRef.current) return;

			setEdges(nextEdges);

			const counts = maps.relationsCountByNodeId.current;
			counts.clear();
			for (const node of snapshot) {
				const count = relationsByNodeId.get(node.id) ?? 0;
				counts.set(node.id, count);
				updateRelationBadge(maps.paragraphRelationHostById.current, counts, node.id);
			}

			setParagraphs(
				snapshot.map((node) => ({ ...node, relationsCount: counts.get(node.id) ?? 0 }))
			);
			setComputed(true);
		} catch (error) {
			if (token === tokenRef.current) {
				console.error('Failed to compute backend graph edges:', error);
				setEdges([]);
				// Marca como "intentado" para no bloquear el documento indefinidamente.
				setComputed(true);
			}
		} finally {
			if (token === tokenRef.current) setLoading(false);
		}
	}, [docId, maps, setParagraphs]);

	const selectedRelatedParagraphs = useMemo<RelatedParagraph[]>(
		() =>
			selectedParagraph ? buildRelatedParagraphs(selectedParagraph, { nodes, edges }) : [],
		[selectedParagraph, nodes, edges]
	);

	return { edges, loading, computed, selectedRelatedParagraphs, recompute };
}
