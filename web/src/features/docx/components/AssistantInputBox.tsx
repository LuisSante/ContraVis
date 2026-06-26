'use client';

import type { KeyboardEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface AssistantInputBoxProps {
	input: string;
	loading: boolean;
	onInputChange: (value: string) => void;
	onSubmit: () => void;
	onKeydown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/**
 * Chat input area: controlled textarea + send button. Ported from the form
 * block of the Svelte `RightPanelAssistant` component (quick-action suggestions
 * intentionally dropped in this migration step).
 */
export function AssistantInputBox({
	input,
	loading,
	onInputChange,
	onSubmit,
	onKeydown,
}: AssistantInputBoxProps) {
	return (
		<form
			className="bg-white p-2"
			onSubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<div className="mt-2 flex items-end gap-1.5">
				<Textarea
					rows={2}
					placeholder="Ask about this contract or paragraph..."
					className="min-h-[50px] border-black bg-white text-[10px] text-gray-700"
					value={input}
					onChange={(event) => onInputChange(event.target.value)}
					onKeyDown={onKeydown}
					disabled={loading}
				/>
				<Button
					type="submit"
					variant="outline"
					size="sm"
					disabled={loading}
					className="h-7 w-7 border-black bg-white px-0 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
					aria-label="Send chat message"
					title="Send"
				>
					<svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
						<path
							d="M3 10L17 3L10 17L8.2 11.8L3 10Z"
							stroke="currentColor"
							strokeWidth="1.6"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<path
							d="M17 3L8.2 11.8"
							stroke="currentColor"
							strokeWidth="1.6"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
				</Button>
			</div>
		</form>
	);
}
