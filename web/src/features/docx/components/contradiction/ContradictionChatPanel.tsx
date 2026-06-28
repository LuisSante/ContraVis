'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { ChatIcon } from '@/components/common/icons';
import type { AssistantChatMessage } from '@/types/document';

import { AssistantMessageList } from '@/features/docx/components/assistant/AssistantMessageList';

const CHAT_PANEL_COLLAPSED_HEIGHT = 46;
const CHAT_PANEL_OPEN_DEFAULT_HEIGHT = 250;
const CHAT_PANEL_OPEN_THRESHOLD = 47;

interface ContradictionChatPanelProps {
	messages: AssistantChatMessage[];
	input: string;
	loading: boolean;
	error: string | null;
	rewriteBusy: boolean;
	entityHighlightsEnabled: boolean;
	onInputChange: (value: string) => void;
	onSubmit: () => void;
	onKeydown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
	onWhy: () => void;
	onRisks: () => void;
	onSuggestFix: () => void;
	onToggleEntityHighlights: () => void;
	onAcceptFixSuggestion: (messageId: string) => void | Promise<void>;
	onSuggestedQuestionClick: (question: string) => void;
	onFocusNodeFromPanel: (nodeId: string, emphasize?: boolean) => void;
}

/**
 * Chat embebido en Contradiction Analysis, anclado abajo y redimensionable. Barra
 * de quick-actions siempre visible; al abrirse muestra el hilo (compartido con el
 * Contract Chat Assistant) y el textarea. Port fiel del bloque de chat del Svelte
 * `RightPanelAnalysis`.
 */
