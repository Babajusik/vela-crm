import { useState } from 'react';
import { FileUp, Upload } from 'lucide-react';
import { api } from '../../api.ts';
import { date, money } from '../../lib/format.ts';
import { useInvalidate, useList } from '../../lib/state.tsx';
import { Badge, Button, Card, Checkbox, FormRow, Select, cx, useToast } from '../../ui/ui.tsx';
import { DataTable, readTextFile } from '../../ui/data.tsx';
import { FinHeader } from './Finance.tsx';

const SAMPLE = `1CClientBankExchange
ВерсияФормата=1.03
Кодировка=Windows
РасчСчет=40702810900000012345
СекцияДокумент=Платежное поручение
Номер=318
Дата=${new Date().toLocaleDateString('ru-RU')}
Сумма=48000.00
ПлательщикСчет=40702810500000077777
ПлательщикИНН=7701987654
Плательщик1=ООО «Новый клиент»
ПолучательСчет=40702810900000012345
ПолучательИНН=7725112233
НазначениеПлатежа=Оплата по счету № 5 за внедрение CRM. В т.ч. НДС 22%
ДатаПоступило=${new Date().toLocaleDateString('ru-RU')}
КонецДокумента
СекцияДокумент=Платежное поручение
Номер=1204
Дата=${new Date().toLocaleDateString('ru-RU')}
Сумма=12990.00
ПлательщикСчет=40702810900000012345
ПлательщикИНН=7725112233
ПолучательСчет=40702810800000055555
ПолучательИНН=7703000111
Получатель1=ООО «Связь Онлайн»
НазначениеПлатежа=Оплата за интернет и телефонию за месяц
ДатаСписано=${new Date().toLocaleDateString('ru-RU')}
КонецДокумента
КонецФайла`;

export function ImportStatement() {
  const accounts = useList('fin_accounts', { kind: 'bank', limit: 50 }).data?.items ?? [];
  const history = useList('bank_imports', { limit: 20 }).data?.items ?? [];
  const toast = useToast();
  const inv = useInvalidate();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [acc, setAcc] = useState('');
  const [createCompanies, setCreateCompanies] = useState(true);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = async (t: string, name: string) => {
    setText(t);
    setFileName(name);
    try { setPreview(await api.post('/api/finance/import-statement', { text: t, account_id: acc ? Number(acc) : undefined, dry_run: true })); }
    catch (e) { toast.error(e); setPreview(null); }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.post('/api/finance/import-statement', { text, file_name: fileName, account_id: acc ? Number(acc) : undefined, create_companies: createCompanies });
      toast.success(`Загружено операций: ${r.created}${r.skipped ? `, пропущено дублей: ${r.skipped}` : ''}`);
      inv('fin_operations', 'bank_imports', 'invoices', 'companies');
      setPreview(null);
      setText('');
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  return (
    <div>
      <FinHeader title="Загрузка выписки" subtitle="Файл из клиент-банка или 1С в формате 1CClientBankExchange (kl_to_1c.txt)" />
      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Card>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow label="Расчётный счёт" hint="Определится по номеру счёта в файле, если не выбрать">
                <Select value={acc} onChange={(e) => setAcc(e.target.value)}><option value="">Определить автоматически</option>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select>
              </FormRow>
              <div className="flex items-end"><Checkbox checked={createCompanies} onChange={setCreateCompanies} label="Создавать новых контрагентов по ИНН" /></div>
            </div>
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line py-10 text-center hover:border-primary">
              <FileUp className="size-8 text-faint" />
              <span className="font-semibold">{fileName || 'Выберите файл выписки'}</span>
              <span className="text-sm text-muted">Кодировка Windows-1251 или UTF-8 — определится сама</span>
              <input type="file" accept=".txt" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) load(await readTextFile(f), f.name); }} />
            </label>
            <button type="button" className="mt-2 text-sm font-semibold text-primary hover:underline" onClick={() => load(SAMPLE, 'пример_выписки.txt')}>Попробовать на примере выписки</button>
          </Card>
          {preview && (
            <Card padded={false} title={`Предпросмотр: ${preview.total} операций`} subtitle={preview.header?.['ДатаНачала'] ? `Период ${preview.header['ДатаНачала']} — ${preview.header['ДатаКонца']}` : undefined}
              actions={<Button variant="primary" icon={<Upload className="size-4" />} loading={busy} onClick={run}>Загрузить</Button>}>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead><tr className="text-left text-xs font-bold uppercase tracking-wide text-faint"><th className="px-3 py-2">Дата</th><th className="px-3 py-2">Контрагент</th><th className="px-3 py-2">Назначение</th><th className="px-3 py-2 text-right">Сумма</th><th className="px-3 py-2" /></tr></thead>
                  <tbody>
                    {preview.preview.map((p: any, i: number) => (
                      <tr key={i} className={cx('border-t border-line', p.duplicate && 'opacity-50')}>
                        <td className="whitespace-nowrap px-3 py-2">{date(p.date)}</td>
                        <td className="px-3 py-2"><div className="font-semibold">{p.counterparty}</div><div className="text-xs text-muted">ИНН {p.inn || '—'}{p.company ? ` · найдена «${p.company}»` : ' · новый контрагент'}</div></td>
                        <td className="max-w-md px-3 py-2 text-muted">{p.purpose}</td>
                        <td className={cx('whitespace-nowrap px-3 py-2 text-right font-bold tabular', p.kind === 'income' ? 'text-success' : 'text-danger')}>{p.kind === 'income' ? '+' : '−'}{money(p.amount)}</td>
                        <td className="px-3 py-2">{p.duplicate ? <Badge color="#94a3b8">уже загружена</Badge> : p.invoice_id ? <Badge color="#10b981">оплата счёта</Badge> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
        <Card title="Как это работает">
          <ol className="list-decimal space-y-2 pl-4 text-sm text-muted">
            <li>Выгрузите выписку из интернет-банка в формате «1С» (файл <code>kl_to_1c.txt</code>).</li>
            <li>CRM разнесёт операции по статьям: аренда, зарплата, налоги, связь и т. д.</li>
            <li>Контрагенты найдутся по ИНН. Если в назначении есть «счёт № …», оплата привяжется к счёту, и он станет оплаченным.</li>
            <li>Повторная загрузка той же выписки не создаст дублей.</li>
          </ol>
        </Card>
      </div>
      {history.length > 0 && (
        <Card padded={false} title="История загрузок" className="mt-5">
          <DataTable entity="bank_imports" rows={history} columns={[{ key: 'created_at', label: 'Когда', render: (r: any) => date(r.created_at) }, 'file_name', 'account_id', 'rows', 'created_ops', 'skipped']} />
        </Card>
      )}
    </div>
  );
}
