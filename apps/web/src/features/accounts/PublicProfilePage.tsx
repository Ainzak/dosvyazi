import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { useSession } from './useSession';
import { profile, saveProfileDetails } from '../../api/completeness';
import { useI18n } from '../../i18n/LocaleContext';
import { ArrowLeft, MessageSquare, UserRound } from 'lucide-react';

export function PublicProfilePage() {
  const { id = '' } = useParams(); const session = useSession(); const { t } = useI18n(); const client = useQueryClient();
  const key = ['private', session.data?.id, 'profile', id];
  const data = useQuery({ queryKey: key, queryFn: ({ signal }) => profile(id, signal), enabled: !!session.data });
  const save = useMutation({ mutationFn: saveProfileDetails, onSuccess: result => client.setQueryData(key, result) });
  if (session.isPending) return <p role="status">{t('Checking your session…')}</p>;
  if (session.isError) return <p role="alert">{t(session.error.message)}</p>;
  if (!session.data) return <section className="account-card"><h1>{t('Sign in to view profiles.')}</h1><Link to="/login">{t('Sign in')}</Link></section>;
  return <section className="account-card public-profile"><Link className="settings-back" to="/account"><ArrowLeft size={16} aria-hidden="true" />{t('My account')}</Link><header className="settings-page-heading"><div className="account-avatar"><UserRound size={28} aria-hidden="true" /></div><div><p className="eyebrow">{t(id === session.data.id ? 'Your public profile' : 'Profile')}</p><h1>{data.data?.displayName ?? t('Profile')}</h1><p className="field-hint">{t('Profile details are visible to any signed-in user. Your account email stays private.')}</p></div></header>
    {data.isPending && <p role="status">{t('Loading profile…')}</p>}{data.isError && <><p role="alert">{t(data.error.message)}</p><button className="secondary-button" onClick={() => void data.refetch()}>{t('Try again')}</button></>}
    {data.data && id !== session.data.id && <Link className="secondary-button profile-message" to={`/messages?to=${id}`}><MessageSquare size={18} aria-hidden="true" />{t('Message')}</Link>}
    {data.data && (id === session.data.id ? <form key={id} onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); save.mutate({ about: String(form.get('about') ?? ''), interests: String(form.get('interests') ?? ''), games: String(form.get('games') ?? ''), lookingFor: String(form.get('lookingFor') ?? '') }); }}>
      {(['about', 'interests', 'games', 'lookingFor'] as const).map(field => <div key={field}><label htmlFor={`profile-${field}`}>{t({ about: 'About me', interests: 'Interests', games: 'Games I play', lookingFor: 'Looking for teammates' }[field])}</label><textarea id={`profile-${field}`} name={field} maxLength={field === 'about' ? 1000 : 500} rows={3} defaultValue={data.data![field]} disabled={save.isPending} /></div>)}
      <p className="field-hint">{t('Enter games and interests manually. No external catalog or activity tracking is used.')}</p><button className="primary-button" disabled={save.isPending}>{t(save.isPending ? 'Saving…' : 'Save profile details')}</button>{save.isSuccess && <p role="status">{t('Profile saved.')}</p>}{save.isError && <p role="alert">{t(save.error.message)}</p>}
    </form> : <dl>{(['about', 'interests', 'games', 'lookingFor'] as const).map(field => <div key={field}><dt>{t({ about: 'About me', interests: 'Interests', games: 'Games I play', lookingFor: 'Looking for teammates' }[field])}</dt><dd>{data.data![field] || t('Not provided yet.')}</dd></div>)}</dl>)}
  </section>;
}
