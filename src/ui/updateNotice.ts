import { div, onTap } from './dom';

/**
 * The update notice: one small box in the bottom-right corner, the same on
 * every page that has a service worker (gallery, Sculpt, Armature, viewer),
 * in the look of the app's toasts. What it says is decided in ui/updates;
 * this is only how it is shown.
 *
 * It is never in the way. It takes no focus and blocks nothing, it sits
 * under the Capture window, the hotkey guide and the menus, it keeps clear
 * of Sculpt's corner button, the viewer's transport and an open right-hand
 * panel (place, below), and it goes with the rest of the interface when Tab
 * hides it, to come back with it.
 */
export interface NoticeContent {
  /** What it is saying, for styling and for the checks: downloading, ready, failed... */
  state: string;
  text: string;
  /**
   * A bar along the foot: a share from 0 to 1, or null for one that only
   * says something is under way. Left out, no bar.
   */
  progress?: number | null;
  /** The one thing to do about it (Reload, Try again). */
  action?: { label: string; run: () => void };
  /** Whether it can be put away (×) until it has something new to say. */
  dismissable?: boolean;
  /** More than the words say, for a pointer that hovers (why an update failed). */
  detail?: string;
  /** Gone on its own after this long, for news that needs nothing done. */
  hideAfterMs?: number;
}

class CornerNotice {
  private readonly el = div('update-notice');
  private readonly words = document.createElement('span');
  private readonly button = document.createElement('button');
  private readonly close = document.createElement('button');
  private readonly bar = div('update-notice__bar');
  private readonly fill = div('update-notice__fill');
  /** What it says now; null once cleared or timed out. */
  private current: NoticeContent | null = null;
  /** The state it was put away in; it stays away while it says the same. */
  private dismissed: string | null = null;
  private hideTimer = 0;

  constructor() {
    this.el.hidden = true;
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.words.className = 'update-notice__words';
    this.button.type = 'button';
    this.button.className = 'sculpt-toast__btn update-notice__action';
    onTap(this.button, () => this.current?.action?.run());
    this.close.type = 'button';
    this.close.className = 'sculpt-toast__btn update-notice__dismiss';
    this.close.textContent = '×';
    this.close.setAttribute('aria-label', 'Dismiss');
    onTap(this.close, () => {
      this.dismissed = this.current?.state ?? null;
      this.el.hidden = true;
    });
    this.bar.setAttribute('role', 'progressbar');
    this.bar.setAttribute('aria-label', 'Update download');
    this.bar.appendChild(this.fill);
    this.el.append(this.words, this.button, this.close, this.bar);
    document.body.appendChild(this.el);
    // What holds the corner mounts as the page boots (the transport, a
    // mode's toolbar), all straight into the body, and a panel says when
    // it opens or closes. A notice can be up before any of it.
    new MutationObserver(this.place).observe(document.body, { childList: true });
    window.addEventListener('bozzetto:panel-open', this.place);
    window.addEventListener('bozzetto:panel-close', this.place);
  }

  /**
   * Keep clear of what holds the corner on this page: Sculpt's corner
   * button, the viewer's transport, and over either of them an open
   * right-hand panel, whose foot comes down to about 90px off the bottom.
   * Judged from what the page holds rather than from where it is drawn, so
   * placing costs no layout. Script rather than :has() rules in the
   * stylesheet: those would watch the whole page, sculpting included, for
   * a box that is almost never there.
   */
  private readonly place = (): void => {
    const button = !!document.querySelector('.sculpt-toolbar__right');
    const transport = !button && !!document.querySelector('.transport');
    const panel = (button || transport) && !!document.querySelector('.panel:not(.panel--left):not(.panel--collapsed)');
    this.el.classList.toggle('update-notice--over-button', button);
    this.el.classList.toggle('update-notice--over-transport', transport);
    this.el.classList.toggle('update-notice--beside-panel', panel);
  };

  show(content: NoticeContent | null): void {
    window.clearTimeout(this.hideTimer);
    this.current = content;
    if (!content) {
      this.el.hidden = true;
      this.dismissed = null;
      return;
    }
    if (content.state !== this.dismissed) this.dismissed = null;
    this.el.dataset.state = content.state;
    // Only what changed: the box is a live region, and the bar's progress
    // is re-said several times a second.
    if (this.words.textContent !== content.text) this.words.textContent = content.text;
    if (content.detail) this.el.title = content.detail;
    else this.el.removeAttribute('title');
    this.button.hidden = !content.action;
    if (content.action && this.button.textContent !== content.action.label) this.button.textContent = content.action.label;
    this.close.hidden = !content.dismissable;
    this.el.classList.toggle('update-notice--plain', !content.action && !content.dismissable);
    this.paintBar(content.progress);
    this.place();
    this.el.hidden = this.dismissed !== null;
    if (content.hideAfterMs) {
      this.hideTimer = window.setTimeout(() => this.show(null), content.hideAfterMs);
    }
  }

  /** Bring it back after a dismissal: asked for again (the guide's Check for updates). */
  reveal(): void {
    this.dismissed = null;
    if (this.current) this.el.hidden = false;
  }

  private paintBar(progress: number | null | undefined): void {
    this.bar.hidden = progress === undefined;
    this.bar.classList.toggle('update-notice__bar--busy', progress === null);
    if (typeof progress === 'number') {
      const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
      this.fill.style.width = `${pct}%`;
      this.bar.setAttribute('aria-valuemin', '0');
      this.bar.setAttribute('aria-valuemax', '100');
      this.bar.setAttribute('aria-valuenow', String(pct));
    } else {
      this.fill.style.width = '';
      this.bar.removeAttribute('aria-valuenow');
    }
  }
}

let notice: CornerNotice | null = null;

/** Say `content` in the corner, in place of whatever it said before; null clears it. */
export function showUpdateNotice(content: NoticeContent | null): void {
  if (!content && !notice) return;
  notice ??= new CornerNotice();
  notice.show(content);
}

/** Show the notice again if it was put away. */
export function revealUpdateNotice(): void {
  notice?.reveal();
}
