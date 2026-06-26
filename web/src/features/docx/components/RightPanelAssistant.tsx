'use client';

import type { KeyboardEvent } from 'react';

import { ScrollArea } from '@/components/ui/scroll-area';
import type { AssistantChatMessage } from '@/types/document';

import { AssistantInputBox } from './AssistantInputBox';
import { AssistantMessageList } from './AssistantMessageList';

interface RightPanelAssistantProps {
	messages: AssistantChatMessage[];
	input: string;
	loading: boolean;
	error: string | null;
	onInputChange: (value: string) => void;
	onSubmit: () => void;
	onKeydown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
	onSuggestedQuestionClick: (question: string) => void;
	onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void;
}

/**
 * Contract chat assistant panel: scrollable message list + bottom input box +
 * error display. Faithful port of the chat half of the Svelte
 * `RightPanelAssistant` component. The quick-action suggestions, entity-
 * highlight toggle, and fix-contradiction action card are intentionally
 * dropped/stubbed in this migration step.
 */
export function RightPanelAssistant({
	messages,
	input,
	loading,
	error,
	onInputChange,
	onSubmit,
	onKeydown,
	onSuggestedQuestionClick,
	onFocusNodeFromPanel,
}: RightPanelAssistantProps) {
	return (
		<section className="flex min-h-0 flex-1 flex-col bg-white">
			<ScrollArea className="min-h-0 flex-1">
				<AssistantMessageList
					messages={messages}
					loading={loading}
					onSuggestedQuestionClick={onSuggestedQuestionClick}
					onFocusNodeFromPanel={onFocusNodeFromPanel}
				/>
			</ScrollArea>

			{error ? (
				<div className="border-t border-red-100 bg-red-50 px-3 py-1.5 text-[10px] text-red-700">
					{error}
				</div>
			) : null}

			<AssistantInputBox
				input={input}
				loading={loading}
				onInputChange={onInputChange}
				onSubmit={onSubmit}
				onKeydown={onKeydown}
			/>
		</section>
	);
}

export type { RightPanelAssistantProps };
