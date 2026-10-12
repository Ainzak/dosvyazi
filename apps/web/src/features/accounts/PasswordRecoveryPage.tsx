import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { forgotPassword, resetPassword, sessionKey } from '../../api/accounts';
import { useI18n } from '../../i18n/LocaleContext';

export function PasswordRecoveryPage({ reset = false }: { reset?: boolean }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [link] = useState(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    return { email: params.get('email') ?? '', code: params.get('code') ?? '' };
  });
  useEffect(() => { if (reset) history.replaceState(history.state, '', location.pathname + location.search); }, [reset]);
  const request = useMutation({ mutationFn: forgotPassword });
  const submit = useMutation({ mutationFn: resetPassword, onSuccess: async () => {
    await queryClient.cancelQueries(); queryClient.clear(); queryClient.setQueryData(sessionKey, null);
  } });
  return <div className="account-page"><section className="account-card">
    <h1>{t(reset ? 'Reset your password' : 'Forgot your password?')}</h1>
    <p className="field-hint">{t('During development, local builds show a reset link without sending email. On a public server, ask the operator for a link. Email delivery is planned for a future release.')}</p>
    {reset ? submit.isSuccess ? <><p role="status">{t('Password reset. Your previous sessions have been signed out.')}</p><Link to="/login">{t('Sign in')}</Link></> : !link.email || !link.code ? <><p role="alert">{t('This reset link is incomplete. Request a new link.')}</p><Link to="/forgot-password">{t('Request a reset link')}</Link></> : <form onSubmit={event => {
      event.preventDefault(); const data = new FormData(event.currentTarget);
      submit.mutate({ ...link, password: String(data.get('password') ?? '') });
    }}>
      <label htmlFor="new-password">{t('New password')}</label><input id="new-password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required onChange={event => { const input = event.currentTarget.form?.querySelector<HTMLInputElement>('[name=confirmation]'); if (input) input.setCustomValidity(input.value && input.value !== event.currentTarget.value ? t('Passwords must match.') : ''); }} />
      <label htmlFor="confirm-password">{t('Confirm new password')}</label><input id="confirm-password" name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required onChange={event => { const password = event.currentTarget.form?.querySelector<HTMLInputElement>('[name=password]')?.value; event.currentTarget.setCustomValidity(event.currentTarget.value !== password ? t('Passwords must match.') : ''); }} />
      <p className="field-hint">{t('Use 12–128 characters with at least 4 different characters. A long passphrase works well.')}</p>
      {submit.isError && <p role="alert" className="form-error">{t(submit.error.message)}</p>}
      <button className="primary-button" disabled={submit.isPending}>{t(submit.isPending ? 'Please wait…' : 'Reset password')}</button>
    </form> : <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); request.mutate({ email: String(data.get('email') ?? '') }); }}>
      <label htmlFor="recovery-email">{t('Email address')}</label><input id="recovery-email" name="email" type="email" autoComplete="email" maxLength={254} required />
      {request.isError && <p role="alert" className="form-error">{t(request.error.message)}</p>}
      {request.isSuccess && <><p role="status">{t(request.data.message)}</p>{request.data.developmentLink && <Link to={request.data.developmentLink}>{t('Open development reset link')}</Link>}</>}
      <button className="primary-button" disabled={request.isPending}>{t(request.isPending ? 'Please wait…' : 'Request a reset link')}</button>
    </form>}
    <p><Link to="/login">{t('Back to sign in')}</Link></p>
  </section></div>;
}
