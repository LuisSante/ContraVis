'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { hexToRgba } from '@/features/docx/utils/contradiction/contradiction';
import { cn } from '@/lib/utils';
import type {
	ContradictionParagraphResult,
	ContradictionTaxonomyType,
	Node as ParagraphNode,
} from '@/types/document';

import { resolveContradictionTypeStyle } from '@/features/docx/components/contradiction/contradiction-style';
import { ContradictionItemsList } from '@/features/docx/components/contradiction/ContradictionItemsList';

export interface ContradictionSummaryItem {
	paragraphId: string;
	label: string;
	contradictionType: ContradictionTaxonomyType;
}

interface ContradictionSummaryProps {
	selectedParagraph: ParagraphNode | null;
	contradictionSummaryItems: ContradictionSummaryItem[];
	selectedContradictionResult: ContradictionParagraphResult | null;
	selectedContradictionEvidence: ContradictionParagraphResult['evidence'];
	onFocusEvidenceSnippet: (paragraphId: string, role: 'a' | 'b') => void;
	onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void;
}

/**
 * The list of contradictory paragraphs. Each row is a clickable button that
 * focuses its paragraph in the document; when selected (and confirmed as a
 * contradiction) it expands to show the evidence cards.
 */
export function ContradictionSummary({
	selectedParagraph,
	contradictionSummaryItems,
	selectedContradictionResult,
	selectedContradictionEvidence,
	onFocusEvidenceSnippet,
	onFocusNodeFromPanel,
}: ContradictionSummaryProps) {
	return (
		<div className="mt-1 mb-2 flex flex-col gap-2">
			{contradictionSummaryItems.map((item, index) => {
				const itemStyle = resolveContradictionTypeStyle(item.contradictionType);
				const isSelected = selectedParagraph?.id === item.paragraphId;
				return (
					<Card
						key={item.paragraphId}
						className={cn(
							'gap-0 overflow-hidden rounded-lg border py-0 shadow-none transition-[border-color,box-shadow,background-color] duration-200',
							isSelected
								? 'shadow-[0_4px_12px_rgba(15,23,42,0.08)]'
								: 'hover:shadow-[0_2px_10px_rgba(15,23,42,0.08)]',
						)}
						style={{
							borderColor: itemStyle.borderSoft,
							background: isSelected
								? hexToRgba(itemStyle.color, 0.12)
								: hexToRgba(itemStyle.color, 0.04),
						}}
					>
						<button
							type="button"
							className={cn(
								'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11px] transition',
								isSelected
									? 'font-semibold'
									: 'cursor-pointer text-gray-700 hover:bg-white/70',
							)}
							style={
								isSelected
									? { background: hexToRgba(itemStyle.color, 0.16), color: itemStyle.color }
									: { color: '#374151' }
							}
							onClick={() => onFocusNodeFromPanel(item.paragraphId, true)}
						>
							<span className="inline-flex items-center gap-2">
								<span
									className="inline-block size-2 shrink-0 rounded-full"
									style={{ background: itemStyle.color }}
									aria-hidden="true"
								/>
								<span>Contradiction {index + 1}</span>
							</span>
							<Badge
								variant="outline"
								className="h-4 rounded-full bg-white px-1.5 text-[8px] font-semibold"
								style={{ borderColor: itemStyle.color, color: itemStyle.color }}
							>
								{itemStyle.label}
							</Badge>
						</button>

						{isSelected && selectedContradictionResult?.contradiction ? (
							<ContradictionItemsList
								typeColor={itemStyle.color}
								selectedContradictionResult={selectedContradictionResult}
								selectedContradictionEvidence={selectedContradictionEvidence}
								onFocusEvidenceSnippet={onFocusEvidenceSnippet}
							/>
						) : null}
					</Card>
				);
			})}
		</div>
	);
}
