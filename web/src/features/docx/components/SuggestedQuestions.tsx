'use client';

import { Button } from '@/components/ui/button';

interface SuggestedQuestionsProps {
	questions: string[];
	onSuggestedQuestionClick: (question: string) => void;
}

/**
 * Suggested follow-up question chips rendered under an assistant message.
 * Ported from the `message.suggestedQuestions` block of the Svelte
 * `RightPanelAssistant` component.
 */
export function SuggestedQuestions({
	questions,
	onSuggestedQuestionClick,
}: SuggestedQuestionsProps) {
	if (!questions.length) return null;

	return (
		<div className="mt-2">
			<p className="mb-1 text-[9px] font-semibold text-gray-500">Suggested questions</p>
			<div className="flex flex-wrap gap-1">
				{questions.map((suggestedQuestion, index) => (
					<Button
						key={`${suggestedQuestion}-${index}`}
						variant="outline"
						size="xs"
						className="h-5 border-gray-200 bg-gray-50 px-1.5 text-[9px] text-gray-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
						onClick={() => onSuggestedQuestionClick(suggestedQuestion)}
					>
						{suggestedQuestion}
					</Button>
				))}
			</div>
		</div>
	);
}
