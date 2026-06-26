'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { hexToRgba } from '@/features/docx/utils/contradiction';
import type { ContradictionParagraphResult } from '@/types/document';

import { resolveEvidenceScopeLabel } from './contradiction-style';
import { EvidenceSnippetDisplay } from './EvidenceSnippetDisplay';

interface ContradictionItemProps {
	/** Taxonomy color of the owning summary item. */
	typeColor: string;
	selectedContradictionResult: ContradictionParagraphResult | null;
	selectedContradictionEvidence: ContradictionParagraphResult['evidence'];
	onFocusEvidenceSnippet: (paragraphId: string, role: 'a' | 'b') => void;
}

/**
 * The expanded evidence card for the selected contradiction: taxonomy scope
 * badge, the assessment reason, and snippet A/B with word-diff. Renders below
 * the summary button when its paragraph is selected and is a contradiction.
 */
export function ContradictionItem({
	typeColor,
	selectedContradictionResult,
	selectedContradictionEvidence,
	onFocusEvidenceSnippet,
}: ContradictionItemProps) {
	const hasSnippets =
		!!selectedContradictionEvidence?.snippet_a?.trim() &&
		!!selectedContradictionEvidence?.snippet_b?.trim();

	return (
		<div
			className="border-t bg-white/80 p-2 text-[11px]"
			style={{ borderColor: hexToRgba(typeColor, 0.28) }}
		>
			<div className="mb-2 flex items-center justify-between">
				<p className="text-[9px] font-semibold" style={{ color: typeColor }}>
					Contradiction Evidence
				</p>
				{selectedContradictionEvidence ? (
					<Badge
						variant="outline"
						className="h-4 rounded-full bg-white px-1.5 text-[8px] font-semibold"
						style={{ borderColor: typeColor, color: typeColor }}
					>
						{resolveEvidenceScopeLabel(selectedContradictionEvidence)}
					</Badge>
				) : null}
			</div>

			<div className="rounded-md border border-gray-200 bg-white px-2.5 py-2">
				<p className="mb-1 text-[9px] font-semibold text-gray-700">Assessment</p>
				<p className="text-[10px] leading-relaxed text-gray-700">
					{selectedContradictionResult?.brief_reason}
				</p>
			</div>

			{hasSnippets ? (
				<EvidenceSnippetDisplay
					snippetA={selectedContradictionEvidence?.snippet_a ?? ''}
					snippetB={selectedContradictionEvidence?.snippet_b ?? ''}
					typeColor={typeColor}
					selectedContradictionResult={selectedContradictionResult}
					onFocusEvidenceSnippet={onFocusEvidenceSnippet}
				/>
			) : (
				<Card className="mt-1 gap-0 border-gray-200 bg-gray-50 py-0 text-[11px]">
					<CardContent className="px-3 py-2 text-gray-600">
						Evidence snippets are unavailable for this contradiction.
					</CardContent>
				</Card>
			)}
		</div>
	);
}
