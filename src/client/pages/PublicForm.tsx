import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../api.ts';
import { Button, FormRow, Input, Loading, Textarea, useToast } from '../ui/ui.tsx';
import { Logo } from '../layout/Logo.tsx';

export function PublicForm() {
  const { id } = useParams();
  const toast = useToast();
  const [form, setForm] = useState<any>(null);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/api/public/forms/${id}`).then(setForm).catch((e) => setError(e.message)); }, [id]);
  const submit = async () => {
    setBusy(true);
    try { const r = await api.post(`/api/public/forms/${id}`, values); setDone(r.message); }
    catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-xl sm:p-8">
        {error ? <p className="text-center text-muted">{error}</p> : !form ? <Loading /> : done ? (
          <div className="py-8 text-center">
            <CheckCircle2 className="mx-auto size-12 text-success" />
            <p className="mt-4 text-lg font-bold">{done}</p>
          </div>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-4">
            <div>
              {form.company?.name && <p className="mb-2 text-sm font-semibold text-muted">{form.company.name}</p>}
              <h1 className="text-2xl font-extrabold tracking-tight">{form.title}</h1>
              {form.subtitle && <p className="mt-1 text-muted">{form.subtitle}</p>}
            </div>
            {form.fields.map((f: any) => (
              <FormRow key={f.key} label={f.label} required={f.required}>
                {f.type === 'textarea'
                  ? <Textarea value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} required={f.required} />
                  : <Input type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : 'text'} value={values[f.key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} required={f.required} />}
              </FormRow>
            ))}
            <Button type="submit" variant="primary" full loading={busy}>Отправить</Button>
            <p className="text-center text-xs text-faint">Нажимая «Отправить», вы соглашаетесь на обработку персональных данных.</p>
          </form>
        )}
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-faint"><Logo size={16} /> Форма работает на Vela CRM</div>
      </div>
    </div>
  );
}
