import { writable } from 'svelte/store';
import type { DocumentMeta, Paragraph } from '$lib/types/document';

export const currentDocument = writable<DocumentMeta | null>(null);
export const pdfUrl = writable<string | null>(null);
export const paragraphs = writable<[]>([]); //nodes
export const loading = writable<boolean>(false);
export const error = writable<string | null>(null);
export const selectedParagraph = writable<Paragraph | null>(null);
