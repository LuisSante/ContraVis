import type {
	AssistantMode,
	AssistantProvider,
	AssistantScope,
	ContradictionTaxonomyType,
	RightPanelTab
} from '$lib/types/document';

export const QUICK_ACTION_WHY_CONTRADICTION_FREE = 'Why is it a contradiction? (Free)';
export const QUICK_ACTION_WHY_CONTRADICTION_AI = 'Why is it a contradiction? (AI cost)';
export const QUICK_ACTION_CONTRADICTION_RISKS = 'What are the risks of this contradiction?';

export const QUICK_ACTIONS = [
	QUICK_ACTION_WHY_CONTRADICTION_FREE,
	QUICK_ACTION_WHY_CONTRADICTION_AI,
	'Who is liable?',
	'Can I terminate?',
	"What happens if I don't?",
];

export const MODE_OPTIONS: ReadonlyArray<{ value: AssistantMode; label: string }> = [
	{ value: 'explain', label: 'Explain' },
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
	{ value: 'gpt-4.1', label: 'gpt-4.1' },
	{ value: 'gpt-5', label: 'gpt-5' },
	{ value: 'gpt-5-mini', label: 'gpt-5-mini' },
	{ value: 'gpt-5-nano', label: 'gpt-5-nano' },
	{ value: 'gpt-5.1', label: 'gpt-5.1' }

];

export const PARAGRAPH_EXPLANATION_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
	{ value: 'gpt-5-mini', label: 'gpt-5-mini' },
	{ value: 'gpt-5', label: 'gpt-5' },
	{ value: 'gpt-4.1', label: 'gpt-4.1' }
];

export const COMMIT_SHORTCUT_LABEL = 'CTRL + SHIFT + ENTER';
export const COMMIT_SHORTCUT_HINT = 'Commit changes with Ctrl + Shift + Enter';
export const COMMIT_SHORTCUT_TOOLTIP = 'Ctrl + Shift + Enter to save';

export const MAX_SIMPLIFY_AUDIT_TRAIL = 200;

export const CONTRADICTION_TAXONOMY_ORDER: ReadonlyArray<ContradictionTaxonomyType> = [
	'temporal',
	'numerical',
	'authority',
	'process',
	'policy_reversal',
	'specificity'
];

export const CONTRADICTION_TAXONOMY_LABELS: Readonly<Record<ContradictionTaxonomyType, string>> = {
	temporal: 'Temporal',
	numerical: 'Numerical',
	authority: 'Authority',
	process: 'Process',
	policy_reversal: 'Policy Reversal',
	specificity: 'Specificity'
};

export const CONTRADICTION_TAXONOMY_COLORS: Readonly<Record<ContradictionTaxonomyType, string>> = {
	temporal: '#c300ff',
	numerical: '#019a34',
	authority: '#e2c800',
	process: '#0ea5e9',
	policy_reversal: '#ff9901',
	specificity: '#1653cc'
};

export const CONTRADICTION_CLAIM_SIDE_COLORS: Readonly<Record<'a' | 'b', string>> = {
	a: '#2563eb',
	b: '#d97706'
};

export const EDITABLE_PARAGRAPH_CLASSES = [
	'rounded-[2px]',
	'-mx-[2px]',
	'px-[2px]',
	'outline-none',
	'transition-all',
	'hover:ring-1',
	'hover:ring-blue-300',
	'focus:ring-2',
	'focus:ring-blue-700'
] as const;

export const RIGHT_PANEL_TOOLS: Array<{ id: RightPanelTab; label: string }> = [
	{ id: 'analysis', label: 'Contradiction Analysis' },
	// { id: 'redundancy', label: 'Redundancy Analysis' },
	{ id: 'related', label: 'Related Paragraphs' },
	// { id: 'paragraph_explanation', label: 'Paragraph Explanation' },
	// { id: 'summarize', label: 'Summarize & Simplify' },
	// { id: 'ambiguity', label: 'Ambiguity Analysis' },
	// { id: 'revisions', label: 'Paragraph Revisions' },
	{ id: 'assistant', label: 'Contract Chat Assistant' }
];
 
export const RIGHT_TOOLBAR_WIDTH = 58;
export const RIGHT_DRAWER_MIN_WIDTH = 360;
export const RIGHT_DRAWER_DEFAULT_WIDTH = 550;
export const RIGHT_DRAWER_MAX_RATIO = 0.68;
export const RIGHT_DRAWER_KEYBOARD_STEP = 24;
export const FIX_CONTRADICTION_TOP_RELATED = 3;
