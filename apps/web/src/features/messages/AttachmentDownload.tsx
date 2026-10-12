import { useMutation } from '@tanstack/react-query';
import { attachmentUrl } from '../../api/messages';
import { callApi, readJson } from '../../api/http';
import { useI18n } from '../../i18n/LocaleContext';
import type { components } from '../../api/schema';

export function AttachmentDownload({ attachment, community, channel }: { attachment: components['schemas']['AttachmentDto']; community: string; channel: string }) {
  const { t } = useI18n();
  const download = useMutation({ mutationFn: async () => {
    const response = await callApi(attachmentUrl(community, channel, attachment.id), {}, 30_000);
    if (!response.ok) await readJson(response);
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = attachment.name;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  return <div className="message-attachment"><button className="secondary-button" disabled={download.isPending} onClick={() => download.mutate()}>{t(download.isPending ? 'Downloading…' : 'Download file')}: {attachment.name}</button><small>{Math.ceil(Number(attachment.size) / 1024)} KiB</small>{download.isError && <p role="alert">{t(download.error.message)}</p>}</div>;
}
