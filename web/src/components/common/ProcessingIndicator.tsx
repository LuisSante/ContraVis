'use client';

import { useEffect, useMemo, useState } from 'react';

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
 * Animated "processing…" indicator: a vertical list of steps where the active
 * step pulses and shows a cycling 1–3 dot ellipsis. Reusable across panels.
 *
 * Ported from the inline processing block of the Svelte `RightPanelAnalysis`
 * component (the `processingTick` interval + `activeProcessingStepIndex` /
 * `activeDotCount` derivations).
 */
export function ProcessingIndicator({
	steps = [],
	label = 'Processing panel',
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
		<div className="rounded-xl border border-gray-200 bg-gray-50/90 p-3 text-[11px] text-gray-700">
			<p className="mb-2 text-[10px] font-semibold text-gray-500">{label}</p>
			<ul className="space-y-1.5 text-[12px] text-gray-600">
				{steps.map((step, index) => {
					const isActive = index === activeProcessingStepIndex;
					return (
						<li
							key={`${step.label}-${index}`}
							className={cn(
								'relative flex items-center gap-2 transition-opacity duration-300',
								isActive ? 'opacity-100' : 'opacity-40',
							)}
						>
							{index < steps.length - 1 ? (
								<span
									className="absolute top-[13px] left-[3px] h-[18px] w-px bg-gray-300/80"
									aria-hidden="true"
								/>
							) : null}
							<span
								className={cn(
									'h-1.5 w-1.5 rounded-full bg-gray-500 transition-opacity duration-300',
									isActive ? 'animate-pulse opacity-95' : 'opacity-30',
								)}
								aria-hidden="true"
							/>
							<span className="text-gray-600">
								{step.label}
								<span
									className="ml-px inline-flex min-w-[14px] text-gray-500"
									aria-hidden="true"
								>
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
