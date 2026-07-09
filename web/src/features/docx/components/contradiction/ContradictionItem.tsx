'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { hexToRgba } from '@/features/docx/utils/contradiction/contradiction';
import type { ContradictionParagraphResult } from '@/types/document';

import { resolveEvidenceScopeLabel } from '@/features/docx/components/contradiction/contradiction-style';
import { EvidenceSnippetDisplay } from '@/features/docx/components/contradiction/EvidenceSnippetDisplay';

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
			className="border-t bg-card/80 p-2 text-2xs"
			style={{ borderColor: hexToRgba(typeColor, 0.28) }}
		>
			<div className="mb-2 flex items-center justify-between">
				<p className="text-2xs font-semibold" style={{ color: typeColor }}>
					Contradiction Evidence
				</p>
				{selectedContradictionEvidence ? (
					<Badge
						variant="outline"
						className="h-4 rounded-full bg-card px-1.5 text-2xs font-semibold"
						style={{ borderColor: typeColor, color: typeColor }}
					>
						{resolveEvidenceScopeLabel(selectedContradictionEvidence)}
					</Badge>
				) : null}
			</div>

			<Card className="gap-0 rounded-md border-border py-0 shadow-none">
				<CardHeader className="gap-0 px-2.5 pt-2 pb-1">
					<CardTitle className="text-2xs font-semibold text-foreground">Assessment</CardTitle>
				</CardHeader>
				<CardContent className="px-2.5 pb-2">
					<p className="text-2xs leading-relaxed text-foreground">
						{selectedContradictionResult?.brief_reason}
					</p>
				</CardContent>
			</Card>

			{hasSnippets ? (
				<EvidenceSnippetDisplay
					snippetA={selectedContradictionEvidence?.snippet_a ?? ''}
					snippetB={selectedContradictionEvidence?.snippet_b ?? ''}
					typeColor={typeColor}
					selectedContradictionResult={selectedContradictionResult}
					onFocusEvidenceSnippet={onFocusEvidenceSnippet}
				/>
			) : (
				<Card className="mt-1 gap-0 border-border bg-muted py-0 text-2xs">
					<CardContent className="px-3 py-2 text-muted-foreground">
						Evidence snippets are unavailable for this contradiction.
					</CardContent>
				</Card>
			)}
		</div>
	);
}
