// Messenger channels: Telegram bot, VK community, Avito Messenger, WhatsApp (Green API).
// Every channel is polled from the server, so the CRM needs no public address to receive messages.
import type { IncomingChatMessage } from '../src/core/services/misc.ts';
import { parseJson } from '../src/core/util.ts';

type Channel = Record<string, any>;
type Deliver = (m: IncomingChatMessage) => void;
type Fetch = typeof fetch;

const settingsOf = (ch: Channel) => parseJson<Record<string, string>>(ch.settings, {});

async function json(res: Response, what: string) {
  const text = await res.text();
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) throw new Error(`${what}: ${body?.description ?? body?.error?.message ?? body?.error_description ?? body?.message ?? `HTTP ${res.status}`}`);
  return body;
}

// ---------------- Telegram ----------------
const tgOffsets = new Map<number, number>();

function tgText(m: any): string {
  if (m.text) return m.text;
  if (m.caption) return m.caption;
  if (m.photo) return '[фото]';
  if (m.document) return `[файл: ${m.document.file_name ?? 'документ'}]`;
  if (m.voice) return '[голосовое сообщение]';
  if (m.video) return '[видео]';
  if (m.sticker) return m.sticker.emoji ?? '[стикер]';
  if (m.contact) return `[контакт: ${m.contact.first_name ?? ''} ${m.contact.phone_number ?? ''}]`;
  if (m.location) return '[геопозиция]';
  return '';
}

const telegram = {
  async poll(f: Fetch, ch: Channel, deliver: Deliver) {
    const s = settingsOf(ch);
    if (!s.bot_token) return;
    const offset = tgOffsets.get(ch.id) ?? 0;
    const data = await json(await f(`https://api.telegram.org/bot${s.bot_token}/getUpdates?timeout=0&offset=${offset}`), 'Telegram');
    for (const u of data.result ?? []) {
      tgOffsets.set(ch.id, u.update_id + 1);
      const m = u.message;
      if (!m || m.chat?.type !== 'private') continue;
      const text = tgText(m);
      if (!text) continue;
      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username || 'Клиент Telegram';
      deliver({ channel_id: ch.id, client_name: name, client_handle: `tg:${m.chat.id}`, text, ext_id: `${m.chat.id}:${m.message_id}`,
        username: m.from?.username, phone: m.contact?.phone_number });
    }
  },
  async send(f: Fetch, ch: Channel, handle: string, text: string) {
    const chatId = handle.replace(/^tg:/, '');
    if (!/^-?\d+$/.test(chatId)) throw new Error('Диалог создан не через Telegram-бота');
    const data = await json(await f(`https://api.telegram.org/bot${settingsOf(ch).bot_token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text }),
    }), 'Telegram');
    return { extId: `${chatId}:${data.result?.message_id}` };
  },
  async test(f: Fetch, ch: Channel) {
    const data = await json(await f(`https://api.telegram.org/bot${settingsOf(ch).bot_token}/getMe`), 'Telegram');
    return `@${data.result.username}`;
  },
};

// ---------------- VK community (Bots Long Poll API) ----------------
const VK = 'https://api.vk.com/method';
const VK_V = '5.199';
const vkServers = new Map<number, { server: string; key: string; ts: string }>();
const vkNames = new Map<number, string>();

async function vk(f: Fetch, ch: Channel, method: string, params: Record<string, string | number>) {
  const s = settingsOf(ch);
  const body = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), access_token: s.access_token, v: VK_V });
  const data = await json(await f(`${VK}/${method}`, { method: 'POST', body }), 'ВКонтакте');
  if (data?.error) throw new Error(`ВКонтакте: ${data.error.error_msg}`);
  return data.response;
}

async function vkName(f: Fetch, ch: Channel, userId: number) {
  if (vkNames.has(userId)) return vkNames.get(userId)!;
  try {
    const [u] = await vk(f, ch, 'users.get', { user_ids: userId });
    const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ') || `Пользователь ${userId}`;
    vkNames.set(userId, name);
    return name;
  } catch { return `Пользователь ${userId}`; }
}

