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

export interface ExtractedElement {
	id: string;
	text: string;
	x: number;
	y: number;
	fontSize: number;
	width?: number;
}

export interface ExtractedPage {
	pageNumber: number;
	width: number;
	height: number;
	elements: ExtractedElement[];
}

export interface ElementState {
	original: string;
	committed: string;
	current: string;
	isDirty: boolean;
}

export interface Line {
	page: number;
	y: number;
	fontSize: number;
	items: ExtractedElement[];
};

export interface Paragraph {
	page: number;
	lines: Line[];
	text: string;
	x: number;
	y: number;
	fontSize: number;
};

export type LayoutElement = ExtractedElement & {
	boxX: number;
	boxY: number;
	boxWidth: number;
	boxHeight: number;
};

export type LayoutPage = Omit<ExtractedPage, 'elements'> & {
	elements: LayoutElement[];
};