import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, FolderPlus, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { relative } from '../lib/format.ts';
import { useAuth, useInvalidate, useList, useRecord } from '../lib/state.tsx';
import { Avatar, Button, Card, EmptyState, FormRow, IconButton, Input, Loading, PageHeader, Select, cx, useToast } from '../ui/ui.tsx';
import { RecordForm, RichText, SafeHtml } from '../ui/fields.tsx';

export default function Kb() {
  const { id } = useParams();
  return id === 'new' ? <Editor /> : id ? <Article id={Number(id)} /> : <Home />;
}

function Home() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [section, setSection] = useState<number | null>(null);
  const [secForm, setSecForm] = useState<any>(null);
  const sections = useList('kb_sections', { limit: 200 }).data?.items ?? [];
  const { data, isLoading } = useList('kb_articles', { q, section_id: section ?? undefined, limit: 200, is_published: can('kb', 'write') ? undefined : 1 });
  const articles = data?.items ?? [];
  const all = useList('kb_articles', { limit: 1000, expand: 0 }).data?.items ?? [];
  return (
    <div>
      <PageHeader title="База знаний" subtitle="Регламенты, инструкции и ответы на частые вопросы"
        actions={can('kb', 'write') && <>
          <Button icon={<FolderPlus className="size-4" />} onClick={() => setSecForm({})}>Раздел</Button>
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => nav('/kb/new' + (section ? `?section=${section}` : ''))}>Статья</Button>
        </>} />
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Найти в базе знаний…" icon={<Search className="size-4" />} className="mb-5 max-w-xl" />
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <nav className="space-y-1">
          <button type="button" onClick={() => setSection(null)} className={cx('flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold', !section ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2')}>
            Все статьи<span className="text-xs text-faint">{all.length}</span>
          </button>
          {sections.map((s: any) => (
            <div key={s.id} className="group flex items-center">
              <button type="button" onClick={() => setSection(s.id)} className={cx('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold', section === s.id ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2')}>
                <span>{s.icon || '📁'}</span><span className="truncate">{s.name}</span><span className="ml-auto text-xs text-faint">{all.filter((a: any) => a.section_id === s.id).length}</span>
              </button>
              {can('kb', 'write') && <IconButton label="Изменить раздел" className="size-7 opacity-0 group-hover:opacity-100" onClick={() => setSecForm(s)}><Pencil className="size-3.5" /></IconButton>}
            </div>
          ))}
        </nav>
        <div>
          {isLoading ? <Loading /> : !articles.length ? <EmptyState title={q ? 'Ничего не найдено' : 'Статей пока нет'} text="Опишите, как у вас всё устроено, — новичкам будет проще." /> : (
            <div className="grid gap-3 md:grid-cols-2">
              {articles.map((a: any) => (
                <Link key={a.id} to={`/kb/${a.id}`} className="rounded-xl border border-line bg-surface p-4 transition hover:border-line-strong hover:shadow-md">
                  <p className="text-xs font-semibold text-muted">{a._ref?.section_id?.title}</p>
                  <p className="mt-1 font-bold">{a.title}{!a.is_published && <span className="ml-2 text-xs font-semibold text-warning">черновик</span>}</p>
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{String(a.body ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 180)}</p>
                  <p className="mt-3 flex items-center gap-3 text-xs text-faint"><span>{a._ref?.author_id?.title}</span><span>· {relative(a.updated_at)}</span><span className="flex items-center gap-1"><Eye className="size-3.5" />{a.views ?? 0}</span></p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      <RecordForm entity="kb_sections" open={!!secForm} onClose={() => setSecForm(null)} initial={secForm?.id ? secForm : null} fields={['name', 'icon', 'parent_id', 'description']} size="md" />
    </div>
  );
}

function Article({ id }: { id: number }) {
  const { data: a, isLoading } = useRecord('kb_articles', id);
  const { can } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const [edit, setEdit] = useState(false);
  if (isLoading) return <Loading />;
  if (!a) return <EmptyState title="Статья не найдена" action={<Button onClick={() => nav('/kb')}>В базу знаний</Button>} />;
  if (edit) return <Editor article={a} onDone={() => setEdit(false)} />;
  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/kb" className="mb-3 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-fg"><ArrowLeft className="size-4" />База знаний</Link>
      <Card>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-primary">{a._ref?.section_id?.title}</p>
            <h1 className="mt-1 text-3xl font-extrabold tracking-tight">{a.title}</h1>
            <p className="mt-2 flex items-center gap-2 text-sm text-muted">{a._ref?.author_id && <Avatar name={a._ref.author_id.title} color={a._ref.author_id.color} size={22} />}{a._ref?.author_id?.title} · обновлено {relative(a.updated_at)}</p>
          </div>
          {can('kb', 'write') && <>
            <Button icon={<Pencil className="size-4" />} onClick={() => setEdit(true)}>Редактировать</Button>
            <IconButton label="Удалить" onClick={async () => { if (await toast.confirm({ title: 'Удалить статью?', danger: true, ok: 'Удалить' })) { await api.del(`/api/e/kb_articles/${id}`); inv('kb_articles'); nav('/kb'); } }}><Trash2 className="size-4" /></IconButton>
          </>}
        </div>
        <SafeHtml html={a.body ?? ''} className="mt-6 border-t border-line pt-5 text-[15px]" />
      </Card>
    </div>
  );
}

function Editor({ article, onDone }: { article?: any; onDone?: () => void }) {
  const nav = useNavigate();
  const toast = useToast();
  const inv = useInvalidate();
  const sections = useList('kb_sections', { limit: 200 }).data?.items ?? [];
  const sp = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const [f, setF] = useState<any>(article ?? { title: '', body: '', section_id: Number(sp.get('section')) || null, is_published: 1 });
  const save = async () => {
    try {
      const data = { title: f.title, body: f.body, section_id: f.section_id ?? sections[0]?.id, is_published: f.is_published };
      const r = article ? await api.patch(`/api/e/kb_articles/${article.id}`, data) : await api.post('/api/e/kb_articles', data);
      inv('kb_articles');
      toast.success('Статья сохранена');
      if (onDone) onDone(); else nav(`/kb/${r.id}`);
    } catch (e) { toast.error(e); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Заголовок статьи" className="h-12 text-xl font-bold" />
      <div className="flex flex-wrap gap-3">
        <FormRow label="Раздел"><Select value={f.section_id ?? ''} onChange={(e) => setF({ ...f, section_id: Number(e.target.value) })}>{sections.map((s: any) => <option key={s.id} value={s.id}>{s.icon} {s.name}</option>)}</Select></FormRow>
        <FormRow label="Статус"><Select value={f.is_published ? '1' : '0'} onChange={(e) => setF({ ...f, is_published: Number(e.target.value) })}><option value="1">Опубликована</option><option value="0">Черновик</option></Select></FormRow>
      </div>
      <RichText value={f.body} onChange={(v) => setF({ ...f, body: v })} minHeight={360} />
      <div className="flex gap-2"><Button variant="primary" onClick={save}>Сохранить</Button><Button onClick={() => (onDone ? onDone() : nav('/kb'))}>Отмена</Button></div>
    </div>
  );
}
