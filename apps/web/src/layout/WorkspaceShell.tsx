import { useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, NavLink, useLocation, useMatch } from 'react-router';
import { AudioLines, Bell, Bookmark, Hash, Info, Menu, MessageSquare, Plus, Smile, Users, Volume2, X } from 'lucide-react';
import { communityKeys, communityListKey, getCommunity, listCommunities } from '../api/communities';
import { ApiError } from '../api/http';
import { useSession } from '../features/accounts/useSession';
import { GatheringsLink } from '../features/gatherings/GatheringLive';
import { UnreadBadge } from '../features/messages/Completeness';
import { PersistentVoiceVideo, VoiceDock } from '../features/voice/VoicePanel';
import { useI18n } from '../i18n/LocaleContext';
import { WorkspaceHeaderTarget } from './WorkspaceHeader';
import { AccountOptions } from './AccountOptions';
import { forumHref } from '../api/forums';
import { ConnectionRecovery, connectionFailure } from './ConnectionRecovery';

const mobileQuery = '(max-width: 760px)';
const subscribe = (notify: () => void) => {
  const query = window.matchMedia(mobileQuery);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};
const isMobile = () => window.matchMedia(mobileQuery).matches;

function initials(name: string) {
  return Array.from(name.trim()).slice(0, 2).join('').toLocaleUpperCase();
}

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const session = useSession();
  const client = useQueryClient();
  const [recovering, setRecovering] = useState(false);
  const user = session.data;
  const match = useMatch('/communities/:id/*');
  const id = match?.params.id;
  const location = useLocation();
  const mobile = useSyncExternalStore(subscribe, isMobile);
  const drawer = useRef<HTMLDialogElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const [headerTarget, setHeaderTarget] = useState<HTMLDivElement | null>(null);
  const list = useQuery({ queryKey: communityListKey(user?.id ?? ''), queryFn: ({ signal }) => listCommunities(signal), enabled: !!user });
  const community = useQuery({ queryKey: [...communityKeys(user?.id ?? '', id ?? ''), 'details'], queryFn: ({ signal }) => getCommunity(id!, signal), enabled: !!user && !!id,
    refetchInterval: location.pathname.includes('/gatherings') ? 3000 : false });
  const interrupted = connectionFailure(session.error) || connectionFailure(list.error);
  const denied = community.error instanceof ApiError && [401, 403, 404].includes(community.error.status);
  const current = user && id && !denied ? community.data : undefined;
  const channel = current?.channels.find(item => location.pathname === `/communities/${id}/channels/${item.id}` || location.pathname.startsWith(`/communities/${id}/channels/${item.id}/threads`) || location.pathname === forumHref(id!, item.id) || location.pathname.startsWith(forumHref(id!, item.id) + '/topics/'));
  const voiceRoom = /^\/communities\/[^/]+\/voice$/.test(location.pathname);
  const section = voiceRoom ? t('Voice room') : location.pathname.startsWith('/messages') ? t('Messages') : location.pathname.includes('/gatherings') ? t('Gatherings')
    : location.pathname === '/bookmarks' ? t('Bookmarks') : location.pathname === '/notifications' ? t('Notifications') : location.pathname.startsWith('/stickers') ? t('Sticker packs') : location.pathname.startsWith('/communities') ? t('Communities')
    : location.pathname.startsWith('/profiles/') ? t('Profile') : location.pathname === '/about' ? t('About this build') : ['/account', '/login', '/register', '/forgot-password', '/reset-password'].includes(location.pathname) ? t('Account') : t('Dosvyazi');

  const account = <div className="workspace-account"><Link to="/account" aria-label={t(user ? 'My account' : 'Sign in')}><span className="workspace-avatar" aria-hidden="true">{initials(user?.displayName ?? 'ds')}</span><span><strong>{user?.displayName ?? t('Your account')}</strong><small>{t('Account')}</small></span></Link><AccountOptions /></div>;
  const navigation = <>
    <nav className="community-rail" aria-label={t('Community shortcuts')}>
      <Link to="/" className="rail-home" aria-label={t('Dosvyazi home')} title={t('Dosvyazi home')}><AudioLines size={25} aria-hidden="true" /></Link>
      <span className="rail-divider" />
      {user && list.data?.map(item => <Link key={item.id} to={`/communities/${item.id}`} className={`rail-community${id === item.id ? ' selected' : ''}`} aria-current={id === item.id ? 'page' : undefined} aria-label={t('Open {value}', { value: item.name })} title={item.name}>{initials(item.name)}</Link>)}
      <Link to="/communities" className="rail-add" aria-label={t('Create or join a community')} title={t('Create or join a community')}><Plus size={23} aria-hidden="true" /></Link>
    </nav>
    <aside className="workspace-sidebar">
      <div className="workspace-title"><span className="workspace-avatar" aria-hidden="true">{current ? initials(current.name) : 'ds'}</span><strong>{current?.name ?? t('Dosvyazi')}</strong></div>
      <div className="workspace-navigation-content">
        <nav className="workspace-links" aria-label={t('Main navigation')}>
          <NavLink to="/messages"><MessageSquare size={20} aria-hidden="true" />{t('Messages')}</NavLink>
          <NavLink to="/communities" end><Users size={20} aria-hidden="true" />{t('Communities')}</NavLink>
          {current && <NavLink end to={`/communities/${current.id}`}><Users size={20} aria-hidden="true" />{t('Community overview')}</NavLink>}
          {current && user && <GatheringsLink user={user.id} community={current.id} live={!location.pathname.includes('/gatherings')} />}
          <NavLink to="/stickers"><Smile size={20} aria-hidden="true" />{t('Sticker packs')}</NavLink>
          {user && <><NavLink to="/notifications"><Bell size={20} aria-hidden="true" />{t('Notifications')}</NavLink><NavLink to="/bookmarks"><Bookmark size={20} aria-hidden="true" />{t('Bookmarks')}</NavLink></>}
        </nav>
        {user && list.isPending && <p role="status" className="field-hint">{t('Loading communities…')}</p>}
        {user && list.isError && !interrupted && <div><p className="field-hint" role="alert">{t('Could not load communities.')}</p><button className="secondary-button" onClick={() => void list.refetch()}>{t('Try again')}</button></div>}
        {id && community.isPending && user && <p role="status" className="field-hint">{t('Loading community…')}</p>}
        {current && user && <>
          <nav className="workspace-links channel-nav" aria-label={t('Community channels')}><h2>{t('Text channels')}</h2>
            {current.channels.filter(item => item.kind !== 'Forum').length === 0 && <p className="field-hint">{t('No accessible text channels.')}</p>}
            {current.channels.filter(item => item.kind !== 'Forum').map(item => <NavLink key={item.id} to={`/communities/${current.id}/channels/${item.id}`}><Hash size={20} aria-hidden="true" /><span>{item.categoryName && <small>{item.categoryName} / </small>}{item.name}</span><UnreadBadge user={user.id} community={current.id} channel={item.id} /></NavLink>)}
          </nav>
          {current.channels.some(item => item.kind === 'Forum') && <nav className="workspace-links channel-nav" aria-label={t('Community forums')}><h2>{t('Forums')}</h2>{current.channels.filter(item => item.kind === 'Forum').map(item => <NavLink key={item.id} to={forumHref(current.id, item.id)}><MessageSquare size={20} aria-hidden="true" /><span>{item.categoryName && <small>{item.categoryName} / </small>}{item.name}</span></NavLink>)}</nav>}
          <nav className="workspace-links" aria-label={t('Community voice')}><h2>{t('Community voice')}</h2><NavLink to={`/communities/${current.id}/voice`}><Volume2 size={20} aria-hidden="true" />{t('Voice room')}</NavLink></nav>
        </>}
        <nav className="workspace-links workspace-utilities" aria-label={t('Workspace settings')}><NavLink to="/about"><Info size={20} aria-hidden="true" />{t('About this build')}</NavLink></nav>
      </div>
      {mobile && account}
    </aside>
  </>;
  return <ConnectionRecovery.Provider value={interrupted}><WorkspaceHeaderTarget.Provider value={headerTarget}><div className="workspace-shell">
    <a className="skip-link" href="#main">{t('Skip to content')}</a>
    {mobile ? <dialog ref={drawer} className="workspace-drawer" aria-label={t('Workspace navigation')} onClick={event => {
      if (event.target instanceof Element && event.target.closest('a')) drawer.current?.close();
    }} onClose={() => menu.current?.focus()}>
      <button className="icon-button drawer-close" aria-label={t('Close navigation')} onClick={() => drawer.current?.close()}><X size={22} aria-hidden="true" /></button>{navigation}
    </dialog> : <div className="navigation-panes">{navigation}</div>}
    <div className="workspace-voice"><VoiceDock /></div>
    {!mobile && account}
    <div className="main-shell"><header className="workspace-topbar">
      {mobile && <button ref={menu} className="icon-button" aria-label={t('Open navigation')} aria-haspopup="dialog" onClick={() => drawer.current?.showModal()}><Menu size={22} aria-hidden="true" /></button>}
      <div className="workspace-breadcrumb">{channel && <Hash size={23} aria-hidden="true" />}<span><strong>{channel?.name ?? section}</strong>{current && <small>{current.name}</small>}</span></div>
      <div className="topbar-actions" ref={setHeaderTarget} />
    </header>{interrupted && <section className="workspace-recovery" aria-label={t('Connection recovery')}><p role="alert">{t('Connection interrupted. Saved data may be out of date.')}</p><button className="secondary-button" disabled={recovering} onClick={() => {
      setRecovering(true);
      void session.refetch().then(result => { if (!result.error) return client.invalidateQueries({ predicate: query => query.queryKey[0] === 'private' }); }).finally(() => setRecovering(false));
    }}>{t(recovering ? 'Checking…' : 'Restore connection')}</button></section>}<main key={location.pathname} id="main" className={voiceRoom ? 'voice-main' : channel ? 'conversation-main' : location.pathname.startsWith('/messages') ? 'direct-main' : undefined} tabIndex={-1}>{children}</main><PersistentVoiceVideo /></div>
  </div></WorkspaceHeaderTarget.Provider></ConnectionRecovery.Provider>;
}
