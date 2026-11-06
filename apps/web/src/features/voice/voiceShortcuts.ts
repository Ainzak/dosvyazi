export type VoiceShortcut = { code: string; ctrl: boolean; alt: boolean; shift: boolean };
export type VoiceShortcuts = { talk: VoiceShortcut | null; mute: VoiceShortcut | null };
export const plainShortcut = (code: string): VoiceShortcut => ({ code, ctrl: code === 'ControlRight', alt: false, shift: false });
export const defaultShortcuts = (): VoiceShortcuts => ({ talk: plainShortcut('KeyV'), mute: null });
const storageKey = 'dosvyazi-voice-shortcuts-v1';
const browserCtrlKeys = 'ACDFGHJKLNOPQRSTUVWXYZ';
const browserCtrlShiftKeys = 'ABCIJNOPQSTVW';

// Restrict known browser/OS commands; other platform-reserved combinations may not reach a tab.
export function validShortcut(value: unknown): value is VoiceShortcut {
  if (!value || typeof value !== 'object') return false;
  const v = value as VoiceShortcut;
  if (typeof v.ctrl !== 'boolean' || typeof v.alt !== 'boolean' || typeof v.shift !== 'boolean' || typeof v.code !== 'string') return false;
  if (v.code === 'ControlRight') return v.ctrl && !v.alt && !v.shift;
  if (!/^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F[2-4]|F[89])$/.test(v.code)) return false;
  // Ctrl+Alt overlaps AltGr text input on some layouts; Meta is never recorded.
  if (v.ctrl && v.alt) return false;
  if (v.code === 'F4' && (v.ctrl || v.alt)) return false;
  if (v.ctrl && (/^Digit/.test(v.code) || (v.code.startsWith('Key') && (v.shift ? browserCtrlShiftKeys : browserCtrlKeys).includes(v.code.slice(3))))) return false;
  return true;
}
export function sameShortcut(a: VoiceShortcut | null, b: VoiceShortcut | null) {
  return a !== null && b !== null && a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift;
}
export function savedShortcuts(): VoiceShortcuts {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw !== null) {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object') return defaultShortcuts();
      const v = value as VoiceShortcuts;
      const talk = v.talk === null || validShortcut(v.talk) ? v.talk : plainShortcut('KeyV');
      const mute = v.mute === null || validShortcut(v.mute) ? v.mute : null;
      return { talk, mute: sameShortcut(talk, mute) ? null : mute };
    }
    const legacy = localStorage.getItem('dosvyazi-ptt-key');
    return { talk: plainShortcut(legacy === 'KeyB' || legacy === 'ControlRight' ? legacy : 'KeyV'), mute: null };
  } catch { return defaultShortcuts(); }
}
export function saveShortcuts(value: VoiceShortcuts) {
  try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Current-tab bindings still work without storage. */ }
}
export function matchesShortcut(event: KeyboardEvent, binding: VoiceShortcut | null) {
  return !!binding && event.code === binding.code && event.ctrlKey === binding.ctrl && event.altKey === binding.alt && event.shiftKey === binding.shift && !event.metaKey && !event.getModifierState('AltGraph');
}
export function shortcutFromEvent(event: KeyboardEvent): VoiceShortcut | null {
  if (event.metaKey || event.isComposing || event.getModifierState('AltGraph')) return null;
  const binding = { code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey };
  return validShortcut(binding) ? binding : null;
}
export function shortcutLabel(binding: VoiceShortcut | null): string {
  if (!binding) return 'Not assigned';
  if (binding.code === 'ControlRight') return 'Right Control';
  const key = binding.code.replace(/^Key|^Digit/, '');
  return [binding.ctrl ? 'Ctrl' : '', binding.alt ? 'Alt' : '', binding.shift ? 'Shift' : '', key].filter(Boolean).join(' + ');
}
export function shortcutEditing(target: EventTarget | null) {
  return target instanceof Element && !!target.closest('input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"]), [data-voice-shortcut-recording]');
}
