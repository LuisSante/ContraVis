export interface DocumentMeta {
	id: string;
	name: string;
	full_path: string;
	relative_path?: string;
	group_label?: string;
	display_name?: string;
	origin: 'dataset' | 'upload';
	processed: boolean;
}

export interface Node {
	id: string;
	documentId: string;
	text: string;
	paragraph_enum: number;
	page: number;
	relationsCount: number;
	x?: number;
	y?: number;
	fontSize?: number;
}

export interface Edge {
	source: string;
	target: string;
	type: 'reference' | 'semantic_similarity';
	score?: number;
	ref_label?: string;
	ref_value?: string;
}

export interface Graph {
	nodes: Node[];
	edges: Edge[];
}

export interface ProcessDocumentResponse {
	status: 'success' | 'error';
	documentId: string;
	graph: Graph;
}

export type XmlNode = {
	name?: string;
	attribs?: Record<string, string>;
	children?: XmlNode[];
	type?: string;
	data?: string;
};

export type Docx4jsDocument = {
	render: (
		factory: (type: string, props: Record<string, unknown>, children: unknown) => unknown,
		identify?: (
			node: XmlNode,
			officeDocument: {
				constructor: { identify: (node: XmlNode, officeDocument: unknown) => unknown };
			}
		) => unknown
	) => unknown;
	release?: () => void;
};

export type Docx4jsBrowserModule = {
	docx: {
		load: (file: ArrayBuffer) => Promise<Docx4jsDocument>;
	};
};

export type ParagraphKind = 'paragraph' | 'heading' | 'list';
export type RelationKind = 'semantic_similarity' | 'reference';

export type TokenDiffSegment = {
	value: string;
	changed: boolean;
};

export type ChangeLogState = {
	hasChanges: boolean;
	oldSegments: TokenDiffSegment[];
	newSegments: TokenDiffSegment[];
};

export type ParagraphEditState = {
	committed: string;
	current: string;
	editedSinceCommit: boolean;
};

export type ReferenceMatch = {
	label: string;
	value: string;
};

export type RelatedParagraph = {
	node: Node;
	relationTypes: RelationKind[];
	semanticScore?: number;
	references: ReferenceMatch[];
};

export type BuildRelatedOptions = {
	nodes: Node[];
	edges: Edge[];
	maxRelatedParagraphs?: number;
};

export type AssistantMode = 'explain' | 'suggest_questions';
export type AssistantScope = 'selected' | 'full_contract';
export type AssistantProvider = 'openai' | 'gemini';

export type AssistantCitation = {
	id: string;
	excerpt: string;
	page?: number;
	paragraph_enum?: number;
};

export type AssistantMessageRole = 'user' | 'assistant';

export type ContradictionTaxonomyType =
	| 'temporal'
	| 'numerical'
	| 'authority'
	| 'process'
	| 'policy_reversal'
	| 'specificity'
	| 'other';

export type StructuredContradictionClaim = {
	text: string;
	source: 'paragraph' | 'context' | 'unknown';
	paragraph_id?: string;
	subject?: string;
	relation?: string;
	object?: string;
	polarity?: 'affirmed' | 'negated' | 'unknown';
};

export type StructuredContradictionItem = {
	id: string;
	contradiction_type: ContradictionTaxonomyType;
	why: string;
	claim_a: StructuredContradictionClaim;
	claim_b: StructuredContradictionClaim;
	conflicting_fields: string[];
	confidence: number;
};

export type StructuredContradictionHighlight = {
	phrase: string;
	category: ContradictionTaxonomyType;
	claim_id?: string;
	claim_side?: 'a' | 'b' | 'both' | 'unknown';
	source: 'paragraph' | 'context' | 'unknown';
};

export type StructuredContradictionAnalysis = {
	version?: string;
	paragraph_id: string;
	overall_summary: string;
	contradiction_count: number;
	contradictions: StructuredContradictionItem[];
	highlights: StructuredContradictionHighlight[];
	notes?: string[];
	highlight_source_text?: string;
};

export type FreeContradictionSnippet = {
	source: string;
	text: string;
};

export type FreeContradictionExplanation = {
	paragraphId: string;
	reason: string;
	confidence: number;
	snippetA?: FreeContradictionSnippet;
	snippetB?: FreeContradictionSnippet;
	fallbackEvidenceMessage?: string;
	footerMessage: string;
};

export type FixContradictionSuggestion = {
	paragraphId: string;
	reason?: string;
	changeNotes: string[];
	rewriteResult: SimplifyResultState;
	status?: 'pending' | 'applied';
};

export type AssistantChatMessage = {
	id: string;
	role: AssistantMessageRole;
	content: string;
	citations?: AssistantCitation[];
	suggestedQuestions?: string[];
	structuredContradiction?: StructuredContradictionAnalysis;
	freeContradictionExplanation?: FreeContradictionExplanation;
	fixContradictionSuggestion?: FixContradictionSuggestion;
};

export type AssistantContextNode = {
	id: string;
	text: string;
	paragraph_enum: number;
	page: number;
};

