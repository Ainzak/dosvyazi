import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { deleteMessage, editMessage } from '../../api/messages';
import type { Message } from '../../api/messages';

export function MessageActions({ message, community, channel, canEdit, canDelete, refresh }: { message: Message; community: string; channel: string; canEdit: boolean; canDelete: boolean; refresh: () => Promise<void> }) {
  const [mode, setMode] = useState<'edit' | 'delete' | null>(null);
  const [draft, setDraft] = useState(message.content);
  const version = useRef(message.version);
  const command = useRef({ payload: '', id: crypto.randomUUID() });
  const change = useMutation({ mutationFn: () => {
    const payload = JSON.stringify({ mode, draft, version: version.current });
    if (command.current.payload !== payload) command.current = { payload, id: crypto.randomUUID() };
    return mode === 'delete' ? deleteMessage(community, channel, message.id, command.current.id, version.current)
      : editMessage(community, channel, message.id, command.current.id, version.current, draft);
  }, onSuccess: async () => { setMode(null); await refresh(); } });
  const start = (next: typeof mode) => { version.current = message.version; setDraft(message.content); setMode(next); change.reset(); };
  return <div className="message-actions">
    {!mode && <>{canEdit && <button className="secondary-button" aria-label={`Edit message by ${message.authorName}`} onClick={() => start('edit')}>Edit</button>}{canDelete && <button className="secondary-button" aria-label={`Delete message by ${message.authorName}`} onClick={() => start('delete')}>Delete</button>}</>}
    {mode === 'edit' && <form onSubmit={e => { e.preventDefault(); change.mutate(); }}><label>Edit message<textarea aria-label="Edit message text" rows={3} required maxLength={4000} value={draft} onChange={e => setDraft(e.target.value)} disabled={change.isPending} /></label><button className="primary-button" disabled={change.isPending || !draft.trim()}>Save message</button></form>}
    {mode === 'delete' && <><p>Delete this message?</p><button className="secondary-button" disabled={change.isPending} onClick={() => change.mutate()}>Confirm delete</button></>}
    {mode && <button className="secondary-button" disabled={change.isPending} onClick={() => setMode(null)}>Cancel change</button>}
    {change.isError && <p role="alert">{change.error.message} Your draft is retained. Cancel and reopen to use the latest version.</p>}
  </div>;
}
