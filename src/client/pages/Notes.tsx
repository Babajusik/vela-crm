import { useState } from 'react';
import { Pin, Plus, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { relative } from '../lib/format.ts';
import { useAuth, useInvalidate, useList } from '../lib/state.tsx';
import { Button, EmptyState, IconButton, Input, Loading, Modal, PageHeader, Textarea, cx } from '../ui/ui.tsx';
import { ColorPicker, NOTE_COLORS } from '../ui/fields.tsx';

export default function Notes() {
  const { user } = useAuth();
  const inv = useInvalidate();
  const { data, isLoading } = useList('notes', { user_id: user!.id, limit: 500 });
  const [edit, setEdit] = useState<any>(null);
  const [q, setQ] = useState('');
  const notes = (data?.items ?? []).filter((n: any) => !q || `${n.title} ${n.body}`.toLowerCase().includes(q.toLowerCase()));
  const save = async () => {
    const d = { title: edit.title, body: edit.body, color: edit.color, pinned: edit.pinned, user_id: user!.id };
    if (edit.id) await api.patch(`/api/e/notes/${edit.id}`, d); else await api.post('/api/e/notes', d);
    inv('notes');
    setEdit(null);
  };
  return (
    <div>
      <PageHeader title="Заметки" subtitle="Личные заметки — их видите только вы" actions={<Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ title: '', body: '', color: NOTE_COLORS[0] })}>Заметка</Button>} />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по заметкам" className="mb-4 max-w-sm" />
      {isLoading ? <Loading /> : !notes.length ? <EmptyState title="Заметок нет" text="Записывайте идеи, списки дел и всё, что не хочется потерять." /> : (
        <div className="columns-1 gap-4 sm:columns-2 xl:columns-4">
          {notes.map((n: any) => (
            <button key={n.id} type="button" onClick={() => setEdit(n)} className="mb-4 block w-full break-inside-avoid rounded-xl p-4 text-left text-ink-900 shadow-sm transition hover:shadow-md" style={{ background: n.color || NOTE_COLORS[0] }}>
              <div className="flex items-start gap-2">
                <p className="flex-1 font-bold">{n.title || 'Без заголовка'}</p>
                {!!n.pinned && <Pin className="size-4 fill-current opacity-60" />}
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm opacity-80">{n.body}</p>
              <p className="mt-3 text-xs opacity-50">{relative(n.updated_at)}</p>
            </button>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Заметка' : 'Новая заметка'}
        footer={<>
          {edit?.id && <IconButton label="Удалить" className="mr-auto" onClick={async () => { await api.del(`/api/e/notes/${edit.id}`); inv('notes'); setEdit(null); }}><Trash2 className="size-4" /></IconButton>}
          <Button variant="ghost" icon={<Pin className={cx('size-4', edit?.pinned && 'fill-current')} />} onClick={() => setEdit({ ...edit, pinned: edit.pinned ? 0 : 1 })}>{edit?.pinned ? 'Открепить' : 'Закрепить'}</Button>
          <Button variant="primary" onClick={save}>Сохранить</Button>
        </>}>
        {edit && (
          <div className="space-y-3">
            <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Заголовок" className="font-semibold" />
            <Textarea rows={8} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} placeholder="Текст заметки" />
            <ColorPicker value={edit.color} onChange={(c) => setEdit({ ...edit, color: c })} colors={NOTE_COLORS} />
          </div>
        )}
      </Modal>
    </div>
  );
}
