'use client';

import { useMemo, useState } from 'react';

import { ProcessingIndicator, type ProcessingStep } from '@/components/common/ProcessingIndicator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { ExplanationEntity } from '@/features/docx/utils/assistant/paragraph-explanation';
import type { Node as ParagraphNode } from '@/types/document';

import { ExplanationText } from '@/features/docx/components/paragraph-explanation/ExplanationText';

interface RightPanelParagraphExplanationProps {
	selectedParagraph: ParagraphNode | null;
	loading: boolean;
	error: string | null;
	explanationShort: string;
	explanationDetailed: string;
	explanationEntities: ExplanationEntity[];
	onFocusParagraph: (paragraphId: string) => void;
}

const EXPLANATION_PROCESSING_STEPS: ProcessingStep[] = [
	{ label: 'Reading selected paragraph', active: false },
	{ label: 'Analyzing related context', active: false },
	{ label: 'Drafting plain-language explanation', active: false },
];

export function RightPanelParagraphExplanation({
	selectedParagraph,
	loading,
	error,
	explanationShort,
	explanationDetailed,
	explanationEntities,
}: RightPanelParagraphExplanationProps) {
	const [isDetailedExpanded, setIsDetailedExpanded] = useState(false);

	const hasDetailedExplanation = useMemo(
		() =>
			Boolean(explanationDetailed.trim()) &&
			explanationDetailed.trim() !== explanationShort.trim(),
		[explanationDetailed, explanationShort],
	);

	// Mirror the Svelte reactive guard that collapses the detailed section
	// whenever there is no detailed explanation to show. Derived during render
	// (instead of an effect) so the section never appears when detail is absent.
	const showDetailed = hasDetailedExplanation && isDetailedExpanded;

	return (
		<section className="flex min-h-0 flex-1 flex-col">
			<header className="border-b border-gray-100 bg-gray-50 px-4 py-2">
				<p className="text-[11px] text-gray-500">
					Detailed explanation for the selected paragraph.
				</p>
			</header>

			<ScrollArea className="min-h-0 flex-1 bg-gray-50/30">
				<div className="flex min-h-full flex-col gap-2 p-3">
					{!selectedParagraph ? (
						<div className="flex min-h-full flex-1 flex-col items-center justify-center text-gray-500">
							<p className="text-[10px] italic">Select a paragraph on the left.</p>
						</div>
					) : (
						<>
							{loading ? (
								<ProcessingIndicator steps={EXPLANATION_PROCESSING_STEPS} />
							) : null}

							{error ? (
								<div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">
									{error}
								</div>
							) : null}

							{/* Simplify / rewrite result (ParagraphRewriteResult) intentionally
							    not ported in this migration step. */}

							{explanationShort ? (
								<div className="rounded border border-gray-200 bg-white px-3 py-2">
									<div className="mb-1">
										<Badge
											variant="outline"
											className="h-4 border-blue-100 bg-blue-50 px-1.5 text-[9px] font-semibold text-blue-600"
										>
											Short explain
										</Badge>
									</div>
									<ExplanationText
										value={explanationShort}
										entities={explanationEntities}
										keyPrefix="explanation-short-ref"
									/>

									{hasDetailedExplanation ? (
										<button
											type="button"
											className="mt-2 text-[10px] font-semibold text-blue-700 transition hover:text-blue-800"
											onClick={() => setIsDetailedExpanded((prev) => !prev)}
										>
											{isDetailedExpanded
												? 'Ver menos detalhes'
												: 'Ver explicacao aprofundada'}
										</button>
									) : null}

									{showDetailed ? (
										<div className="mt-2 border-t border-gray-100 pt-2">
											<div className="mb-1">
												<Badge
													variant="outline"
													className="h-4 border-indigo-100 bg-indigo-50 px-1.5 text-[9px] font-semibold text-blue-600"
												>
													Detailed explain
												</Badge>
											</div>
											<ExplanationText
												value={explanationDetailed}
												entities={explanationEntities}
												keyPrefix="explanation-detailed-ref"
											/>
										</div>
									) : null}

									{explanationEntities.length > 0 ? (
										<div className="mt-2 flex flex-wrap gap-1 border-t border-gray-100 pt-2">
											{explanationEntities.map((entity) => (
												<span
													key={entity.key}
													className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium"
													style={{
														color: entity.color,
														backgroundColor: entity.softColor,
													}}
												>
													{entity.label}
												</span>
											))}
										</div>
									) : null}
								</div>
							) : null}
						</>
					)}
				</div>
			</ScrollArea>
		</section>
	);
}