export function ContradictionChatPanel({
	messages,
	input,
	loading,
	error,
	rewriteBusy,
	entityHighlightsEnabled,
	onInputChange,
	onSubmit,
	onKeydown,
	onWhy,
	onRisks,
	onSuggestFix,
	onToggleEntityHighlights,
	onAcceptFixSuggestion,
	onSuggestedQuestionClick,
	onFocusNodeFromPanel,
}: ContradictionChatPanelProps) {
	const [height, setHeight] = useState(CHAT_PANEL_COLLAPSED_HEIGHT);
	const [isResizing, setIsResizing] = useState(false);
	const resizeStartY = useRef(0);
	const resizeStartHeight = useRef(CHAT_PANEL_OPEN_DEFAULT_HEIGHT);

	const isOpen = height > CHAT_PANEL_OPEN_THRESHOLD;

	const resolveHalfOpenHeight = useCallback(() => {
		if (typeof window === 'undefined') return CHAT_PANEL_OPEN_DEFAULT_HEIGHT;
		return Math.max(CHAT_PANEL_OPEN_THRESHOLD + 1, Math.round(window.innerHeight * 0.5));
	}, []);

	const openPanel = useCallback(() => {
		setHeight((prev) => (prev > CHAT_PANEL_OPEN_THRESHOLD ? prev : resolveHalfOpenHeight()));
	}, [resolveHalfOpenHeight]);

	const togglePanel = () => {
		setHeight((prev) =>
			prev > CHAT_PANEL_OPEN_THRESHOLD ? CHAT_PANEL_COLLAPSED_HEIGHT : resolveHalfOpenHeight()
		);
	};

	// Redimensionado por arrastre del tirador superior.
	useEffect(() => {
		if (!isResizing) return;
		const handleMove = (event: MouseEvent) => {
			const delta = resizeStartY.current - event.clientY;
			setHeight(Math.max(CHAT_PANEL_COLLAPSED_HEIGHT, Math.round(resizeStartHeight.current + delta)));
		};
		const handleUp = () => setIsResizing(false);
		window.addEventListener('mousemove', handleMove);
		window.addEventListener('mouseup', handleUp);
		return () => {
			window.removeEventListener('mousemove', handleMove);
			window.removeEventListener('mouseup', handleUp);
		};
	}, [isResizing]);

	const startResize = (event: React.MouseEvent) => {
		event.preventDefault();
		resizeStartY.current = event.clientY;
		resizeStartHeight.current = height;
		setIsResizing(true);
	};

	const runQuickAction = (action: () => void) => {
		openPanel();
		action();
	};

	return (
		<div
			className={`relative flex shrink-0 flex-col border-t border-gray-200 bg-white px-3 py-2 ${
				isResizing ? '' : 'transition-[height] duration-200 ease-out'
			}`}
			style={{ height, minHeight: CHAT_PANEL_COLLAPSED_HEIGHT }}
		>
			<button
				type="button"
				className={`absolute top-0 left-1/2 h-2 w-16 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize rounded-full border bg-white transition ${
					isResizing
						? 'border-blue-300 bg-blue-50'
						: 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
				}`}
				aria-label="Resize contradiction chat"
				title="Drag to resize chat area"
				onMouseDown={startResize}
			/>

			<div className={`flex items-center gap-1.5 ${isOpen ? 'mb-2' : ''}`}>
				<span
					className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-gray-500"
					aria-hidden="true"
				>
					<ChatIcon className="h-3.5 w-3.5" strokeWidth={1.8} />
				</span>

				<Button
					variant="outline"
					size="sm"
					className="h-6 border-gray-200 bg-gray-50 px-2 text-[10px] text-gray-700 hover:border-gray-300 hover:bg-gray-100"
					onClick={() => runQuickAction(onWhy)}
				>
					Why is it a contradiction?
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-6 border-gray-200 bg-gray-50 px-2 text-[10px] text-gray-700 hover:border-gray-300 hover:bg-gray-100"
					onClick={() => runQuickAction(onRisks)}
				>
					What are the risks of this contradiction?
				</Button>
				<Button
					variant="outline"
					size="sm"
					className="h-6 border-blue-200 bg-blue-50 px-2 text-[10px] text-blue-700 hover:border-blue-300 hover:bg-blue-100"
					disabled={rewriteBusy || loading}
					onClick={() => runQuickAction(onSuggestFix)}
				>
					{rewriteBusy ? 'Preparing fix...' : 'Suggest contradiction fix'}
				</Button>

				<button
					type="button"
					className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[10px] border border-gray-200 bg-white text-gray-700 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
					onClick={togglePanel}
					aria-label={isOpen ? 'Minimize contradiction chat' : 'Maximize contradiction chat'}
					title={isOpen ? 'Minimize contradiction chat' : 'Maximize contradiction chat'}
				>
					{isOpen ? (
						<svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
							<path
								d="M5 10H15"
								stroke="currentColor"
								strokeWidth="1.6"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					) : (
						<svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
							<rect x="4.5" y="4.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
						</svg>
					)}
				</button>
			</div>

			{isOpen ? (
				<>
					<ScrollArea className="min-h-0 flex-1 rounded border border-gray-200 bg-gray-50/70">
						<AssistantMessageList
							messages={messages}
							loading={loading}
							entityHighlightsEnabled={entityHighlightsEnabled}
							rewriteBusy={rewriteBusy}
							onSuggestedQuestionClick={onSuggestedQuestionClick}
							onFocusNodeFromPanel={onFocusNodeFromPanel}
							onToggleEntityHighlights={onToggleEntityHighlights}
							onAcceptFixSuggestion={onAcceptFixSuggestion}
						/>
					</ScrollArea>

					{error ? <p className="mt-1 text-[10px] text-red-600">{error}</p> : null}

					<div className="mt-2 flex items-end gap-1.5">
						<Textarea
							rows={2}
							placeholder="Ask about this contradiction..."
							className="min-h-[50px] border-gray-200 bg-white text-[10px] text-gray-700"
							value={input}
							onChange={(event) => onInputChange(event.target.value)}
							onKeyDown={onKeydown}
							disabled={loading}
						/>
						<Button
							variant="outline"
							size="sm"
							className="h-7 w-7 border-gray-200 bg-white px-0 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
							onClick={onSubmit}
							disabled={loading}
							aria-label="Send contradiction chat message"
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
				</>
			) : null}
		</div>
	);
}
