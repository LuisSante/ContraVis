import type { ChangeLogState } from '../types/document';

export const highlightMap: Record<string, string> = {
    yellow: '#fff59d',
    green: '#a5d6a7',
    cyan: '#80deea',
    magenta: '#f48fb1',
    blue: '#90caf9',
    red: '#ef9a9a',
    darkblue: '#5c6bc0',
    darkcyan: '#26a69a',
    darkgreen: '#43a047',
    darkmagenta: '#ab47bc',
    darkred: '#e53935',
    darkyellow: '#f9a825',
    lightgray: '#e0e0e0',
    darkgray: '#757575',
    black: '#000000',
    white: '#ffffff',
    none: 'transparent'
};


export const EMPTY_CHANGE_LOG: ChangeLogState = {
    hasChanges: false,
    oldSegments: [],
    newSegments: []
};

export const MAX_RELATED_PARAGRAPHS = 0;
