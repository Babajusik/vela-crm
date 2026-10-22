// Real mail: SMTP sending and IMAP receiving (Inbox and Sent) for mailboxes connected in the CRM.
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import type { OutgoingMail } from '../src/core/types.ts';
import type { IncomingMail } from '../src/core/services/comms.ts';
import { parseJson } from '../src/core/util.ts';

type Box = Record<string, any>;
export interface StoredFile { content: Buffer; name: string; mime?: string }

/** Letters older than this are not imported when a mailbox is connected for the first time. */
const FIRST_SYNC_DAYS = 14;
/** At most this many letters per folder in one run; the rest come with the next run. */
const BATCH = 200;
const MAX_ATTACHMENT = 20 * 1024 * 1024;

function smtp(box: Box) {
  const port = Number(box.smtp_port) || 465;
  return nodemailer.createTransport({
    host: box.smtp_host, port, secure: port === 465, requireTLS: port === 587,
    auth: { user: box.login || box.email, pass: box.password },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 60000,
  });
}

function imap(box: Box) {
  const port = Number(box.imap_port) || 993;
  return new ImapFlow({
    host: box.imap_host, port, secure: port !== 143, auth: { user: box.login || box.email, pass: box.password },
    logger: false, connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 120000,
  });
}

/** Turns provider errors into something a manager can act on. */
function humanError(e: unknown): Error {
  const err = e as any;
  const msg = String(err?.response ?? err?.responseText ?? err?.message ?? e);
  if (err?.authenticationFailed || /auth|login|credentials|535|AUTHENTICATIONFAILED|Invalid login/i.test(msg)) {
    return new Error('Сервер не принял логин или пароль. Для Яндекса, Mail.ru и Gmail нужен пароль приложения, а не обычный пароль от почты');
  }
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return new Error('Адрес почтового сервера не найден, проверьте имя сервера');
  if (/ECONNREFUSED|ETIMEDOUT|timeout/i.test(msg)) return new Error('Почтовый сервер не отвечает, проверьте сервер и порт');
  return new Error(msg.slice(0, 300));
}

export async function sendMail(box: Box, mail: OutgoingMail, readFile: (id: number) => StoredFile | null) {
  const domain = String(box.email).split('@')[1] ?? 'vela.local';
  const messageId = mail.messageId ?? `<${randomBytes(12).toString('hex')}@${domain}>`;
  try {
    const info = await smtp(box).sendMail({
      from: { name: mail.fromName ?? '', address: mail.from }, to: mail.to, cc: mail.cc || undefined,
      subject: mail.subject, text: mail.text, messageId,
      inReplyTo: mail.inReplyTo, references: mail.inReplyTo,
      attachments: (mail.attachments ?? []).map((a) => readFile(a.fileId)).filter(Boolean).map((f) => ({ filename: f!.name, content: f!.content, contentType: f!.mime })),
    });
    return { messageId: info.messageId ?? messageId };
  } catch (e) { throw humanError(e); }
}

export async function testMailbox(box: Box) {
  const parts: string[] = [];
  if (!box.password) throw new Error('Укажите пароль ящика');
  if (box.imap_host) {
    const c = imap(box);
    try { await c.connect(); parts.push('IMAP: вход выполнен'); } catch (e) { throw humanError(e); } finally { await c.logout().catch(() => {}); }
  }
  if (box.smtp_host) {
    try { await smtp(box).verify(); parts.push('SMTP: вход выполнен'); } catch (e) { throw humanError(e); }
  }
  if (!parts.length) throw new Error('Укажите IMAP или SMTP сервер');
  return parts.join(', ');
}

function addressText(a: AddressObject | AddressObject[] | undefined) {
  if (!a) return '';
  return (Array.isArray(a) ? a : [a]).map((x) => x.text).join(', ');
}

/** Letter in the shape the core stores; attachments are written to disk first. */
export function toIncoming(p: ParsedMail, folder: 'inbox' | 'sent', filesDir: string): IncomingMail {
  const from = p.from?.value?.[0];
  const refs = Array.isArray(p.references) ? p.references : p.references ? [p.references] : [];
  const attachments = (p.attachments ?? [])
    .filter((a) => !a.related && a.size <= MAX_ATTACHMENT && (a.filename || a.contentDisposition === 'attachment'))
    .map((a) => {
      const stored = `mail-${randomBytes(8).toString('hex')}`;
      writeFileSync(join(filesDir, stored), a.content);
      return { name: a.filename || 'вложение', mime: a.contentType, size: a.size, path: `disk:${stored}` };
    });
  return {
    message_id: p.messageId, in_reply_to: p.inReplyTo, references: refs,
    from_addr: from?.address ?? '', from_name: from?.name ?? '', to_addr: addressText(p.to), cc: addressText(p.cc) || undefined,
    subject: p.subject ?? '', body: (p.text ?? '').trim(), date: (p.date ?? new Date()).toISOString(), folder, attachments,
  };
}

interface FolderState { uidValidity: string; lastUid: number }

/**
 * Fetches letters that arrived since the previous run. The first run takes the last two weeks only,
 * then the last seen UID of each folder is remembered (and reset if the server renumbers the folder).
 */
export async function syncMailbox(box: Box, filesDir: string, store: (m: IncomingMail) => void, saveState: (s: Record<string, FolderState>) => void) {
  if (!box.imap_host || !box.password) return 0;
  const state = parseJson<Record<string, FolderState>>(box.imap_state, {});
  const client = imap(box);
  try { await client.connect(); } catch (e) { throw humanError(e); }
  let count = 0;
  try {
    const folders: { path: string; folder: 'inbox' | 'sent' }[] = [{ path: 'INBOX', folder: 'inbox' }];
    const sent = (await client.list()).find((f) => f.specialUse === '\\Sent');
    if (sent) folders.push({ path: sent.path, folder: 'sent' });
    for (const f of folders) {
      const lock = await client.getMailboxLock(f.path);
      try {
        const mb = client.mailbox;
        if (!mb) continue;
        const validity = String(mb.uidValidity);
        const prev = state[f.path]?.uidValidity === validity ? state[f.path] : null;
        let last = prev?.lastUid ?? 0;
        let uids: number[];
        if (prev) uids = (await client.search({ uid: `${last + 1}:*` }, { uid: true })) || [];
        else uids = (await client.search({ since: new Date(Date.now() - FIRST_SYNC_DAYS * 86400000) }, { uid: true })) || [];
        // "N:*" returns the newest letter even when nothing is newer than N
        uids = uids.filter((u) => u > last).sort((a, b) => a - b).slice(0, BATCH);
        if (uids.length) {
          for await (const msg of client.fetch(uids, { uid: true, source: true }, { uid: true })) {
            if (!msg.source) continue;
            store(toIncoming(await simpleParser(msg.source), f.folder, filesDir));
            last = Math.max(last, msg.uid);
            count++;
          }
        } else if (!prev) {
          last = Math.max(0, Number(mb.uidNext ?? 1) - 1);
        }
        state[f.path] = { uidValidity: validity, lastUid: last };
      } finally {
        lock.release();
      }
    }
  } finally {
    saveState(state);
    await client.logout().catch(() => {});
  }
  return count;
}
