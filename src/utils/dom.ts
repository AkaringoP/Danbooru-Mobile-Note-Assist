/**
 * DOM utility helpers — small, pure reads of the document tree.
 *
 * Layer 1 (utils): no imports from state/, api/, ui/, interactions/,
 * confirm/, or main.ts.
 */

/**
 * Returns true if `el` is a focusable text input — `<input>`,
 * `<textarea>`, or any `[contenteditable="true"]`. Used by hotkey
 * handlers to gate global shortcuts (Shift+N etc.) so they don't
 * fire while the user is typing in Danbooru's tag editor.
 */
export function isTextInputElement(el: Element | null): boolean {
  if (!el) {
    return false;
  }
  if ((el as HTMLElement).isContentEditable === true) {
    return true;
  }
  return (
    el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' &&
      ![
        'checkbox',
        'radio',
        'button',
        'submit',
        'image',
        'file',
        'range',
        'color',
      ].includes((el as HTMLInputElement).type))
  );
}

/**
 * Returns the post's main `<img>` element, or null if not yet in the
 * DOM. Danbooru renders it inside `#image-container` on post pages;
 * `id="image"` is a stable hook.
 */
export function getImageElement(): HTMLImageElement | null {
  return document.getElementById('image') as HTMLImageElement | null;
}
