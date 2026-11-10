/**
 * The help text as plain data: a topic is a title and a list of blocks.
 * Text may carry **bold** and [links](https://example.org); nothing else.
 * Edit the files in `content/` to change what the Help window says.
 */
export type Block =
  | { kind: 'p'; text: string }
  /** A small heading inside a topic. */
  | { kind: 'h'; text: string }
  | { kind: 'list'; items: string[] }
  /** Labels exactly as the interface shows them, each with a line on what it does. */
  | { kind: 'options'; items: Array<[label: string, text: string]> }
  /** The credits, drawn from credits.ts. */
  | { kind: 'credits' };

export interface Topic {
  /** Stable: showHelp(id) and the e2e tests use it. */
  id: string;
  title: string;
  /** The heading it is listed under. */
  group: string;
  /**
   * The Sculpt toolbar buttons this topic documents, as the start of the
   * button's tooltip ("Standard (clay)", "Select"). A check in the e2e
   * suite walks the toolbar and wants each button named by some topic.
   */
  tools?: string[];
  /** Built on demand when it holds something that changes (the version). */
  blocks: Block[] | (() => Block[]);
}

export const p = (text: string): Block => ({ kind: 'p', text });
export const h = (text: string): Block => ({ kind: 'h', text });
export const list = (...items: string[]): Block => ({ kind: 'list', items });
export const options = (...items: Array<[string, string]>): Block => ({ kind: 'options', items });
