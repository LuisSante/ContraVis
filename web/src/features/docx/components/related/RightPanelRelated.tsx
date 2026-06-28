'use client';

import { ProcessingIndicator, type ProcessingStep } from '@/components/common/ProcessingIndicator';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
	formatReferenceSummary,
	getNodeCurrentText,
	truncateText,
} from '@/features/docx/utils/edit/edit';
import type {
	Node as ParagraphNode,
	ParagraphEditState,
	RelatedParagraph,
} from '@/types/document';

interface RightPanelRelatedProps {
	selectedParagraph: ParagraphNode | null;
	loading: boolean;
	selectedRelatedParagraphs: RelatedParagraph[];
	nodeEditStateById: Map<string, ParagraphEditState>;
	onFocusNodeFromPanel: (nodeId: string) => void;
}

const RELATED_PROCESSING_STEPS: ProcessingStep[] = [
	{ label: 'Scanning document structure', active: false },
	{ label: 'Analyzing paragraph relations', active: false },
	{ label: 'Searching linked context', active: false },
];

function hasSemanticRelation(related: RelatedParagraph): boolean {
	return (
		related.relationTypes.includes('semantic_similarity') ||
		typeof related.semanticScore === 'number'
	);
}

function hasReferenceRelation(related: RelatedParagraph): boolean {
	return (
		related.relationTypes.includes('reference') ||
		related.relationTypes.some((relationType) =>
			String(relationType).toLowerCase().includes('reference')
		) ||
		related.references.length > 0
	);
}

/**
 * "Related Paragraphs" panel: shows the paragraphs linked to the selected one
 * (cross-references + semantic similarity) coming from the backend graph.
 */
export function RightPanelRelated({
	selectedParagraph,
	loading,
	selectedRelatedParagraphs,
	nodeEditStateById,
	onFocusNodeFromPanel,
}: RightPanelRelatedProps) {
	return (
		<section className="flex min-h-0 flex-1 flex-col">
			<header className="border-b border-gray-100 bg-gray-50 px-4 py-2">
				<p className="text-[11px] text-gray-500">
					View linked paragraphs, relation types, and semantic similarity context.
				</p>
			</header>

			<ScrollArea className="min-h-0 flex-1 bg-gray-50/30">
				<div className="flex min-h-full flex-col space-y-2 p-2">
					<div className="rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1 text-[10px] text-blue-800">
						Tip: hold <span className="font-semibold">Shift + Scroll</span> to bring related
						paragraphs closer.
					</div>

					{loading ? (
						<ProcessingIndicator steps={RELATED_PROCESSING_STEPS} />
					) : !selectedParagraph ? (
						<div className="flex min-h-full flex-1 flex-col items-center justify-center text-gray-500">
							<p className="text-[10px] italic">Select a paragraph to see its related paragraphs.</p>
						</div>
					) : selectedRelatedParagraphs.length === 0 ? (
						<div className="flex flex-1 flex-col items-center justify-center py-12 text-gray-300">
							<p className="text-[10px] italic">No relations found for this element</p>
						</div>
					) : (
						selectedRelatedParagraphs.map((related) => (
							<button
								key={related.node.id}
								type="button"
								className="group rounded-lg border border-gray-200 bg-white p-3 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
								onClick={() => onFocusNodeFromPanel(related.node.id)}
							>
								<div className="mb-2 flex items-center justify-between">
									<div className="flex flex-wrap items-center gap-1.5">
										{hasSemanticRelation(related) && (
											<Badge
												variant="outline"
												className="flex h-4 items-center justify-center border-green-500 bg-green-100 px-2 text-[9px] font-semibold text-green-600"
											>
												Similarity
											</Badge>
										)}
										{hasReferenceRelation(related) && (
											<Badge
												variant="outline"
												className="flex h-4 items-center justify-center border-blue-500 bg-blue-100 px-1.5 text-[9px] font-semibold text-blue-600"
											>
												Reference
											</Badge>
										)}
									</div>
								</div>

								<p className="text-[11px] leading-relaxed text-gray-600">
									{truncateText(getNodeCurrentText(nodeEditStateById, related.node))}
								</p>

								{related.references.length > 0 && (
									<p className="mt-2 text-[10px] text-gray-500">
										Refs: {formatReferenceSummary(related.references)}
									</p>
								)}
							</button>
						))
					)}
				</div>
			</ScrollArea>
		</section>
	);
}
