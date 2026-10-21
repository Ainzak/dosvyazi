import { expect } from '@playwright/test';
import type { Locator } from '@playwright/test';

// Check rendered foreground against the nearest painted surface, rather than
// asserting a particular theme token. Opaque application cards are intentional.
// Relative luminance: https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
export async function expectReadableText(surface: Locator) {
  const failures = await surface.evaluate(root => {
    const rgb = (value: string) => value.match(/[\d.]+/g)?.map(Number) ?? [];
    const luminance = (channels: number[]) => channels.slice(0, 3).map(n => {
      const s = n / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    }).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0);
    return [...root.querySelectorAll('h1,h2,p,label,strong,dt,dd,button,a,input,textarea')].flatMap(element => {
      const style = getComputedStyle(element);
      if (!element.getClientRects().length || style.visibility === 'hidden' || !(element.textContent?.trim() || element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return [];
      let ancestor: Element | null = element; let background: number[] = [];
      while (ancestor) {
        const color = rgb(getComputedStyle(ancestor).backgroundColor);
        if (color.length === 3 || color[3] === 1) { background = color; break; }
        ancestor = ancestor.parentElement;
      }
      if (background.length < 3) return [`Unresolved surface: ${element.tagName}`];
      const foreground = luminance(rgb(style.color)); const back = luminance(background);
      const ratio = (Math.max(foreground, back) + .05) / (Math.min(foreground, back) + .05);
      return ratio >= 4.5 ? [] : [`${element.tagName}: ${(element.textContent ?? '').trim().slice(0, 45)} (${ratio.toFixed(2)}:1)`];
    });
  });
  expect(failures, 'Rendered account/profile text must remain readable against its surface').toEqual([]);
}
