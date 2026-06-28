'use client';

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { GLOBAL_ANALYSIS_MODEL_OPTIONS } from '@/constants/docx-viewer';

interface DocxPageHeaderProps {
	documentName: string | null;
	costLabel: string | null;
	model: string;
	onModelChange: (value: string) => void;
	modelDisabled?: boolean;
}

/**
 * Top header of the viewer: "Document" label + name, accumulated LLM cost, and
 * global model selector (Contradiction Analysis + Paragraph Explanation).
 */
export function DocxPageHeader({
	documentName,
	costLabel,
	model,
	onModelChange,
	modelDisabled,
}: DocxPageHeaderProps) {
	return (
		<header className="flex flex-none items-center gap-3 border-b border-gray-200/90 bg-white/90 px-4 py-3 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur supports-[backdrop-filter]:bg-white/75">
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<p className="shrink-0 text-[11px] text-gray-500">Document</p>
				<div className="min-w-0 truncate text-sm font-medium text-gray-800">
					{documentName || 'No document selected'}
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-3">
				{costLabel && (
					<div
						className="text-[12px] font-medium text-gray-500"
						title="Total accumulated real LLM usage cost"
					>
						{costLabel}
					</div>
				)}
				<Select value={model} onValueChange={onModelChange} disabled={modelDisabled}>
					<SelectTrigger
						size="sm"
						className="h-7 w-[88px] shrink-0 border-gray-200 bg-white px-1.5 text-[10px] text-gray-600"
						title="Global model for Contradiction Analysis and Paragraph Explanation"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="min-w-0">
						{GLOBAL_ANALYSIS_MODEL_OPTIONS.map((option) => (
							<SelectItem
								key={option.value}
								value={option.value}
								className="text-[10px] whitespace-nowrap"
							>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</header>
	);
}
