import { writable } from 'svelte/store';
import type { DocumentMeta, Node } from '$lib/types/document';

export const currentDocument = writable<DocumentMeta | null>(null);
export const paragraphs = writable<Node[]>([]);
export const loading = writable<boolean>(false);
export const error = writable<string | null>(null);
export const selectedParagraph = writable<Node | null>(null);
