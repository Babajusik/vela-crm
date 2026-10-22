import { useState } from 'react';
import { ArrowRight, BarChart3, Boxes, RefreshCw, ShieldCheck } from 'lucide-react';
import { IS_DEMO } from '../api.ts';
import { useAuth } from '../lib/state.tsx';
import { Avatar, Button, FormRow, Input, useToast } from '../ui/ui.tsx';
import { Logo } from '../layout/Logo.tsx';

const DEMO_USERS = [
  { email: 'admin@vela.demo', name: 'Алексей Морозов', role: 'Директор, полный доступ', color: '#0FA596' },
  { email: 'lebedeva@vela.demo', name: 'Екатерина Лебедева', role: 'Руководитель продаж', color: '#F97362' },
  { email: 'orlov@vela.demo', name: 'Дмитрий Орлов', role: 'Менеджер по продажам', color: '#6366F1' },
  { email: 'nikitin@vela.demo', name: 'Иван Никитин', role: 'Руководитель проектов', color: '#F59E0B' },
  { email: 'pavlova@vela.demo', name: 'Наталья Павлова', role: 'Главный бухгалтер', color: '#84CC16' },
  { email: 'kim@vela.demo', name: 'Сергей Ким', role: 'Разработчик', color: '#0EA5E9' },
];

export function Login() {
  const { login } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState(IS_DEMO ? 'admin@vela.demo' : '');
  const [password, setPassword] = useState(IS_DEMO ? 'demo1234' : '');
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (e: string, p: string) => {
    setBusy(e);
    try { await login(e, p); } catch (err) { toast.error(err); } finally { setBusy(null); }
  };
  return (
    <div className="grid min-h-full lg:grid-cols-[1.05fr_1fr]">
      <div className="relative hidden overflow-hidden bg-ink-900 p-12 text-side-fg lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-40 -top-40 size-[520px] rounded-full bg-brand-500/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-48 -left-24 size-[480px] rounded-full bg-coral-500/15 blur-3xl" />
        <div className="relative flex items-center gap-3"><Logo size={40} /><span className="text-2xl font-extrabold">Vela<span className="text-brand-400">.</span></span></div>
        <div className="relative mt-auto max-w-lg">
          <h1 className="text-4xl font-extrabold leading-tight tracking-tight">Продажи, проекты и деньги компании — в одном окне.</h1>
          <p className="mt-4 text-lg text-side-muted">Открытая CRM для малого и среднего бизнеса. Работает на вашем сервере и обменивается данными с 1С.</p>
          <ul className="mt-8 grid gap-4 text-sm sm:grid-cols-2">
            {[[<BarChart3 key="a" />, 'Воронка, счета и оплаты'], [<Boxes key="b" />, 'Проекты, задачи и Гант'], [<RefreshCw key="c" />, 'Обмен с 1С: OData и CommerceML'], [<ShieldCheck key="d" />, 'Данные на вашем сервере']].map(([icon, text]) => (
              <li key={String(text)} className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-white/10 text-brand-300 [&>svg]:size-5">{icon}</span>{text}</li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-side-muted">© {new Date().getFullYear()} Vela CRM · открытый исходный код, лицензия MIT</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden"><Logo size={36} /><span className="text-2xl font-extrabold">Vela<span className="text-primary">.</span></span></div>
          <h2 className="text-2xl font-extrabold tracking-tight">Вход в систему</h2>
          <p className="mt-1 text-sm text-muted">{IS_DEMO ? 'Демо-версия: войдите под любым сотрудником, чтобы увидеть систему его глазами.' : 'Введите рабочий email и пароль.'}</p>
          <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); go(email, password); }}>
            <FormRow label="Email"><Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></FormRow>
            <FormRow label="Пароль"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></FormRow>
            <Button type="submit" variant="primary" full loading={busy === email} icon={<ArrowRight className="size-4" />}>Войти</Button>
          </form>
          {IS_DEMO && (
            <div className="mt-8">
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-faint">Быстрый вход · пароль demo1234</p>
              <div className="space-y-1.5">
                {DEMO_USERS.map((u) => (
                  <button key={u.email} type="button" onClick={() => go(u.email, 'demo1234')} disabled={!!busy}
                    className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary disabled:opacity-60">
                    <Avatar name={u.name} color={u.color} size={32} />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold">{u.name}</span><span className="block truncate text-xs text-muted">{u.role}</span></span>
                    {busy === u.email ? <span className="text-xs text-muted">Входим…</span> : <ArrowRight className="size-4 text-faint" />}
                  </button>
                ))}
              </div>
              <p className="mt-4 text-xs text-faint">Первый запуск занимает несколько секунд: база создаётся прямо в браузере.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
