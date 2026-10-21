import { StickersPage } from './features/stickers/StickersPage';
import { InstallPanel } from './features/delivery/InstallPanel';
import { ThreadsPage } from './features/threads/ThreadsPage';
import { ForumsPage } from './features/forums/ForumsPage';
import { useI18n } from './i18n/LocaleContext';
import { useQuery } from '@tanstack/react-query';
import { Route, Routes, Link } from 'react-router';
import { ArrowRight, CircleCheck, Database, Info, Layers3, RefreshCw, Server, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getReadiness, getSystem } from './api/client';
import { AccountPage } from './features/accounts/AccountPage';
import { PasswordRecoveryPage } from './features/accounts/PasswordRecoveryPage';
import { PublicProfilePage } from './features/accounts/PublicProfilePage';
import { GatheringsPage } from './features/gatherings/GatheringsPage';
import { CommunitiesPage, CommunityPage } from './features/communities/CommunitiesPage';
import { PrivateCacheBoundary } from './features/communities/PrivateCacheBoundary';
import { VoiceProvider } from './features/voice/VoiceProvider';
import { WorkspaceShell } from './layout/WorkspaceShell';
import { DirectPage } from './features/direct/DirectPage';
import { PersonalNavigationPage } from './features/messages/PersonalNavigationPage';

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
  const { t, locale } = useI18n();
  const system = useQuery({ queryKey: ['system'], queryFn: ({ signal }) => getSystem(signal) });
  const readiness = useQuery({ queryKey: ['readiness'], queryFn: ({ signal }) => getReadiness(signal) });
  const apiStatus: Status = system.isError ? 'unhealthy' : system.isPending ? 'checking' : 'healthy';
  const databaseStatus: Status = readiness.isError ? 'unhealthy' : readiness.isPending ? 'checking'
    : readiness.data.checks?.database === 'healthy' ? 'healthy' : 'unhealthy';
  const checking = system.isFetching || readiness.isFetching;
  const allReady = apiStatus === 'healthy' && databaseStatus === 'healthy';
  const checkedAt = Math.max(system.dataUpdatedAt, readiness.dataUpdatedAt);

  return <>
    <div className="page-heading"><div><p className="eyebrow">{t("DEVELOPMENT WORKSPACE")}</p>
      <h1>{t("A shared space starts here.")}</h1>
      <p className="page-description">{t("The first building block of Dosvyazi. Check the foundation before creating your community.")}</p></div>
      <span className="milestone-badge"><Layers3 size={16} aria-hidden="true" /> {t(" Text and voice · M3")}</span></div>
    <section aria-labelledby="services-heading">
      <div className="section-heading"><h2 id="services-heading">{t("Service status")}</h2>
        <button className="refresh-button" disabled={checking} onClick={() => { void system.refetch(); void readiness.refetch(); }}>
          <RefreshCw size={15} className={checking ? 'spinning' : ''} aria-hidden="true" />{checking ? t("Checking…") : t("Check again")}</button></div>
      <div className="service-grid" aria-live="polite">
        <ServiceCard icon={Server} title={t("Application API")} status={apiStatus}
          label={apiStatus === 'checking' ? t("Checking") : apiStatus === 'healthy' ? t("Connected") : system.data ? t("Connection lost") : t("Unavailable")}
          description={apiStatus === 'healthy' ? t("The application is responding to requests.") : apiStatus === 'checking' ? t("Connecting to the application…") : t("Start the API or check your connection, then try again.")} />
        <ServiceCard icon={Database} title={t("Database")} status={databaseStatus}
          label={databaseStatus === 'checking' ? t("Checking") : databaseStatus === 'healthy' ? t("Ready") : t("Unavailable")}
          description={databaseStatus === 'healthy' ? t("PostgreSQL is connected and ready.") : databaseStatus === 'checking' ? t("Checking the database connection…") : readiness.isError ? t("Database status could not be checked.") : t("Check the database service and local configuration.")} />
      </div>
      <div className={`connection-note ${allReady ? 'ready' : ''}`} role="status">
        {allReady ? <CircleCheck size={17} aria-hidden="true" /> : <Info size={17} aria-hidden="true" />}
        <span>{allReady ? t("Foundation connected. Ready for the next milestone.") : apiStatus === 'checking' || databaseStatus === 'checking' ? t("Checking services. This may take a moment.") : t("Some services need attention. Checks repeat automatically every 15 seconds.")}</span>
      </div>
      <p className="last-check">{checkedAt ? t("Last response at {value}", { value: new Date(checkedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : t("Waiting for the first service response.")}</p>
    </section>
    <section className="next-step" aria-labelledby="community-heading">
      <div className="community-mark"><Users size={30} aria-hidden="true" /></div>
      <p className="eyebrow">{t("YOUR SHARED SPACE")}</p><h2 id="community-heading">{t("Room for your first community.")}</h2>
      <p>{t("Create a community, invite your people and open your first text channel.")}<br className="desktop-break" /> {t(" Send messages and recover your conversation after reconnecting.")}</p>
      <Link className="about-link" to="/communities">{t("Find your shared space ")}<ArrowRight size={16} aria-hidden="true" /></Link><br />
      <Link className="about-link" to="/about">{t("Explore this build ")}<ArrowRight size={16} aria-hidden="true" /></Link>
    </section>
  </>;
}

function About() {
  const { t } = useI18n();
  return <><div className="page-heading"><div><p className="eyebrow">{t("ABOUT THIS BUILD")}</p>
    <h1>{t("One verified step at a time.")}</h1><p className="page-description">{t("Dosvyazi is taking shape, starting with a connected foundation.")}</p></div></div>
    <InstallPanel /><section className="about-panel"><h2>{t("Available now")}</h2><p>{t("Accounts, communities, roles, private text and voice, moderation, attachments, reactions, emoji, search, profiles and Gatherings with invitations, responses and reconfirmation.")}</p>
      <h2>{t("Coming in later milestones")}</h2><p>{t("Further refinements follow separately verified milestones.")}</p>
      <p>{t("This build supports shared text and voice conversations; the remaining features follow in separate milestones.")}</p><Link className="about-link" to="/">{t("Back to workspace ")}<ArrowRight size={16} aria-hidden="true" /></Link>
    </section></>;
}

function NotFound() {
  const { t } = useI18n();
  return <section className="about-panel"><h1>{t("Page not found")}</h1><p>{t("This page does not exist.")}</p><Link className="about-link" to="/">{t("Back to workspace ")}<ArrowRight size={16} aria-hidden="true" /></Link></section>;
}

export default function App() {
  return <VoiceProvider><PrivateCacheBoundary /><WorkspaceShell><Routes><Route path="/communities/:id/forums/:forumId/topics/:topicId" element={<ForumsPage />} /><Route path="/communities/:id/forums/:forumId" element={<ForumsPage />} /><Route path="/bookmarks" element={<PersonalNavigationPage />} /><Route path="/notifications" element={<PersonalNavigationPage notices />} /><Route path="/stickers/:name?" element={<StickersPage />} /><Route path="/messages/:id?" element={<DirectPage />} /><Route path="/communities/:id/gatherings/:gatheringId?" element={<GatheringsPage />} /><Route path="/profiles/:id" element={<PublicProfilePage />} /><Route path="/" element={<Workspace />} /><Route path="/about" element={<About />} /><Route path="/account" element={<AccountPage />} /><Route path="/forgot-password" element={<PasswordRecoveryPage key="request" />} /><Route path="/reset-password" element={<PasswordRecoveryPage key="reset" reset />} /><Route path="/login" element={<AccountPage mode="login" />} /><Route path="/register" element={<AccountPage mode="register" />} /><Route path="/communities" element={<CommunitiesPage />} /><Route path="/communities/:id/voice" element={<CommunityPage voiceOnly />} /><Route path="/communities/:id" element={<CommunityPage />} /><Route path="/communities/:id/channels/:channelId/threads/:threadId?" element={<ThreadsPage />} /><Route path="/communities/:id/channels/:channelId" element={<CommunityPage />} /><Route path="*" element={<NotFound />} /></Routes></WorkspaceShell></VoiceProvider>;
}
