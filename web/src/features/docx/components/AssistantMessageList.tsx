'use client';

import { useEffect, useRef } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import type { AssistantChatMessage } from '@/types/document';

import { AssistantMessage } from './AssistantMessage';

interface AssistantMessageListProps {
	messages: AssistantChatMessage[];
	loading: boolean;
	onSuggestedQuestionClick: (question: string) => void;
	onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void;
	entityHighlightsEnabled?: boolean;
	rewriteBusy?: boolean;
	onToggleEntityHighlights?: () => void;
	onAcceptFixSuggestion?: (messageId: string) => void | Promise<void>;
}

/**
 * Scrollable list of chat messages plus the loading skeleton. Auto-scrolls to
 * the bottom whenever new messages arrive or loading toggles. Ported from the
 * message-list region of the Svelte `RightPanelAssistant` component.
 */
export function AssistantMessageList({
	messages,
	loading,
	onSuggestedQuestionClick,
	onFocusNodeFromPanel,
	entityHighlightsEnabled = true,
	rewriteBusy = false,
	onToggleEntityHighlights,
	onAcceptFixSuggestion,
}: AssistantMessageListProps) {
	const bottomRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		bottomRef.current?.scrollIntoView({ block: 'end' });
	}, [messages.length, loading]);

	return (
		<div className="flex min-h-full flex-col gap-2 p-2">
			<div className="rounded-md border border-blue-100 bg-blue-50/60 px-2 py-1 text-[10px] text-blue-800">
				Tip: click an assistant message to toggle entity highlights.
			</div>
			<div className="rounded-md border border-indigo-100 bg-indigo-50/60 px-2 py-1 text-[10px] text-indigo-800">
				Tip: hold <span className="font-semibold">Shift + Scroll</span> to bring related/evidence
				blocks closer.
			</div>

			{messages.length === 0 && !loading ? (
				<div className="flex min-h-full flex-1 flex-col items-center justify-center text-gray-500">
					<p className="text-[10px] italic">Chat about this contract</p>
				</div>
			) : null}

			{messages.map((message) => (
				<AssistantMessage
					key={message.id}
					message={message}
					onSuggestedQuestionClick={onSuggestedQuestionClick}
					onFocusNodeFromPanel={onFocusNodeFromPanel}
					entityHighlightsEnabled={entityHighlightsEnabled}
					rewriteBusy={rewriteBusy}
					onToggleEntityHighlights={onToggleEntityHighlights}
					onAcceptFixSuggestion={onAcceptFixSuggestion}
				/>
			))}

			{loading ? (
				<div className="flex justify-start">
					<div className="w-[82%] max-w-[92%] rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
						<div className="space-y-2">
							<Skeleton className="h-3.5 w-28" />
							<Skeleton className="h-3 w-full" />
							<Skeleton className="h-3 w-[92%]" />
							<Skeleton className="h-3 w-[70%]" />
						</div>
					</div>
				</div>
			) : null}

			<div ref={bottomRef} />
		</div>
	);
}
