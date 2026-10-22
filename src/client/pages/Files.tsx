import { useRef, useState } from 'react';
import { ChevronRight, Download, File as FileIcon, FileImage, FileSpreadsheet, FileText, Folder, FolderPlus, Trash2, Upload } from 'lucide-react';
import { api, downloadFile, uploadFile } from '../api.ts';
import { fileSize, relative } from '../lib/format.ts';
import { useAuth, useInvalidate, useList } from '../lib/state.tsx';
import { Button, Card, EmptyState, IconButton, Input, Loading, Modal, PageHeader, cx, useToast } from '../ui/ui.tsx';

function iconFor(name: string) {
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(name)) return <FileImage className="size-5 text-[#EC4899]" />;
  if (/\.(xlsx?|csv|ods)$/i.test(name)) return <FileSpreadsheet className="size-5 text-success" />;
  if (/\.(docx?|pdf|txt|rtf|odt)$/i.test(name)) return <FileText className="size-5 text-[#0EA5E9]" />;
  return <FileIcon className="size-5 text-faint" />;
}

function useUpload(extra: { folder_id?: number | null; entity_type?: string; entity_id?: number }) {
  const inv = useInvalidate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | File[]) => {
    setBusy(true);
    try {
      for (const f of Array.from(files)) await uploadFile(f, extra);
      inv('files');
      toast.success('Файлы загружены');
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return { upload, busy };
}

function FileRow({ f, onDelete }: { f: any; onDelete?: () => void }) {
  const toast = useToast();
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
      {iconFor(f.name)}
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => downloadFile(f).catch((e) => toast.error(e))}>
        <span className="block truncate text-sm font-semibold hover:text-primary">{f.name}</span>
        <span className="text-xs text-muted">{fileSize(f.size)} · {relative(f.created_at)}{f.description ? ` · ${f.description}` : ''}</span>
      </button>
      <IconButton label="Скачать" onClick={() => downloadFile(f).catch((e) => toast.error(e))}><Download className="size-4" /></IconButton>
      {onDelete && <IconButton label="Удалить" className="opacity-0 group-hover:opacity-100" onClick={onDelete}><Trash2 className="size-4" /></IconButton>}
    </li>
  );
}

/** Files attached to a record (deal, company, task...) */
export function FilesBlock({ entityType, entityId }: { entityType: string; entityId: number }) {
  const { data } = useList('files', { entity_type: entityType, entity_id: entityId, limit: 200 });
  const { upload, busy } = useUpload({ entity_type: entityType, entity_id: entityId });
  const inv = useInvalidate();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <Card padded={false} title="Файлы" actions={<Button size="sm" icon={<Upload className="size-4" />} loading={busy} onClick={() => input.current?.click()}>Загрузить</Button>}>
      <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}
        className={cx(drag && 'drag-over')}>
        {data?.items.length ? (
          <ul className="divide-y divide-line">{data.items.map((f: any) => <FileRow key={f.id} f={f} onDelete={async () => { await api.del(`/api/e/files/${f.id}`); inv('files'); }} />)}</ul>
        ) : <p className="px-4 py-8 text-center text-sm text-faint">Перетащите файлы сюда или нажмите «Загрузить»</p>}
      </div>
    </Card>
  );
}

export default function Files() {
  const { can } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const [folder, setFolder] = useState<number | null>(null);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const folders = useList('folders', { limit: 500 }).data?.items ?? [];
  const { data, isLoading } = useList('files', folder ? { folder_id: folder, limit: 500 } : { folder_id__null: '1', entity_id__null: '1', limit: 500 });
  const { upload, busy } = useUpload({ folder_id: folder });
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const children = folders.filter((f: any) => (f.parent_id ?? null) === folder);
  const path: any[] = [];
  let cur = folders.find((f: any) => f.id === folder);
  while (cur) { path.unshift(cur); cur = folders.find((f: any) => f.id === cur.parent_id); }
  const writable = can('files', 'write');
  return (
    <div>
      <PageHeader title="Файлы" subtitle="Общее хранилище документов компании"
        actions={writable && <>
          <Button icon={<FolderPlus className="size-4" />} onClick={() => setNewFolder('')}>Папка</Button>
          <Button variant="primary" icon={<Upload className="size-4" />} loading={busy} onClick={() => input.current?.click()}>Загрузить</Button>
        </>} />
      <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && upload(e.target.files)} />
      <nav className="mb-3 flex flex-wrap items-center gap-1 text-sm">
        <button type="button" className={cx('font-semibold', folder ? 'text-primary hover:underline' : 'text-fg')} onClick={() => setFolder(null)}>Все файлы</button>
        {path.map((p) => <span key={p.id} className="flex items-center gap-1"><ChevronRight className="size-4 text-faint" /><button type="button" className="font-semibold text-primary hover:underline" onClick={() => setFolder(p.id)}>{p.name}</button></span>)}
      </nav>
      <Card padded={false}>
        <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); writable && upload(e.dataTransfer.files); }} className={cx('min-h-60', drag && 'drag-over')}>
          {isLoading ? <Loading /> : (
            <>
              {children.length > 0 && (
                <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-4">
                  {children.map((f: any) => (
                    <div key={f.id} className="group flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:border-primary">
                      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => setFolder(f.id)}>
                        <Folder className="size-5 shrink-0 fill-[#F59E0B]/25 text-[#F59E0B]" /><span className="truncate text-sm font-semibold">{f.name}</span>
                      </button>
                      {writable && <IconButton label="Удалить папку" className="size-7 opacity-0 group-hover:opacity-100" onClick={async () => {
                        if (!(await toast.confirm({ title: `Удалить папку «${f.name}»?`, text: 'Файлы из неё останутся в общем списке.', danger: true, ok: 'Удалить' }))) return;
                        await api.del(`/api/e/folders/${f.id}`); inv('folders');
                      }}><Trash2 className="size-3.5" /></IconButton>}
                    </div>
                  ))}
                </div>
              )}
              {data?.items.length ? (
                <ul className="divide-y divide-line">{data.items.map((f: any) => <FileRow key={f.id} f={f} onDelete={writable ? async () => { await api.del(`/api/e/files/${f.id}`); inv('files'); } : undefined} />)}</ul>
              ) : !children.length && <EmptyState icon={<Upload />} title="Здесь пока пусто" text="Перетащите файлы в это окно или нажмите «Загрузить»." />}
            </>
          )}
        </div>
      </Card>
      <Modal open={newFolder !== null} onClose={() => setNewFolder(null)} size="sm" title="Новая папка"
        footer={<><Button onClick={() => setNewFolder(null)}>Отмена</Button><Button variant="primary" onClick={async () => {
          if (!newFolder?.trim()) return;
          await api.post('/api/e/folders', { name: newFolder.trim(), parent_id: folder }); inv('folders'); setNewFolder(null);
        }}>Создать</Button></>}>
        <Input autoFocus value={newFolder ?? ''} onChange={(e) => setNewFolder(e.target.value)} placeholder="Название папки" onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget.form ?? null)} />
      </Modal>
    </div>
  );
}
