'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ProcessingStep {
	label: string;
	active: boolean;
}

interface ProcessingIndicatorProps {
	steps?: ProcessingStep[];
	label?: string;
}

const TICK_INTERVAL_MS = 260;

/**
 * Animated "processing…" indicator: a vertical list of steps where completed
 * steps show a green check, the active one a spinning loader, and pending ones a
 * muted dot. Reusable across panels.
 */
export function ProcessingIndicator({
	steps = [],
	label = 'Processing',
}: ProcessingIndicatorProps) {
	const [tick, setTick] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setTick((prev) => prev + 1);
		}, TICK_INTERVAL_MS);
		return () => {
			clearInterval(timer);
		};
	}, []);

	const activeProcessingStepIndex = useMemo(
		() => (steps.length > 0 ? Math.floor(tick / 3) % steps.length : 0),
		[tick, steps.length],
	);
	const activeDotCount = (tick % 3) + 1;

	return (
		<div className="rounded-xl border border-blue-100 bg-blue-50/40 p-3 dark:border-blue-950/50 dark:bg-blue-950/20">
			<div className="mb-2.5 flex items-center gap-1.5">
				<Loader2 className="size-3 animate-spin text-blue-600 dark:text-blue-400" aria-hidden="true" />
				<p className="text-[10px] font-semibold tracking-wide text-blue-700 uppercase dark:text-blue-300">
					{label}
				</p>
			</div>
			<ul className="space-y-2">
				{steps.map((step, index) => {
					const isActive = index === activeProcessingStepIndex;
					const isDone = index < activeProcessingStepIndex;
					return (
						<li
							key={`${step.label}-${index}`}
							className="relative flex items-center gap-2.5"
						>
							{index < steps.length - 1 ? (
								<span
									className={cn(
										'absolute top-[15px] left-[7px] h-[14px] w-px',
										isDone ? 'bg-green-300 dark:bg-green-800' : 'bg-border',
									)}
									aria-hidden="true"
								/>
							) : null}
							<span
								className={cn(
									'flex size-3.5 flex-none items-center justify-center rounded-full',
									isDone
										? 'bg-green-100 text-green-600 dark:bg-green-950/50 dark:text-green-400'
										: isActive
											? 'bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400'
											: 'bg-muted text-muted-foreground/50',
								)}
								aria-hidden="true"
							>
								{isDone ? (
									<Check className="size-2.5" strokeWidth={3} />
								) : isActive ? (
									<Loader2 className="size-2.5 animate-spin" />
								) : (
									<span className="size-1 rounded-full bg-current" />
								)}
							</span>
							<span
								className={cn(
									'text-xs transition-colors',
									isActive
										? 'font-medium text-foreground'
										: isDone
											? 'text-muted-foreground'
											: 'text-muted-foreground/60',
								)}
							>
								{step.label}
								<span className="ml-px inline-flex min-w-[14px]" aria-hidden="true">
									{isActive
										? `${activeDotCount >= 1 ? '.' : ''}${activeDotCount >= 2 ? '.' : ''}${
												activeDotCount >= 3 ? '.' : ''
											}`
										: ''}
								</span>
							</span>
						</li>
					);
				})}
			</ul>
		</div>
	);
}
