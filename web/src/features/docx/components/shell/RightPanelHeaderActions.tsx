'use client';

import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select';
import { PROVIDER_OPTIONS } from '@/constants/docx-viewer';
import type { AssistantProvider, AssistantScope, RightPanelTab } from '@/types/document';

const ACTION_BTN =
	'h-7 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100';

interface RightPanelHeaderActionsProps {
	activeTab: RightPanelTab;
	// analysis
	contradictionLoading: boolean;
	relatedLoading: boolean;
	onLoadSaved: () => void;
	onSearch: () => void;
	// paragraph_explanation
	explanationDisabled: boolean;
	onExplain: () => void;
	// assistant
	provider: AssistantProvider;
	onProviderChange: (provider: AssistantProvider) => void;
	scope: AssistantScope;
	onScopeChange: (scope: AssistantScope) => void;
}

/**
 * Right-panel header actions, specific per tab: Saved/Search in analysis,
 * Explain/Simplify in explanation, and provider + scope in the assistant.
 * Extracted from `DocxViewer` to slim it down.
 */
export function RightPanelHeaderActions({
	activeTab,
	contradictionLoading,
	relatedLoading,
	onLoadSaved,
	onSearch,
	explanationDisabled,
	onExplain,
	provider,
	onProviderChange,
	scope,
	onScopeChange,
}: RightPanelHeaderActionsProps) {
	if (activeTab === 'analysis') {
		return (
			<div className="flex shrink-0 items-center gap-1.5">
				<Button
					variant="outline"
					size="sm"
					className={ACTION_BTN}
					disabled={contradictionLoading}
					onClick={onLoadSaved}
				>
					Saved
				</Button>
				<Button
					variant="outline"
					size="sm"
					className={ACTION_BTN}
					disabled={contradictionLoading || relatedLoading}
					title="Search contradictions with LLM"
					onClick={onSearch}
				>
					Search
				</Button>
			</div>
		);
	}

	if (activeTab === 'paragraph_explanation') {
		return (
			<div className="flex shrink-0 items-center gap-1.5">
				<Button
					variant="outline"
					size="sm"
					className={ACTION_BTN}
					disabled={explanationDisabled}
					onClick={onExplain}
				>
					Explain paragraph
				</Button>
				<Button variant="outline" size="sm" className={ACTION_BTN} disabled title="Simplify — coming soon">
					Simplify
				</Button>
			</div>
		);
	}

	if (activeTab === 'assistant') {
		return (
			<div className="flex shrink-0 items-center gap-1.5">
				<Select value={provider} onValueChange={(value) => onProviderChange(value as AssistantProvider)}>
					<SelectTrigger
						size="sm"
						className="h-7 w-[92px] shrink-0 border-gray-200 bg-white px-1.5 text-[10px] text-gray-600"
						title="Assistant provider"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent className="min-w-0">
						{PROVIDER_OPTIONS.map((option) => (
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
				<div className="flex h-7 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2">
					<span className="text-[10px] font-semibold text-gray-600">Paragraph</span>
					<Switch
						className="data-[state=checked]:bg-blue-600"
						checked={scope === 'full_contract'}
						onCheckedChange={(checked) => onScopeChange(checked ? 'full_contract' : 'selected')}
					/>
					<span className="text-[10px] font-semibold text-gray-600">Full contract</span>
				</div>
			</div>
		);
	}

	return null;
}
