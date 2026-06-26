'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Input } from '@/components/ui/input';
import { DocumentIcon } from '@/components/common/icons';
import { listDocuments } from '@/services/documents';
import type { DocumentMeta } from '@/types/document';

export default function Home() {
	const [documents, setDocuments] = useState<DocumentMeta[]>([]);
	const [searchTerm, setSearchTerm] = useState('');
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');

	useEffect(() => {
		let active = true;
		listDocuments()
			.then((docs) => {
				if (active) setDocuments(docs);
			})
			.catch((err) => {
				console.error(err);
				if (active) setError('Could not load CUAD documents from backend.');
			})
			.finally(() => {
				if (active) setLoading(false);
			});
		return () => {
			active = false;
		};
	}, []);

	const filteredDocuments = useMemo(() => {
		const query = searchTerm.trim().toLowerCase();
		if (!query) return documents;

		return documents.filter((doc) =>
			[doc.name, doc.group_label, doc.relative_path, doc.display_name].some((value) =>
				(value ?? '').toLowerCase().includes(query)
			)
		);
	}, [documents, searchTerm]);

	return (
		<main className="flex min-h-screen w-full items-center justify-center">
			<div className="w-full max-w-5xl">
				<div>
					<h1 className="mb-8 text-center text-4xl">Contradiction Explorer</h1>
				</div>

				<section className="bg-card p-6">
					<header className="mb-4">
						<h2 className="text-2xl font-medium">Dataset (CUAD)</h2>
					</header>

					<div className="mb-6">
						<Input
							value={searchTerm}
							onChange={(event) => setSearchTerm(event.target.value)}
							className="h-14 rounded-full pl-8"
							placeholder="Search document..."
						/>
					</div>

					<div className="flex items-center justify-center">
						{loading ? (
							<p className="text-muted-foreground">Loading documents...</p>
						) : error ? (
							<p className="text-destructive">{error}</p>
						) : filteredDocuments.length === 0 ? (
							<p className="text-muted-foreground">No documents found.</p>
						) : (
							<ul className="space-y-5">
								{filteredDocuments.map((doc) => (
									<li key={doc.id}>
										<Link
											href={`/docx?id=${encodeURIComponent(doc.id)}`}
											className="flex items-start gap-3 rounded-md transition-colors hover:bg-muted"
										>
											<DocumentIcon />
											<div className="min-w-0 text-sm">
												<p className="truncate">{doc.name}</p>
												<p className="text-muted-foreground">{doc.group_label}</p>
											</div>
										</Link>
									</li>
								))}
							</ul>
						)}
					</div>
				</section>
			</div>
		</main>
	);
}
