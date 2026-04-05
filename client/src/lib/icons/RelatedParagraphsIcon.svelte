<script lang="ts">
	export let className = 'h-4 w-4';
	export let strokeWidth: number | string = 1.8;
	export let color = 'currentColor';
	export let size: number | string = 24;
</script>

<svg
	xmlns="http://www.w3.org/2000/svg"
	viewBox="0 0 24 24"
	width={size}
	height={size}
	class={className}
	fill="none"
	stroke={color}
	stroke-width={strokeWidth}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	{...$$restProps}
>
	<g id="ic-statistics-4">
		<circle cx="7" cy="16" r="2" />
		<circle cx="16" cy="6" r="3" />
		<circle cx="18" cy="18" r="4" />
		<circle cx="4" cy="4" r="2" />
		<line x1="14" y1="18" x2="8.76" y2="16.95" />
		<line x1="16.96" y1="8.84" x2="18.28" y2="14.02" />
		<line x1="6" y1="4" x2="13.16" y2="5.02" />
		<path d="M6.74,14C7,14,4.36,6,4.36,6" fill-rule="evenodd" />
	</g>
</svg>
