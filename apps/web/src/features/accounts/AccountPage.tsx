import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { login, logout, register, sessionKey, updateProfile } from '../../api/accounts';
import type { UserProfile } from '../../api/accounts';
import { useSession } from './useSession';

function Profile({ user }: { user: UserProfile }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const update = useMutation({ mutationFn: updateProfile, onSuccess: profile => queryClient.setQueryData(sessionKey, profile) });
  const signOut = useMutation({ mutationFn: logout, onSuccess: async () => {
    await queryClient.cancelQueries({ queryKey: sessionKey });
    queryClient.setQueryData(sessionKey, null);
    navigate('/login');
  } });
  return <section className="account-card"><div className="account-avatar"><UserRound size={28} aria-hidden="true" /></div>
    <p className="eyebrow">YOUR ACCOUNT</p><h1>Welcome, {user.displayName}.</h1>
    <p className="account-intro">Your profile is ready. <Link to="/communities">Explore your communities.</Link></p>
    <div className="account-email"><span>Email address</span><strong>{user.email}</strong></div>
    <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); update.mutate({ displayName: String(data.get('displayName') ?? '') }); }}>
      <label htmlFor="displayName">Display name</label>
      <input key={user.displayName} id="displayName" name="displayName" autoComplete="nickname" minLength={2} maxLength={40} defaultValue={user.displayName} required />
      <p className="field-hint">2–40 characters. This is how others will see you.</p>
      {update.isError && <p role="alert" className="form-error">{update.error.message}</p>}
      {update.isSuccess && <p role="status" className="form-success">Profile saved.</p>}
      <button className="primary-button" disabled={update.isPending || signOut.isPending}>{update.isPending ? 'Saving…' : 'Save profile'}</button>
    </form>
    <div className="account-security"><ShieldCheck size={17} aria-hidden="true" /><span>Sign out when you finish on a shared device.</span></div>
    {signOut.isError && <p role="alert" className="form-error">{signOut.error.message}</p>}
    <button className="sign-out-button" onClick={() => signOut.mutate()} disabled={signOut.isPending || update.isPending}><LogOut size={16} aria-hidden="true" />{signOut.isPending ? 'Signing out…' : 'Sign out'}</button>
  </section>;
}

function SignInForm({ mode }: { mode: 'login' | 'register' }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isRegister = mode === 'register';
  const submit = useMutation({ mutationFn: (data: FormData) => {
    const credentials = { email: String(data.get('email') ?? ''), password: String(data.get('password') ?? '') };
    return isRegister ? register({ ...credentials, displayName: String(data.get('displayName') ?? '') }) : login(credentials);
  }, onSuccess: async profile => {
    await queryClient.cancelQueries({ queryKey: sessionKey });
    queryClient.setQueryData(sessionKey, profile);
    navigate('/account');
  } });
  return <section className="account-card"><div className="account-avatar"><UserRound size={28} aria-hidden="true" /></div>
    <p className="eyebrow">{isRegister ? 'MAKE YOURSELF AT HOME' : 'GOOD TO SEE YOU'}</p>
    <h1>{isRegister ? 'Create your account.' : 'Welcome back.'}</h1>
    <p className="account-intro">{isRegister ? 'Your first step toward a shared space.' : 'Sign in to your Dosvyazi account.'}</p>
    <form onSubmit={event => { event.preventDefault(); submit.mutate(new FormData(event.currentTarget)); }}>
      {isRegister && <><label htmlFor="displayName">Display name</label><input id="displayName" name="displayName" autoComplete="nickname" minLength={2} maxLength={40} required /></>}
      <label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" maxLength={254} required />
      <label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 12 : 1} maxLength={128} required />
      {isRegister && <p className="field-hint">Use 12–128 characters with at least 4 different characters. A long passphrase works well.</p>}
      {submit.isError && <p role="alert" className="form-error">{submit.error.message}</p>}
      <button className="primary-button" disabled={submit.isPending}>{submit.isPending ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}</button>
    </form>
    <p className="account-switch">{isRegister ? 'Already have an account? ' : 'New to Dosvyazi? '}<Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link></p>
  </section>;
}

export function AccountPage({ mode = 'login' }: { mode?: 'login' | 'register' }) {
  const session = useSession();
  return <div className="account-page">
    {session.isPending ? <section className="account-card"><p role="status">Checking your session…</p></section>
      : session.isError ? <section className="account-card"><h1>Connection interrupted.</h1><p role="alert" className="form-error">We could not check your session. Check your connection and try again.</p><button className="primary-button" onClick={() => void session.refetch()} disabled={session.isFetching}>{session.isFetching ? 'Checking…' : 'Try again'}</button></section>
      : session.data ? <Profile key={session.data.id} user={session.data} /> : <SignInForm key={mode} mode={mode} />}
  </div>;
}

export function SessionLink() {
  const session = useSession();
  return <Link className="session-link" to="/account"><UserRound size={16} aria-hidden="true" />{session.isError ? 'Check session' : session.data ? 'My account' : 'Sign in'}</Link>;
}