const vkontakte = {
  async poll(f: Fetch, ch: Channel, deliver: Deliver) {
    const s = settingsOf(ch);
    if (!s.access_token || !s.group_id) return;
    let lp = vkServers.get(ch.id);
    if (!lp) {
      const r = await vk(f, ch, 'groups.getLongPollServer', { group_id: s.group_id });
      lp = { server: r.server, key: r.key, ts: String(r.ts) };
      vkServers.set(ch.id, lp);
    }
    const data = await json(await f(`${lp.server}?act=a_check&key=${lp.key}&ts=${lp.ts}&wait=0`), 'ВКонтакте');
    if (data.failed) {
      if (data.failed === 1 && data.ts) lp.ts = String(data.ts);
      else vkServers.delete(ch.id);
      return;
    }
    lp.ts = String(data.ts);
    for (const u of data.updates ?? []) {
      if (u.type !== 'message_new') continue;
      const m = u.object?.message ?? u.object;
      if (!m?.from_id || m.from_id < 0 || m.peer_id !== m.from_id) continue;
      const text = m.text || (m.attachments?.length ? `[вложение: ${m.attachments.map((a: any) => a.type).join(', ')}]` : '');
      if (!text) continue;
      deliver({ channel_id: ch.id, client_name: await vkName(f, ch, m.from_id), client_handle: `vk:${m.from_id}`, text, ext_id: String(m.id ?? m.conversation_message_id) });
    }
  },
  async send(f: Fetch, ch: Channel, handle: string, text: string) {
    const peer = handle.replace(/^vk:/, '');
    if (!/^\d+$/.test(peer)) throw new Error('Диалог создан не через ВКонтакте');
    const id = await vk(f, ch, 'messages.send', { peer_id: peer, message: text, random_id: Math.floor(Math.random() * 2 ** 31) });
    return { extId: String(id) };
  },
  async test(f: Fetch, ch: Channel) {
    const r = await vk(f, ch, 'groups.getById', { group_id: settingsOf(ch).group_id });
    const g = Array.isArray(r) ? r[0] : r?.groups?.[0];
    await vk(f, ch, 'groups.getLongPollServer', { group_id: settingsOf(ch).group_id });
    return g?.name ?? `Сообщество ${settingsOf(ch).group_id}`;
  },
};

// ---------------- Avito Messenger ----------------
const AVITO = 'https://api.avito.ru';
const avitoTokens = new Map<number, { token: string; until: number; userId: number }>();

async function avitoAuth(f: Fetch, ch: Channel) {
  const cached = avitoTokens.get(ch.id);
  if (cached && cached.until > Date.now()) return cached;
  const s = settingsOf(ch);
  const t = await json(await f(`${AVITO}/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: s.client_id, client_secret: s.client_secret }),
  }), 'Авито');
  if (!t?.access_token) throw new Error('Авито: неверный Client ID или Client Secret');
  const self = await json(await f(`${AVITO}/core/v1/accounts/self`, { headers: { Authorization: `Bearer ${t.access_token}` } }), 'Авито');
  const auth = { token: t.access_token as string, until: Date.now() + (Number(t.expires_in ?? 86400) - 300) * 1000, userId: Number(self.id), name: self.name };
  avitoTokens.set(ch.id, auth);
  return auth;
}

const avito = {
  async poll(f: Fetch, ch: Channel, deliver: Deliver, hasConversation: (handle: string) => boolean) {
    const a = await avitoAuth(f, ch);
    const h = { Authorization: `Bearer ${a.token}` };
    const data = await json(await f(`${AVITO}/messenger/v2/accounts/${a.userId}/chats?unread_only=true&limit=50`, { headers: h }), 'Авито');
    for (const chat of data.chats ?? []) {
      const handle = `avito:${chat.id}`;
      const client = (chat.users ?? []).find((u: any) => Number(u.id) !== a.userId);
      const item = chat.context?.value?.title;
      const isNew = !hasConversation(handle);
      const res = await json(await f(`${AVITO}/messenger/v3/accounts/${a.userId}/chats/${chat.id}/messages/?limit=20`, { headers: h }), 'Авито');
      const msgs: any[] = (Array.isArray(res) ? res : res.messages ?? []).filter((m: any) => m.direction === 'in').sort((x: any, y: any) => x.created - y.created);
      msgs.forEach((m, i) => {
        const body = m.content?.text ?? (m.type === 'image' ? '[фото]' : m.type ? `[${m.type}]` : '');
        if (!body) return;
        deliver({ channel_id: ch.id, client_name: client?.name ?? 'Покупатель Авито', client_handle: handle, ext_id: String(m.id),
          text: isNew && i === 0 && item ? `Объявление «${item}»\n${body}` : body });
      });
      await f(`${AVITO}/messenger/v1/accounts/${a.userId}/chats/${chat.id}/read`, { method: 'POST', headers: h }).catch(() => {});
    }
  },
  async send(f: Fetch, ch: Channel, handle: string, text: string) {
    const chatId = handle.replace(/^avito:/, '');
    const a = await avitoAuth(f, ch);
    const r = await json(await f(`${AVITO}/messenger/v1/accounts/${a.userId}/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: { text }, type: 'text' }),
    }), 'Авито');
    return { extId: r?.id ? String(r.id) : undefined };
  },
  async test(f: Fetch, ch: Channel) {
    avitoTokens.delete(ch.id);
    const a: any = await avitoAuth(f, ch);
    return a.name ? `${a.name} (ID ${a.userId})` : `Аккаунт ${a.userId}`;
  },
};

// ---------------- WhatsApp through Green API ----------------
function green(ch: Channel, method: string, suffix = '') {
  const s = settingsOf(ch);
  const base = (s.api_url || 'https://api.green-api.com').replace(/\/+$/, '');
  return `${base}/waInstance${s.id_instance}/${method}/${s.api_token}${suffix}`;
}

