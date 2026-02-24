import type { 
    Docx4jsBrowserModule,
    XmlNode 
} from '$lib/types/document'
import { 
    highlightMap,
} from '$lib/constant';

export function localName(tag?: string): string {
    return tag?.split(':').pop()?.toLowerCase() ?? '';
}

export function normalizeEditableText(raw: string): string {
    return raw.replace(/\u00a0/g, ' ').replace(/\r/g, '');
}

export function toNumber(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function toTwipsPx(value: unknown): number | null {
    const parsed = toNumber(value);
    if (parsed == null) return null;
    return parsed / 15;
}

export function toBorderPx(value: unknown): number | null {
    const parsed = toNumber(value);
    if (parsed == null) return null;
    return parsed / 6;
}

export function getAttr(node: XmlNode | null | undefined, attr: string): string | undefined {
    const attribs =
        node &&
        typeof node === 'object' &&
        node.attribs &&
        typeof node.attribs === 'object' &&
        !Array.isArray(node.attribs)
            ? node.attribs
            : null;

    if (!attribs) return undefined;
    if (attribs[attr] !== undefined) return attribs[attr];

    for (const [key, value] of Object.entries(attribs)) {
        if (localName(key) === localName(attr)) return value;
    }

    return undefined;
}

export function findChild(node: XmlNode | null | undefined, name: string): XmlNode | undefined {
    return node?.children?.find((child) => localName(child.name) === name.toLowerCase());
}

export function isOn(node?: XmlNode | null): boolean {
    if (!node) return false;
    const raw = (getAttr(node, 'val') ?? '').toLowerCase();
    return raw === '' || !['0', 'false', 'off', 'none', 'nil'].includes(raw);
}

export function normalizeColor(raw?: string): string | null {
    if (!raw) return null;
    const value = raw.trim();
    if (!value || value.toLowerCase() === 'auto' || value.toLowerCase() === 'none') return null;
    if (value.startsWith('#')) return value;
    if (/^[0-9a-f]{6}$/i.test(value)) return `#${value}`;
    return value;
}

export function setStyles(el: HTMLElement, styles: unknown) {
    if (!styles || typeof styles !== 'object' || Array.isArray(styles)) return;
    for (const [key, value] of Object.entries(styles as Record<string, string | undefined | null>)) {
        if (value == null || value === '') continue;
        el.style.setProperty(key, value);
    }
}

export function toNodeList(children: unknown): Node[] {
    if (children == null) return [];
    if (children instanceof Node) return [children];
    if (Array.isArray(children)) return children.flatMap((child) => toNodeList(child));
    if (typeof children === 'string' || typeof children === 'number') {
        return [document.createTextNode(String(children))];
    }
    return [];
}

export function appendChildren(parent: Node, children: unknown) {
    for (const child of toNodeList(children)) {
        parent.appendChild(child);
    }
}

export function resolveDocx4jsFromRequire(): Docx4jsBrowserModule | null {
    const maybeRequire = (
        globalThis as typeof globalThis & { require?: (moduleName: string) => unknown }
    ).require;
    if (typeof maybeRequire !== 'function') return null;

    try {
        const mod = maybeRequire('docx4js') as Partial<Docx4jsBrowserModule> | undefined;
        if (mod?.docx?.load) return mod as Docx4jsBrowserModule;
    } catch {
        return null;
    }

    return null;
}

export function hasOnlySectionBreak(pr?: XmlNode | null): boolean {
    if (!pr?.children || pr.children.length !== 1) return false;
    return localName(pr.children[0].name) === 'sectpr';
}

export function getParagraphStyles(pr?: XmlNode | null): Record<string, string> {
    const style: Record<string, string> = {
        'margin-top': '0',
        'margin-bottom': '0',
        'white-space': 'pre-wrap',
        'word-break': 'break-word'
    };

    if (!pr) return style;

    const alignment = getAttr(findChild(pr, 'jc'), 'val')?.toLowerCase();
    if (alignment === 'both') style['text-align'] = 'justify';
    if (alignment && alignment !== 'both') style['text-align'] = alignment;

    const spacing = findChild(pr, 'spacing');
    const before = toTwipsPx(getAttr(spacing, 'before'));
    const after = toTwipsPx(getAttr(spacing, 'after'));
    const line = toNumber(getAttr(spacing, 'line'));
    const lineRule = getAttr(spacing, 'lineRule')?.toLowerCase();

    if (before != null) style['margin-top'] = `${before}px`;
    if (after != null) style['margin-bottom'] = `${after}px`;
    if (line != null) {
        if (lineRule === 'auto') {
            style['line-height'] = `${Math.max(1, line / 240)}`;
        } else {
            const linePx = toTwipsPx(line);
            if (linePx != null) style['line-height'] = `${Math.max(linePx, 1)}px`;
        }
    }

    const indent = findChild(pr, 'ind');
    const left = toTwipsPx(getAttr(indent, 'left'));
    const right = toTwipsPx(getAttr(indent, 'right'));
    const firstLine = toTwipsPx(getAttr(indent, 'firstLine'));
    const hanging = toTwipsPx(getAttr(indent, 'hanging'));

    if (left != null) style['padding-left'] = `${left}px`;
    if (right != null) style['padding-right'] = `${right}px`;
    if (firstLine != null) style['text-indent'] = `${firstLine}px`;
    if (hanging != null) style['text-indent'] = `${-hanging}px`;

    return style;
}

export function getRunStyles(pr?: XmlNode | null): Record<string, string> {
    const style: Record<string, string> = {};
    if (!pr) return style;

    const bold = findChild(pr, 'b') ?? findChild(pr, 'bcs');
    const italic = findChild(pr, 'i') ?? findChild(pr, 'ics');
    const underline = findChild(pr, 'u');
    const strike = findChild(pr, 'strike') ?? findChild(pr, 'dstrike');
    const caps = findChild(pr, 'caps');
    const smallCaps = findChild(pr, 'smallcaps');
    const verticalAlign = findChild(pr, 'vertalign');
    const color = findChild(pr, 'color');
    const size = findChild(pr, 'sz');
    const fonts = findChild(pr, 'rfonts');
    const highlight = findChild(pr, 'highlight');

    if (isOn(bold)) style['font-weight'] = '700';
    if (isOn(italic)) style['font-style'] = 'italic';
    if (underline && (getAttr(underline, 'val') ?? 'single').toLowerCase() !== 'none') {
        style['text-decoration-line'] = 'underline';
    }
    if (isOn(strike)) style['text-decoration-line'] = 'line-through';
    if (isOn(caps)) style['text-transform'] = 'uppercase';
    if (isOn(smallCaps)) style['font-variant'] = 'small-caps';

    const va = getAttr(verticalAlign, 'val')?.toLowerCase();
    if (va === 'superscript') style['vertical-align'] = 'super';
    if (va === 'subscript') style['vertical-align'] = 'sub';

    const colorValue = normalizeColor(getAttr(color, 'val'));
    if (colorValue) style.color = colorValue;

    const fontSize = toNumber(getAttr(size, 'val'));
    if (fontSize != null) style['font-size'] = `${Math.max(fontSize / 2, 1)}pt`;

    const fontFamily =
        getAttr(fonts, 'ascii') ??
        getAttr(fonts, 'hAnsi') ??
        getAttr(fonts, 'eastAsia') ??
        getAttr(fonts, 'cs');
    if (fontFamily) style['font-family'] = `"${fontFamily}"`;

    const highlightKey = getAttr(highlight, 'val')?.toLowerCase();
    if (highlightKey) {
        style['background-color'] = highlightMap[highlightKey] ?? highlightKey;
    }

    return style;
}

export function getSectionLayout(sectPr?: XmlNode | null) {
    const defaultLayout = {
        width: 793,
        height: 1122,
        marginTop: 96,
        marginRight: 96,
        marginBottom: 96,
        marginLeft: 96
    };

    if (!sectPr) return defaultLayout;

    const pgSz = findChild(sectPr, 'pgsz');
    const pgMar = findChild(sectPr, 'pgmar');

    let width = toTwipsPx(getAttr(pgSz, 'w')) ?? defaultLayout.width;
    let height = toTwipsPx(getAttr(pgSz, 'h')) ?? defaultLayout.height;
    const orient = getAttr(pgSz, 'orient')?.toLowerCase();
    if (orient === 'landscape' && width < height) {
        [width, height] = [height, width];
    }

    return {
        width,
        height,
        marginTop: toTwipsPx(getAttr(pgMar, 'top')) ?? defaultLayout.marginTop,
        marginRight: toTwipsPx(getAttr(pgMar, 'right')) ?? defaultLayout.marginRight,
        marginBottom: toTwipsPx(getAttr(pgMar, 'bottom')) ?? defaultLayout.marginBottom,
        marginLeft: toTwipsPx(getAttr(pgMar, 'left')) ?? defaultLayout.marginLeft
    };
}

export function parseBorder(border?: XmlNode): string | null {
    if (!border) return null;
    const val = (getAttr(border, 'val') ?? 'single').toLowerCase();
    if (val === 'none' || val === 'nil') return 'none';

    const width = Math.max(toBorderPx(getAttr(border, 'sz')) ?? 0.5, 0.5);
    const color = normalizeColor(getAttr(border, 'color')) ?? '#000000';
    const cssType = val.includes('dot') ? 'dotted' : val.includes('dash') ? 'dashed' : 'solid';
    return `${width}px ${cssType} ${color}`;
}