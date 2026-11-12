import '@flaticon/flaticon-uicons/css/solid/straight.css';

/**
 * Delete, as the pages draw it: a trash icon (the Uicons solid-straight
 * font, `fi-ss-trash`), grey at rest and red under the pointer and on
 * focus (`.trash-btn` in style.css). The icon has no words, so the button
 * carries its name: "Delete <title>". The question that follows keeps its
 * filled red button.
 */
export function trashButton(label: string, className = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `trash-btn${className ? ` ${className}` : ''}`;
  b.setAttribute('aria-label', label);
  b.title = label;
  const icon = document.createElement('i');
  icon.className = 'fi fi-ss-trash';
  icon.setAttribute('aria-hidden', 'true');
  b.appendChild(icon);
  return b;
}