function waText(md: any): string {
  switch (md?.typeMessage) {
    case 'textMessage': return md.textMessageData?.textMessage ?? '';
    case 'extendedTextMessage': return md.extendedTextMessageData?.text ?? '';
    case 'quotedMessage': return md.extendedTextMessageData?.text ?? '';
    case 'imageMessage': return md.fileMessageData?.caption || '[фото]';
    case 'documentMessage': return `[файл: ${md.fileMessageData?.fileName ?? 'документ'}]`;
    case 'audioMessage': return '[голосовое сообщение]';
    case 'videoMessage': return md.fileMessageData?.caption || '[видео]';
    case 'contactMessage': return '[контакт]';
    case 'locationMessage': return '[геопозиция]';
    default: return '';
  }
}

const whatsapp = {
  async poll(f: Fetch, ch: Channel, deliver: Deliver) {
    for (let i = 0; i < 20; i++) {
      const n = await json(await f(green(ch, 'receiveNotification', '?receiveTimeout=5')), 'WhatsApp');
      if (!n?.receiptId) return;
      try {
        const b = n.body ?? {};
        const chatId: string = b.senderData?.chatId ?? '';
        if (b.typeWebhook === 'incomingMessageReceived' && chatId.endsWith('@c.us')) {
          const text = waText(b.messageData);
          const phone = chatId.replace('@c.us', '');
          if (text) deliver({ channel_id: ch.id, client_name: b.senderData?.senderName || b.senderData?.chatName || `+${phone}`, client_handle: `wa:${phone}`, text, ext_id: b.idMessage, phone });
        }
      } finally {
        await f(green(ch, 'deleteNotification', `/${n.receiptId}`), { method: 'DELETE' }).catch(() => {});
      }
    }
  },
  async send(f: Fetch, ch: Channel, handle: string, text: string) {
    const phone = handle.replace(/^wa:/, '').replace(/\D/g, '');
    if (phone.length < 10) throw new Error('Диалог создан не через WhatsApp');
    const r = await json(await f(green(ch, 'sendMessage'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chatId: `${phone}@c.us`, message: text }) }), 'WhatsApp');
    return { extId: r?.idMessage };
  },
  async test(f: Fetch, ch: Channel) {
    const st = await json(await f(green(ch, 'getStateInstance')), 'WhatsApp');
    if (st?.stateInstance !== 'authorized') throw new Error(`WhatsApp: номер не авторизован (${st?.stateInstance ?? 'нет ответа'}). Отсканируйте QR-код в консоли Green API`);
    const info = await json(await f(green(ch, 'getSettings')), 'WhatsApp').catch(() => null);
    return info?.wid ? `+${String(info.wid).replace('@c.us', '')}` : 'Номер авторизован';
  },
};

// ---------------- dispatcher ----------------
const ADAPTERS: Record<string, { poll: (...a: any[]) => Promise<void>; send: (f: Fetch, ch: Channel, h: string, t: string) => Promise<{ extId?: string }>; test: (f: Fetch, ch: Channel) => Promise<string>; every: number }> = {
  telegram: { ...telegram, every: 5000 },
  vk: { ...vkontakte, every: 5000 },
  avito: { ...avito, every: 30000 },
  whatsapp: { ...whatsapp, every: 10000 },
};

export function sendToChannel(f: Fetch, ch: Channel, handle: string, text: string) {
  const a = ADAPTERS[ch.kind];
  if (!a) throw new Error('Этот канал не поддерживает ответы из CRM');
  return a.send(f, ch, handle, text);
}

export function testChannel(f: Fetch, ch: Channel) {
  const a = ADAPTERS[ch.kind];
  if (!a) throw new Error('Для этого канала проверка не нужна');
  return a.test(f, ch);
}

const lastPoll = new Map<number, number>();
const busy = new Set<number>();

/**
 * Polls every active channel at its own pace. Errors are reported once per change, so a wrong token
 * shows up in the channel card instead of filling the log.
 */
export async function pollChannels(f: Fetch, channels: Channel[], deliver: Deliver, report: (id: number, error: string | null) => void, hasConversation: (channelId: number, handle: string) => boolean) {
  await Promise.all(channels.map(async (ch) => {
    const a = ADAPTERS[ch.kind];
    if (!a || busy.has(ch.id) || Date.now() - (lastPoll.get(ch.id) ?? 0) < a.every) return;
    busy.add(ch.id);
    lastPoll.set(ch.id, Date.now());
    try {
      await a.poll(f, ch, deliver, (handle: string) => hasConversation(ch.id, handle));
      if (ch.sync_error) report(ch.id, null);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg !== ch.sync_error) report(ch.id, msg);
    } finally {
      busy.delete(ch.id);
    }
  }));
}
