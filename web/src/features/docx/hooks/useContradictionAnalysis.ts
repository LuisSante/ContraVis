'use client';

import { useCallback, useMemo, useState } from 'react';
import { useDocumentStore } from '@/stores/document';
import { fetchSavedContradictions } from '@/services/contradiction';
import { getAxiosErrorMessage } from '@/features/docx/utils/http-error';
import {
	buildContradictionCandidateKey,
	buildContradictionSourceLookups,
	hasUsableContradictionEvidence,
	normalizeContradictionCandidates,
	repairEvidenceForParagraph,
} from '@/features/docx/utils/contradiction';
import { CONTRADICTION_TAXONOMY_COLORS } from '@/constants/docx-viewer';
import type {
	ContradictionFinding,
	ContradictionGraphMode,
	ContradictionParagraphResult,
	ContradictionTaxonomyType,
	Edge as GraphEdge,
	ParagraphEditState,
} from '@/types/document';

export interface ContradictionSummaryItem {
	paragraphId: string;
	label: string;
	contradictionType: ContradictionTaxonomyType;
}

interface UseContradictionAnalysisParams {
	docId: string;
	nodeEditStateById: Map<string, ParagraphEditState>;
	/** Aristas del grafo de relaciones; vacío hasta portar el feature de related. */
	backendEdges?: GraphEdge[];
}

/**
 * Estado y carga del análisis de contradicciones. Ingesta los resultados del
 * backend (normaliza candidatos, repara evidencia, dedup, rankea) y deriva el
 * resultado/evidencia del párrafo seleccionado y la lista resumen.
 *
 * Slice actual: carga de contradicciones **guardadas**. El run con LLM (+coste)
 * y el grafo se difieren.
 */
export function useContradictionAnalysis({
	docId,
	nodeEditStateById,
	backendEdges = [],
}: UseContradictionAnalysisParams) {
	const nodes = useDocumentStore((s) => s.paragraphs);
	const selectedParagraph = useDocumentStore((s) => s.selectedParagraph);

	const [resultsByParagraphId, setResultsByParagraphId] = useState<
		Map<string, ContradictionParagraphResult>
	>(new Map());
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [hasTriggered, setHasTriggered] = useState(false);
	const [graphMode] = useState<ContradictionGraphMode>('without_kg');

	const ingestResults = useCallback(
		(results: ContradictionParagraphResult[]) => {
			const next = new Map<string, ContradictionParagraphResult>();
			const seenGlobalKeys = new Set<string>();
			const sourceLookups = buildContradictionSourceLookups({
				nodes,
				nodeEditStateById,
				backendEdges,
			});

			for (const row of results) {
				const rowId = String(row.paragraph_id);
				const candidates = normalizeContradictionCandidates(row).map((candidate) => {
					if (!hasUsableContradictionEvidence(candidate.evidence)) return candidate;
					return {
						...candidate,
						evidence: repairEvidenceForParagraph(rowId, candidate.evidence, sourceLookups),
					};
				});

				const uniqueCandidates: ContradictionFinding[] = [];
				for (const candidate of candidates) {
					const key = buildContradictionCandidateKey(candidate);
					if (!key || seenGlobalKeys.has(key)) continue;
					seenGlobalKeys.add(key);
					uniqueCandidates.push(candidate);
				}

				const primary = uniqueCandidates[0];
				if (!primary) {
					next.set(rowId, {
						...row,
						contradiction: false,
						confidence: 0,
						brief_reason: '',
						contradiction_type: null,
						evidence: null,
						contradictions: [],
					});
					continue;
				}

				next.set(rowId, {
					...row,
					contradiction: true,
					confidence: Math.min(100, Math.max(0, Number(primary.confidence || 0))),
					brief_reason: (primary.brief_reason || '').trim(),
					contradiction_type: primary.contradiction_type ?? 'specificity',
					evidence: primary.evidence ?? null,
					contradictions: uniqueCandidates,
				});
			}

			setResultsByParagraphId(next);
		},
		[nodes, nodeEditStateById, backendEdges]
	);

	const loadSavedContradictions = useCallback(async () => {
		setHasTriggered(true);
		setLoading(true);
		setError(null);
		try {
			const response = await fetchSavedContradictions(docId, graphMode);
			ingestResults(response.paragraphResults ?? []);
		} catch (err) {
			setError(getAxiosErrorMessage(err, 'Could not load contradictions.'));
		} finally {
			setLoading(false);
		}
	}, [docId, graphMode, ingestResults]);

	const summaryItems = useMemo<ContradictionSummaryItem[]>(() => {
		const items: Array<ContradictionSummaryItem & { paragraphEnum: number }> = [];
		for (const [paragraphId, row] of resultsByParagraphId.entries()) {
			if (!row.contradiction) continue;
			const match = paragraphId.match(/-p-(\d+)$/);
			const paragraphEnum = match ? Number(match[1]) : Number.POSITIVE_INFINITY;
			const label = match ? `p-${match[1]}` : paragraphId;
			items.push({
				paragraphId,
				label,
				paragraphEnum,
				contradictionType: row.contradiction_type ?? 'specificity',
			});
		}
		items.sort(
			(left, right) =>
				left.paragraphEnum - right.paragraphEnum ||
				left.paragraphId.localeCompare(right.paragraphId)
		);
		return items.map(({ paragraphId, label, contradictionType }) => ({
			paragraphId,
			label,
			contradictionType,
		}));
	}, [resultsByParagraphId]);

	const selectedContradictionResult = useMemo<ContradictionParagraphResult | null>(
		() => (selectedParagraph ? (resultsByParagraphId.get(selectedParagraph.id) ?? null) : null),
		[selectedParagraph, resultsByParagraphId]
	);

	const selectedContradictionEvidence =
		selectedContradictionResult?.contradiction && selectedContradictionResult.evidence
			? selectedContradictionResult.evidence
			: null;

	const selectedContradictionCategoryColor =
		selectedContradictionResult?.contradiction_type &&
		CONTRADICTION_TAXONOMY_COLORS[selectedContradictionResult.contradiction_type]
			? CONTRADICTION_TAXONOMY_COLORS[selectedContradictionResult.contradiction_type]
			: CONTRADICTION_TAXONOMY_COLORS.specificity;

	return {
		resultsByParagraphId,
		loading,
		error,
		hasTriggered,
		graphMode,
		summaryItems,
		contradictionCount: summaryItems.length,
		selectedContradictionResult,
		selectedContradictionEvidence,
		selectedContradictionCategoryColor,
		loadSavedContradictions,
	};
}
