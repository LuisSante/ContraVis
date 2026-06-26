'use client';

import { Fragment } from 'react';

import { ContractChatAssistantIcon, UserIcon } from '@/components/common/icons';
import {
	splitReferenceAndEntityText,
	splitReferenceText,
	type ReferenceTextSegment,
} from '@/features/docx/utils/text';
import type { AssistantChatMessage } from '@/types/document';

import { CitationChips } from './CitationChips';
import { StructuredContradictionMessage } from './StructuredContradictionMessage';
import { SuggestedQuestions } from './SuggestedQuestions';

interface AssistantMessageProps {
	message: AssistantChatMessage;
	onSuggestedQuestionClick: (question: string) => void;
	onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void;
}

function renderSegments(
	segments: ReferenceTextSegment[],
	keyPrefix: string,
): React.ReactNode {
	return segments.map((segment, index) => {
		const key = `${keyPrefix}-${index}`;
		if (segment.isReference) {
			return (
				<span key={key} className="docx-reference-chip align-middle">
					{segment.text}
				</span>
			);
		}
		if (segment.isEntity) {
			return (
				<span
					key={key}
					className="docx-paragraph-explanation-entity-token"
					data-entity-key={segment.entityKey}
					style={
						{
							'--entity-color': segment.entityColor ?? '#2563eb',
							'--entity-color-soft': segment.entitySoftColor ?? 'rgba(37,99,235,0.16)',
						} as React.CSSProperties
					}
				>
					{segment.text}
				</span>
			);
		}
		return <Fragment key={key}>{segment.text}</Fragment>;
	});
}

/**
 * A single chat message (user vs assistant). Ported from the message-rendering
 * block of the Svelte `RightPanelAssistant` component. The "fix contradiction"
 * action card is intentionally not ported in this migration step.
 */
export function AssistantMessage({
	message,
	onSuggestedQuestionClick,
	onFocusNodeFromPanel,
}: AssistantMessageProps) {
	// Stubbed: the fix-contradiction action card is not ported in this step.
	if (message.fixContradictionSuggestion) return null;

	const isUser = message.role === 'user';
	const isAssistant = message.role === 'assistant';
	const entities = message.entityHighlights ?? [];

	return (
		<div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
			<div className="inline-flex max-w-[92%] items-start gap-1.5">
				{isAssistant ? (
					<span className="mt-1 inline-flex shrink-0 items-center justify-center text-gray-500">
						<ContractChatAssistantIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
						<span className="sr-only">Assistant</span>
					</span>
				) : null}

				<div
					className={`rounded border px-2 py-1 text-[10px] leading-relaxed ${
						isUser
							? 'border-blue-200 bg-blue-50 text-blue-800'
							: 'border-gray-200 bg-white text-gray-700'
					}`}
				>
					{isAssistant && message.structuredContradiction ? (
						<StructuredContradictionMessage
							messageContent={message.content}
							structuredContradiction={message.structuredContradiction}
						/>
					) : (
						<p className="whitespace-pre-wrap">
							{renderSegments(
								entities.length
									? splitReferenceAndEntityText(message.content, entities)
									: splitReferenceText(message.content),
								`${message.id}-content`,
							)}
						</p>
					)}

					{message.suggestedQuestions?.length ? (
						<SuggestedQuestions
							questions={message.suggestedQuestions}
							onSuggestedQuestionClick={onSuggestedQuestionClick}
						/>
					) : null}

					{message.citations?.length ? (
						<CitationChips
							citations={message.citations}
							onFocusNodeFromPanel={onFocusNodeFromPanel}
						/>
					) : null}
				</div>

				{isUser ? (
					<span className="mt-1 inline-flex shrink-0 items-center justify-center text-blue-600">
						<UserIcon className="h-3.5 w-3.5" strokeWidth={1.9} />
						<span className="sr-only">You</span>
					</span>
				) : null}
			</div>
		</div>
	);
}
