import type { AssistantMode, AssistantProvider, AssistantScope } from '$lib/types/document';

export const QUICK_ACTION_WHY_CONTRADICTION_FREE = 'Why is it a contradiction? (Free)';
export const QUICK_ACTION_WHY_CONTRADICTION_AI = 'Why is it a contradiction? (AI cost)';

export const QUICK_ACTIONS = [
	QUICK_ACTION_WHY_CONTRADICTION_FREE,
	QUICK_ACTION_WHY_CONTRADICTION_AI,
	"What happens if I don't?",
	'Can I terminate?',
	'Who is liable?'
];

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
	{ value: 'openai', label: 'OpenAI' },
	{ value: 'gemini', label: 'Gemini' },
];

export const CONTRADICTION_OPENAI_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	// { value: 'gpt-4o-mini', label: 'gpt-4o-mini (cheaper)' },
	{ value: 'gpt-4.1-mini', label: 'gpt-4.1-mini' },
	{ value: 'gpt-4.1', label: 'gpt-4.1' },
	{ value: 'gpt-4o', label: 'gpt-4o' }
];

export const COMMIT_SHORTCUT_LABEL = 'CTRL + SHIFT + ENTER';
export const COMMIT_SHORTCUT_HINT = 'Commit changes with Ctrl + Shift + Enter';
export const COMMIT_SHORTCUT_TOOLTIP = 'Ctrl + Shift + Enter to save';

export const MAX_SIMPLIFY_AUDIT_TRAIL = 200;

export const EDITABLE_PARAGRAPH_CLASSES = [
	'rounded-[2px]',
	'-mx-[2px]',
	'px-[2px]',
	'outline-none',
	'transition-all',
	'hover:ring-1',
	'hover:ring-blue-300',
	'focus:ring-2',
	'focus:ring-yellow-400'
] as const;
