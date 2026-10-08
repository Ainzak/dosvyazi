import { useQuery } from '@tanstack/react-query';
import { NavLink, Route, Routes, Link } from 'react-router';
import { Activity, ArrowRight, AudioLines, CircleCheck, Database, Info, Layers3, RefreshCw, Server, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getReadiness, getSystem } from './api/client';

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
      <span className="milestone-badge"><Layers3 size={16} aria-hidden="true" /> Foundation · M1</span></div>
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
      <p className="eyebrow">NEXT MILESTONE</p><h2 id="community-heading">Room for your first community.</h2>
      <p>Accounts, communities and a shared text channel come next.<br className="desktop-break" /> This build establishes the development foundation.</p>
      <Link className="about-link" to="/about">Explore this build <ArrowRight size={16} aria-hidden="true" /></Link>
    </section>
  </>;
}

function About() {
  return <><div className="page-heading"><div><p className="eyebrow">ABOUT THIS BUILD</p>
    <h1>One verified step at a time.</h1><p className="page-description">Dosvyazi is taking shape, starting with a connected foundation.</p></div></div>
    <section className="about-panel"><h2>Available now</h2><p>A responsive workspace, a live application API and database readiness checks. Service status reflects actual responses.</p>
      <h2>Coming in later milestones</h2><p>Accounts and communities, text and voice channels, roles and private access, and Gatherings with invitations and responses.</p>
      <p>Communication features are still to be implemented.</p><Link className="about-link" to="/">Back to workspace <ArrowRight size={16} aria-hidden="true" /></Link>
    </section></>;
}

function NotFound() {
  return <section className="about-panel"><h1>Page not found</h1><p>This page does not exist.</p><Link className="about-link" to="/">Back to workspace <ArrowRight size={16} aria-hidden="true" /></Link></section>;
}

export default function App() {
  return <div className="app-shell"><a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar"><Link to="/" className="brand" aria-label="Dosvyazi home"><span className="brand-mark"><AudioLines size={23} aria-hidden="true" /></span><span>Dosvyazi<span className="brand-subtitle">Stay connected.</span></span></Link>
      <p className="nav-heading">WORKSPACE</p><nav aria-label="Main navigation">
        <NavLink to="/" end><Activity size={18} aria-hidden="true" /> Overview</NavLink>
        <NavLink to="/about"><Info size={18} aria-hidden="true" /> About this build</NavLink>
      </nav><div className="sidebar-footer"><span className="development-dot" /> Development build<span className="version">v0.1 · Foundation</span></div>
    </aside><div className="main-shell"><header className="topbar"><span>Workspace <span className="breadcrumb-divider">/</span> <span className="breadcrumb-current">Foundation</span></span><span className="environment-label">LOCAL DEVELOPMENT</span></header>
      <main id="main" tabIndex={-1}><Routes><Route path="/" element={<Workspace />} /><Route path="/about" element={<About />} /><Route path="*" element={<NotFound />} /></Routes></main>
      <footer className="page-footer"><span>Dosvyazi <span aria-hidden="true">·</span> ДоСвязи</span><span>Built for shared moments.</span></footer>
    </div></div>;
}
