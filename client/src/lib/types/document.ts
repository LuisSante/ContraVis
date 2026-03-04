export interface DocumentMeta {
	id: string;
	name: string;
	full_path: string;
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

export type AssistantMode = 'explain' | 'quote' | 'suggest_questions';
export type AssistantScope = 'selected' | 'full_contract';
export type AssistantProvider = 'gemini' | 'openai';

export type AssistantCitation = {
	id: string;
	excerpt: string;
	page?: number;
	paragraph_enum?: number;
};

export type AssistantMessageRole = 'user' | 'assistant';

export type AssistantChatMessage = {
	id: string;
	role: AssistantMessageRole;
	content: string;
	citations?: AssistantCitation[];
	suggestedQuestions?: string[];
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
