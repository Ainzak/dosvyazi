import { useQuery } from '@tanstack/react-query';
import { NavLink, Route, Routes, Link } from 'react-router';
import { Activity, ArrowRight, AudioLines, CircleCheck, Database, Hash, Info, Layers3, RefreshCw, Server, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getReadiness, getSystem } from './api/client';
import { AccountPage, SessionLink } from './features/accounts/AccountPage';
import { CommunitiesPage, CommunityPage } from './features/communities/CommunitiesPage';
import { PrivateCacheBoundary } from './features/communities/PrivateCacheBoundary';

type Status = 'checking' | 'healthy' | 'unhealthy';

function ServiceCard({ icon: Icon, title, status, label, description }: {
  icon: LucideIcon; title: string; status: Status; label: string; description: string;
}) {
  return <article className="service-card" aria-label={title}>
    <div className="card-top"><span className="icon-box"><Icon size={21} aria-hidden="true" /></span>
      <span className={`status-chip ${status}`}><span className="status-dot" />{label}</span></div>
    <h2>{title}</h2><p>{description}</p>
  </article>;
}

function Workspace() {
  const system = useQuery({ queryKey: ['system'], queryFn: ({ signal }) => getSystem(signal) });
  const readiness = useQuery({ queryKey: ['readiness'], queryFn: ({ signal }) => getReadiness(signal) });
  const apiStatus: Status = system.isError ? 'unhealthy' : system.isPending ? 'checking' : 'healthy';
  const databaseStatus: Status = readiness.isError ? 'unhealthy' : readiness.isPending ? 'checking'
    : readiness.data.checks?.database === 'healthy' ? 'healthy' : 'unhealthy';
  const checking = system.isFetching || readiness.isFetching;
  const allReady = apiStatus === 'healthy' && databaseStatus === 'healthy';
  const checkedAt = Math.max(system.dataUpdatedAt, readiness.dataUpdatedAt);

  return <>
    <div className="page-heading"><div><p className="eyebrow">DEVELOPMENT WORKSPACE</p>
      <h1>A shared space starts here.</h1>
      <p className="page-description">The first building block of Dosvyazi. Check the foundation before creating your community.</p></div>
      <span className="milestone-badge"><Layers3 size={16} aria-hidden="true" /> Text chat · M2</span></div>
    <section aria-labelledby="services-heading">
      <div className="section-heading"><h2 id="services-heading">Service status</h2>
        <button className="refresh-button" disabled={checking} onClick={() => { void system.refetch(); void readiness.refetch(); }}>
          <RefreshCw size={15} className={checking ? 'spinning' : ''} aria-hidden="true" />{checking ? 'Checking…' : 'Check again'}</button></div>
      <div className="service-grid" aria-live="polite">
        <ServiceCard icon={Server} title="Application API" status={apiStatus}
          label={apiStatus === 'checking' ? 'Checking' : apiStatus === 'healthy' ? 'Connected' : system.data ? 'Connection lost' : 'Unavailable'}
          description={apiStatus === 'healthy' ? 'The application is responding to requests.' : apiStatus === 'checking'
            ? 'Connecting to the application…' : 'Start the API or check your connection, then try again.'} />
        <ServiceCard icon={Database} title="Database" status={databaseStatus}
          label={databaseStatus === 'checking' ? 'Checking' : databaseStatus === 'healthy' ? 'Ready' : 'Unavailable'}
          description={databaseStatus === 'healthy' ? 'PostgreSQL is connected and ready.' : databaseStatus === 'checking'
            ? 'Checking the database connection…' : readiness.isError ? 'Database status could not be checked.' : 'Check the database service and local configuration.'} />
      </div>
      <div className={`connection-note ${allReady ? 'ready' : ''}`} role="status">
        {allReady ? <CircleCheck size={17} aria-hidden="true" /> : <Info size={17} aria-hidden="true" />}
        <span>{allReady ? 'Foundation connected. Ready for the next milestone.' : apiStatus === 'checking' || databaseStatus === 'checking'
          ? 'Checking services. This may take a moment.' : 'Some services need attention. Checks repeat automatically every 15 seconds.'}</span>
      </div>
      <p className="last-check">{checkedAt ? `Last response at ${new Date(checkedAt).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : 'Waiting for the first service response.'}</p>
    </section>
    <section className="next-step" aria-labelledby="community-heading">
      <div className="community-mark"><Users size={30} aria-hidden="true" /></div>
      <p className="eyebrow">YOUR SHARED SPACE</p><h2 id="community-heading">Room for your first community.</h2>
      <p>Create a community, invite your people and open your first text channel.<br className="desktop-break" /> Send messages and recover your conversation after reconnecting.</p>
      <Link className="about-link" to="/communities">Find your shared space <ArrowRight size={16} aria-hidden="true" /></Link><br />
      <Link className="about-link" to="/about">Explore this build <ArrowRight size={16} aria-hidden="true" /></Link>
    </section>
  </>;
}

function About() {
  return <><div className="page-heading"><div><p className="eyebrow">ABOUT THIS BUILD</p>
    <h1>One verified step at a time.</h1><p className="page-description">Dosvyazi is taking shape, starting with a connected foundation.</p></div></div>
    <section className="about-panel"><h2>Available now</h2><p>Accounts, communities, membership, bounded invitations, owner bans, live text messages and reconnect recovery, alongside live service checks.</p>
      <h2>Coming in later milestones</h2><p>Voice channels, roles and private channel configuration, and Gatherings with invitations and responses.</p>
      <p>This build supports a shared text conversation; the remaining features follow in separate milestones.</p><Link className="about-link" to="/">Back to workspace <ArrowRight size={16} aria-hidden="true" /></Link>
    </section></>;
}

function NotFound() {
  return <section className="about-panel"><h1>Page not found</h1><p>This page does not exist.</p><Link className="about-link" to="/">Back to workspace <ArrowRight size={16} aria-hidden="true" /></Link></section>;
}

export default function App() {
  return <div className="app-shell"><PrivateCacheBoundary /><a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar"><Link to="/" className="brand" aria-label="Dosvyazi home"><span className="brand-mark"><AudioLines size={23} aria-hidden="true" /></span><span>Dosvyazi<span className="brand-subtitle">Stay connected.</span></span></Link>
      <p className="nav-heading">WORKSPACE</p><nav aria-label="Main navigation">
        <NavLink to="/" end><Activity size={18} aria-hidden="true" /> Overview</NavLink>
        <NavLink to="/about"><Info size={18} aria-hidden="true" /> About this build</NavLink>
        <NavLink to="/account"><Users size={18} aria-hidden="true" /> Account</NavLink>
        <NavLink to="/communities"><Hash size={18} aria-hidden="true" /> Communities</NavLink>
      </nav><div className="sidebar-footer"><span className="development-dot" /> Development build<span className="version">v0.1 · Text chat</span></div>
    </aside><div className="main-shell"><header className="topbar"><span>Workspace <span className="breadcrumb-divider">/</span> <span className="breadcrumb-current">Dosvyazi</span></span><SessionLink /></header>
      <main id="main" tabIndex={-1}><Routes><Route path="/" element={<Workspace />} /><Route path="/about" element={<About />} /><Route path="/account" element={<AccountPage />} /><Route path="/login" element={<AccountPage mode="login" />} /><Route path="/register" element={<AccountPage mode="register" />} /><Route path="/communities" element={<CommunitiesPage />} /><Route path="/communities/:id" element={<CommunityPage />} /><Route path="/communities/:id/channels/:channelId" element={<CommunityPage />} /><Route path="*" element={<NotFound />} /></Routes></main>
      <footer className="page-footer"><span>Dosvyazi <span aria-hidden="true">·</span> ДоСвязи</span><span>Built for shared moments.</span></footer>
    </div></div>;
}
