import type { AssistantMode, AssistantProvider, AssistantScope } from '$lib/types/document';

export const QUICK_ACTIONS = ["What happens if I don't?", 'Can I terminate?', 'Who is liable?'];

export const MODE_OPTIONS: ReadonlyArray<{ value: AssistantMode; label: string }> = [
	{ value: 'explain', label: 'Explain' },
	{ value: 'quote', label: 'Quote' },
	{ value: 'suggest_questions', label: 'Suggestion Question' }
];

export const SCOPE_OPTIONS: ReadonlyArray<{ value: AssistantScope; label: string }> = [
	{ value: 'selected', label: 'Selected Paragraph' },
	{ value: 'full_contract', label: 'Full Contract' }
];

export const PROVIDER_OPTIONS: ReadonlyArray<{ value: AssistantProvider; label: string }> = [
	{ value: 'gemini', label: 'Gemini' },
	{ value: 'openai', label: 'OpenAI' }
];

export const COMMIT_SHORTCUT_LABEL = 'CTRL + SHIFT + ENTER';
export const COMMIT_SHORTCUT_HINT = 'Commit changes with Ctrl + Shift + Enter';
export const COMMIT_SHORTCUT_TOOLTIP = 'Ctrl + Shift + Enter to save';

export const MAX_SIMPLIFY_AUDIT_TRAIL = 200;
