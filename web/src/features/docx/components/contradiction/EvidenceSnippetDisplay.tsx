'use client';

import { useMemo } from 'react';

import { Button } from '@/components/ui/button';
import { hexToRgba } from '@/features/docx/utils/contradiction/contradiction';
import type { ContradictionParagraphResult } from '@/types/document';

import { buildEvidenceDiffSegments, resolveSnippetBStyle } from '@/features/docx/components/contradiction/contradiction-style';

interface EvidenceSnippetDisplayProps {
	snippetA: string;
	snippetB: string;
	/** Taxonomy color used for the Snippet A highlight / border. */
	typeColor: string;
	selectedContradictionResult: ContradictionParagraphResult | null;
	onFocusEvidenceSnippet: (paragraphId: string, role: 'a' | 'b') => void;
}

/**
 * Renders the two contradiction evidence snippets (A and B) with the
 * word-level diff highlight. Clicking a snippet focuses it in the document.
 */
export function EvidenceSnippetDisplay({
	snippetA,
	snippetB,
	typeColor,
	selectedContradictionResult,
	onFocusEvidenceSnippet,
}: EvidenceSnippetDisplayProps) {
	const snippetBStyle = useMemo(
		() => resolveSnippetBStyle(selectedContradictionResult),
		[selectedContradictionResult],
	);
	const evidenceDiff = useMemo(
		() => buildEvidenceDiffSegments(snippetA, snippetB),
		[snippetA, snippetB],
	);

	return (
		<>
			<div
				className="mt-2 rounded-md border px-2.5 py-2"
				style={{ borderColor: typeColor, background: hexToRgba(typeColor, 0.08) }}
			>
				<div className="mb-1 flex items-center justify-between">
					<span className="text-[9px] font-semibold" style={{ color: typeColor }}>
						Snippet A
					</span>
				</div>
				<Button
					variant="ghost"
					className="h-auto w-full min-w-0 items-start justify-start px-0 py-0 text-left text-[11px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-normal text-gray-700 hover:bg-transparent hover:text-gray-900"
					onClick={() =>
						selectedContradictionResult &&
						onFocusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'a')
					}
				>
					<span>
						{evidenceDiff.a.map((part, partIndex) =>
							part.changed ? (
								<span
									key={`a-${partIndex}`}
									className="rounded px-[1px]"
									style={{
										background: hexToRgba(typeColor, 0.36),
										boxShadow: `inset 0 0 0 1px ${hexToRgba(typeColor, 0.7)}`,
										color: '#1f2937',
										fontWeight: 700,
									}}
								>
									{part.text}
								</span>
							) : (
								<span key={`a-${partIndex}`}>{part.text}</span>
							),
						)}
					</span>
				</Button>
			</div>

			<div
				className="mt-2 rounded-md border px-2.5 py-2"
				style={{ borderColor: snippetBStyle.border, background: snippetBStyle.background }}
			>
				<div className="mb-1 flex items-center justify-between">
					<div className="flex items-center gap-1.5">
						<span className="text-[9px] font-semibold" style={{ color: snippetBStyle.color }}>
							Snippet B
						</span>
					</div>
				</div>
				<Button
					variant="ghost"
					className="h-auto w-full min-w-0 items-start justify-start px-0 py-0 text-left text-[11px] leading-relaxed [overflow-wrap:anywhere] break-words whitespace-normal text-gray-700 hover:bg-transparent hover:text-gray-800"
					onClick={() =>
						selectedContradictionResult &&
						onFocusEvidenceSnippet(selectedContradictionResult.paragraph_id, 'b')
					}
				>
					<span>
						{evidenceDiff.b.map((part, partIndex) =>
							part.changed ? (
								<span
									key={`b-${partIndex}`}
									className="rounded px-[1px]"
									style={{
										background: hexToRgba(snippetBStyle.color, 0.36),
										boxShadow: `inset 0 0 0 1px ${hexToRgba(snippetBStyle.color, 0.7)}`,
										color: '#1f2937',
										fontWeight: 700,
									}}
								>
									{part.text}
								</span>
							) : (
								<span key={`b-${partIndex}`}>{part.text}</span>
							),
						)}
					</span>
				</Button>
			</div>
		</>
	);
}
