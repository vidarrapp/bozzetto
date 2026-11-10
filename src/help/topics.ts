import { BASICS } from './content/basics';
import { BRUSH } from './content/brush';
import { MODES } from './content/modes';
import { PANELS } from './content/panels';
import { SETTINGS } from './content/settings';
import { TOOLS } from './content/tools';
import { CREDIT_GROUPS } from './credits';
import type { Block, Topic } from './types';

export type { Block, Topic } from './types';

/**
 * Every topic of the Help window, in the order it lists them. The text is
 * in `content/`, one file a group, as plain data.
 */
export const TOPICS: Topic[] = [...BASICS, ...TOOLS, ...BRUSH, ...PANELS, ...MODES, ...SETTINGS];

/** The topic's blocks, built if it builds them on demand. */
export function blocksOf(topic: Topic): Block[] {
  return typeof topic.blocks === 'function' ? topic.blocks() : topic.blocks;
}

/** Without the **bold** and [link](url) marks: what the filter searches and a reader reads. */
export function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
}

/** A topic's title and body as one lower-case string, for the filter. */
export function searchText(topic: Topic): string {
  const parts: string[] = [topic.title, topic.group];
  for (const b of blocksOf(topic)) {
    switch (b.kind) {
      case 'p':
      case 'h':
        parts.push(plain(b.text));
        break;
      case 'list':
        parts.push(...b.items.map(plain));
        break;
      case 'options':
        for (const [label, text] of b.items) parts.push(label, plain(text));
        break;
      case 'credits':
        for (const g of CREDIT_GROUPS) {
          parts.push(g.title);
          for (const c of g.credits) parts.push(c.name, c.use, c.licence, c.note ?? '');
        }
        break;
    }
  }
  return parts.join('\n').toLowerCase();
}
