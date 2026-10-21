import { StickerPackInfo } from '../stickers/StickerPackInfo';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { attachmentUrl } from '../../api/messages';
import { callApi, readJson } from '../../api/http';
import { useI18n } from '../../i18n/LocaleContext';
import type { components } from '../../api/schema';
import { claimMedia, releaseMedia } from './mediaBudget';

// Preview only bounded raster images; never turn arbitrary downloaded bytes into HTML/SVG.
function previewType(bytes: Uint8Array): string {
  let width = 0, height = 0, type = '';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) &&
    [73, 72, 68, 82].every((value, index) => bytes[index + 12] === value)) {
    width = view.getUint32(16); height = view.getUint32(20); type = 'image/png';
  } else if (bytes.length >= 13 && [71, 73, 70, 56].every((value, index) => bytes[index] === value) && [55, 57].includes(bytes[4]!) && bytes[5] === 97) {
    width = view.getUint16(6, true); height = view.getUint16(8, true); type = 'image/gif';
    if (width > 2048 || height > 2048) throw new Error('This image cannot be previewed. You can still download the file.');
  } else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = view.getUint16(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) {
        height = view.getUint16(offset + 3); width = view.getUint16(offset + 5); type = 'image/jpeg'; break;
      }
      offset += length;
    }
  }
  if (!type || width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 32_000_000)
    throw new Error('This image cannot be previewed. You can still download the file.');
  return type;
}

export function AttachmentDownload({ attachment, community, channel, url }: { attachment: Omit<components['schemas']['AttachmentDto'], 'hasPreview'> & { hasPreview?: boolean } } & ({ community: string; channel: string; url?: never } | { url: string; community?: never; channel?: never })) {
  const { t } = useI18n();
  const [image, setImage] = useState<string | null>(null);
  const [packOpen, setPackOpen] = useState(false);
  const [decodeError, setDecodeError] = useState(false);
  const imageUrl = useRef<string | null>(null);
  const mediaOwner = useRef(Symbol('image')); const [full, setFull] = useState(false);
  const mounted = useRef(false);
  const requests = useRef(new Set<AbortController>());
  useEffect(() => {
    mounted.current = true;
    const pending = requests.current;
    const owner = mediaOwner.current;
    return () => { mounted.current = false; releaseMedia(owner); pending.forEach(controller => controller.abort()); pending.clear(); if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); imageUrl.current = null; };
  }, []);
  async function fetchFile(light = false) {
    const controller = new AbortController(); requests.current.add(controller);
    try {
      const source = url ?? attachmentUrl(community!, channel!, attachment.id);
      const response = await callApi(source + (light ? '?preview=true' : ''), { signal: controller.signal }, 30_000);
      if (!response.ok) await readJson(response);
      const blob = await response.blob();
      if (controller.signal.aborted || !mounted.current) throw new DOMException('Canceled', 'AbortError');
      if (blob.size > (light ? 96 * 1024 : 5 * 1024 * 1024)) throw new Error('The file is too large.');
      return blob;
    } finally { requests.current.delete(controller); }
  }
  function hideImage() { releaseMedia(mediaOwner.current); if (imageUrl.current) URL.revokeObjectURL(imageUrl.current); imageUrl.current = null; setImage(null); setPackOpen(false); setFull(false); }
  const preview = useMutation({ mutationFn: async (original: boolean) => {
    const blob = await fetchFile(!!attachment.hasPreview && !original);
    const type = previewType(new Uint8Array(await blob.arrayBuffer()));
    if (!mounted.current) throw new DOMException('Canceled', 'AbortError');
    return URL.createObjectURL(new Blob([blob], { type }));
  }, onSuccess: (url, original) => {
    if (!mounted.current) { URL.revokeObjectURL(url); return; }
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    claimMedia(mediaOwner.current, hideImage); imageUrl.current = url; setImage(url); setDecodeError(false); setFull(original);
  } });
  const download = useMutation({ mutationFn: async () => {
    const blob = await fetchFile();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = attachment.name;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  const isImage = /\.(png|jpe?g|gif)$/i.test(attachment.name);
  return <div className="message-attachment">{attachment.kind === 'Sticker' && <small>{t('Sticker')} · {attachment.stickerPackName}</small>}<div className="attachment-actions">
    {isImage && <button type="button" className="secondary-button" disabled={preview.isPending} aria-expanded={!!image} onClick={() => image ? hideImage() : preview.mutate(false)}>{t(preview.isPending ? 'Loading image…' : image ? 'Hide image' : attachment.hasPreview ? 'View small preview' : 'View image')}: {attachment.name}</button>}
    {attachment.hasPreview && <button type="button" className="secondary-button" disabled={preview.isPending || full} onClick={() => preview.mutate(true)}>{t('View full image')}</button>}
    {attachment.hasPreview && <small>{t('Preview: {value} KiB', { value: Math.ceil(Number(attachment.previewSize) / 1024) })}</small>}
    <button type="button" className="secondary-button" disabled={download.isPending} onClick={() => download.mutate()}>{t(download.isPending ? 'Downloading…' : 'Download file')}: {attachment.name}</button><small>{Math.ceil(Number(attachment.size) / 1024)} KiB</small></div>
    {image && (attachment.kind === 'Sticker' && attachment.stickerPackName ? <>
      <button type="button" className="sticker-image-button" aria-label={t('Sticker pack info: {value}', { value: attachment.stickerPackName })} aria-expanded={packOpen} onClick={() => setPackOpen(value => !value)}><img className="attachment-preview sticker-preview" src={image} alt={`${t('Image attachment')}: ${attachment.name}`} onError={() => { hideImage(); setDecodeError(true); }} /></button>
      <button type="button" className="secondary-button" aria-expanded={packOpen} onClick={() => setPackOpen(value => !value)}>{t('Sticker pack info')}</button>{packOpen && <StickerPackInfo name={attachment.stickerPackName} />}
    </> : <img className="attachment-preview" src={image} alt={`${t('Image attachment')}: ${attachment.name}`} onError={() => { hideImage(); setDecodeError(true); }} />)}
    {preview.isPending && <p role="status">{t('Loading image…')}</p>}
    {preview.isError && preview.error.name !== 'AbortError' && <p role="alert">{t(preview.error.message)}</p>}
    {decodeError && <p role="alert">{t('This image cannot be previewed. You can still download the file.')}</p>}
    {download.isError && download.error.name !== 'AbortError' && <p role="alert">{t(download.error.message)}</p>}</div>;
}
