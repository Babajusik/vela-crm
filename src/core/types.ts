export type FieldType =
  | 'text' | 'textarea' | 'richtext' | 'int' | 'number' | 'money' | 'date' | 'datetime'
  | 'bool' | 'select' | 'ref' | 'user' | 'users' | 'tags' | 'json' | 'color'
  | 'email' | 'phone' | 'url';

export interface Option { value: string; label: string; color?: string }

export interface Field {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: Option[];
  /** target entity for type=ref */
  ref?: string;
  default?: unknown;
  /** show in default table */
  list?: boolean;
  /** included in full-text search */
  search?: boolean;
  /** hide from forms (still returned by API) */
  hidden?: boolean;
  /** never returned by API, never writable through generic CRUD */
  internal?: boolean;
  readonly?: boolean;
  /** form section */
  group?: string;
  hint?: string;
  /** form width: full row */
  wide?: boolean;
}

export interface Entity {
  key: string;
  label: string;
  plural: string;
  module: string;
  titleField: string;
  fields: Field[];
  /** default ORDER BY */
  order?: string;
  /** field with the record owner, for "my" filters */
  ownerField?: string;
  /** child of another entity, e.g. invoice_items -> invoices */
  parent?: { entity: string; field: string };
  /** emit timeline/activity on change */
  timeline?: boolean;
}

export type PermLevel = 'none' | 'read' | 'write' | 'admin';

export interface User {
  id: number;
  name: string;
  email: string;
  role_id: number | null;
  is_active: number;
  perms: Record<string, PermLevel>;
  color?: string;
  [k: string]: unknown;
}

export interface Req {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: any;
  token?: string;
}

export interface Res {
  status: number;
  body?: any;
  headers?: Record<string, string>;
}

export interface DB {
  all<T = any>(sql: string, params?: unknown[]): T[];
  get<T = any>(sql: string, params?: unknown[]): T | undefined;
  run(sql: string, params?: unknown[]): { changes: number; lastId: number };
  exec(sql: string): void;
  tx<T>(fn: () => T): T;
}

export interface Deps {
  db: DB;
  /** 'server' runs real 1C requests and webhooks; 'demo' runs fully in the browser */
  mode: 'server' | 'demo';
  fetch?: typeof fetch;
  /** called after every write so the browser engine can persist */
  onWrite?: () => void;
  log?: (...a: unknown[]) => void;
  /** network integrations; only the server provides them, the browser demo works without */
  integrations?: Integrations;
}

export interface OutgoingMail {
  from: string; fromName?: string; to: string; cc?: string; subject: string; text: string;
  inReplyTo?: string; messageId?: string;
  attachments?: { name: string; mime?: string; fileId: number }[];
}

export interface Integrations {
  /** sends through the mailbox SMTP server, returns the Message-ID */
  sendMail(box: Record<string, any>, mail: OutgoingMail): Promise<{ messageId?: string }>;
  /** checks IMAP and SMTP logins, returns a human readable result */
  testMailbox(box: Record<string, any>): Promise<string>;
  /** fetches new letters now, returns how many were stored */
  syncMailbox(box: Record<string, any>): Promise<number>;
  /** delivers an operator reply to the client in the channel */
  sendToChannel(channel: Record<string, any>, handle: string, text: string): Promise<{ extId?: string }>;
  /** checks channel credentials, returns the account name */
  testChannel(channel: Record<string, any>): Promise<string>;
  /** asks the telephony provider to connect the employee extension with a client number */
  callTo(settings: Record<string, any>, ext: string, phone: string): Promise<void>;
}
