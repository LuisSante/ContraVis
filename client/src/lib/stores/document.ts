import { writable } from 'svelte/store';
import type { DocumentMeta, Node } from '$lib/types/document';

export const currentDocument = writable<DocumentMeta | null>(null);
export const pdfUrl = writable<string | null>(null);
export const numPages = writable<number>(0);
export const paragraphs = writable<Node[]>([]);
export const loading = writable<boolean>(false);
export const error = writable<string | null>(null);
export const selectedParagraph = writable<Node | null>(null);