export type AssistantContextRelation = {
	id: string;
	relationTypes: RelationKind[];
	semanticScore?: number;
	references?: string[];
};

export type AssistantHistoryMessage = {
	role: AssistantMessageRole;
	content: string;
};

export type AssistantChatRequest = {
	documentId: string;
	question: string;
	mode: AssistantMode;
	scope: AssistantScope;
	provider: AssistantProvider;
	model?: string;
	selectedParagraphId?: string | null;
	relatedParagraphs: AssistantContextRelation[];
	paragraphNodes: AssistantContextNode[];
	history: AssistantHistoryMessage[];
};

export type AssistantChatResponse = {
	answer: string;
	citations: AssistantCitation[];
	suggestedQuestions: string[];
	mode: AssistantMode;
	scope: AssistantScope;
	provider: AssistantProvider;
};

export type SimplifyEvidence = {
	paragraph_id: string;
	selection_start: number;
	selection_end: number;
};

export type SimplifyAudit = {
	system_prompt: string;
	user_prompt: string;
	model_response: string;
};

export type SimplifyRelatedParagraph = {
	id: string;
	text: string;
	paragraph_enum?: number;
	page?: number;
	relationTypes: RelationKind[];
	semanticScore?: number;
	references?: string[];
};

export type SimplifySelectionRequest = {
	documentId: string;
	provider: AssistantProvider;
	paragraphId: string;
	paragraphText: string;
	selectionStart: number;
	selectionEnd: number;
	contradictionReason?: string;
	relatedParagraphs?: SimplifyRelatedParagraph[];
};

export type SimplifySelectionResponse = {
	paragraphId: string;
	provider: AssistantProvider;
	originalSnippet: string;
	simplifiedSnippet: string;
	evidence: SimplifyEvidence;
	audit: SimplifyAudit;
};

export type SimplifyResultState = {
	payload: SimplifySelectionResponse;
	paragraphTextSnapshot: string;
	createdAt: string;
};

export type SimplifyAuditRecord = {
	documentId: string;
	provider: AssistantProvider;
	paragraphId: string;
	selectionStart: number;
	selectionEnd: number;
	originalSnippet: string;
	simplifiedSnippet: string;
	systemPrompt: string;
	userPrompt: string;
	modelResponse: string;
	timestamp: string;
};
export type ContradictionParagraphResult = {
	paragraph_id: string;
	contradiction: boolean;
	confidence: number;
	brief_reason: string;
	evidence?: ContradictionEvidence | null;
};

export type ContradictionEvidence = {
	snippet_a: string;
	snippet_b: string;
	source_a: 'paragraph' | 'context' | 'unknown';
	source_b: 'paragraph' | 'context' | 'unknown';
	evidence_status?: 'exact' | 'missing' | 'approximate';
	evidence_note?: string;
};

export type ContradictionGraphMode = 'with_kg' | 'without_kg';

export type ContradictionAnalysisRequest = {
	documentId: string;
	provider: AssistantProvider;
	temperature: number;
	model?: string;
	mode: ContradictionGraphMode;
	graph: Graph;
};

export type ContradictionAnalysisResponse = {
	documentId: string;
	provider: AssistantProvider;
	temperature: number;
	model?: string;
	mode: ContradictionGraphMode;
	paragraphResults: ContradictionParagraphResult[];
	rawResponse: string;
};

export type SavedContradictionsResponse = {
	documentId: string;
	sourceFile: string;
	mode: ContradictionGraphMode;
	paragraphResults: ContradictionParagraphResult[];
};

export type LlmEstimateCallType =
	| 'assistant_chat'
	| 'assistant_simplify'
	| 'assistant_fix_contradiction'
	| 'contradictions_analyze';

export type LlmEstimateRequest = {
	callType: LlmEstimateCallType;
	assistantChat?: AssistantChatRequest;
	simplifySelection?: SimplifySelectionRequest;
	contradictionAnalysis?: ContradictionAnalysisRequest;
};

export type LlmEstimateResponse = {
	callType: LlmEstimateCallType;
	provider: AssistantProvider;
	model: string;
	estimatedInputTokens: number;
	estimatedOutputTokens: number;
	estimatedTotalTokens: number;
	estimatedCostUsd?: number | null;
	estimatedCostUsdFormatted: string;
};

export type ContradictionScrollMarker = {
	paragraphId: string;
	topPercent: number;
	confidenceBand: 'high' | 'medium' | 'low';
};

export type ChatHighlightSegment = {
	text: string;
	category: ContradictionTaxonomyType | null;
	claimId?: string;
	claimSide?: 'a' | 'b';
	contradictionType?: ContradictionTaxonomyType;
	contradictionWhy?: string;
	interactive?: boolean;
};

export type RightPanelTab =
	| 'related'
	| 'analysis'
	| 'redundancy'
	| 'paragraph_explanation'
	| 'summarize'
	| 'ambiguity'
	| 'revisions'
	| 'assistant';

export type ChatPreviewHoverState = {
	messageId: string;
	segmentKey: string;
	contradictionId: string;
	claimSide: 'a' | 'b' | null;
	kind: 'claim' | 'highlight';
};
