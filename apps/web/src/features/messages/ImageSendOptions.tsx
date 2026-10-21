import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { imageCandidate, optimizeImage } from './imagePreparation';
import { useI18n } from '../../i18n/LocaleContext';
export function ImageSendOptions({ file, busy, choose, processing }: { file: File; busy: boolean; choose: (file: File) => void; processing: (value: boolean) => void }) {
  const { t } = useI18n(); const [original] = useState(file); const mounted = useRef(false);
  // A newly selected source resets this component through its key in the composer.
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const optimize = useMutation({ mutationFn: () => optimizeImage(original), onSuccess: result => { if (mounted.current) choose(result); } });
  useEffect(() => { processing(optimize.isPending); return () => processing(false); }, [optimize.isPending, processing]);
  if (!imageCandidate(file)) return null;
  return <div className="image-send-options"><p className="field-hint">{t('Choose the original or optimize this image before sending. Only the selected version is uploaded; smaller previews load separately on request. GIFs stay unchanged.')}</p>
    <p>{t('Original: {value} KiB', { value: Math.ceil(original.size / 1024) })} · {t('Selected: {value} KiB', { value: Math.ceil(file.size / 1024) })}</p>
    <div className="gathering-actions"><button type="button" className="secondary-button" disabled={busy || optimize.isPending} onClick={() => optimize.mutate()}>{t(optimize.isPending ? 'Optimizing image…' : 'Optimize image')}</button><button type="button" className="secondary-button" disabled={busy || optimize.isPending || file === original} onClick={() => { choose(original); optimize.reset(); }}>{t('Use original file')}</button></div>
    {optimize.isError && <p role="alert">{t(optimize.error.message)}</p>}
  </div>;
}
