import { useState } from 'react';
import { Banknote, Calculator } from 'lucide-react';
import { api } from '../../api.ts';
import { money } from '../../lib/format.ts';
import { useAuth, useInvalidate, useList, useMeta } from '../../lib/state.tsx';
import { Button, FormRow, Input, Modal, Select, useToast } from '../../ui/ui.tsx';
import { EntityList } from '../../ui/data.tsx';
import { FinHeader } from './Finance.tsx';

export function Payroll() {
  const { field } = useMeta();
  const { can } = useAuth();
  const toast = useToast();
  const inv = useInvalidate();
  const [accrue, setAccrue] = useState(false);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const [pay, setPay] = useState<any>(null);
  const accounts = useList('fin_accounts', { limit: 50 }).data?.items ?? [];
  const [acc, setAcc] = useState('');
  const doAccrue = async () => {
    try { const r = await api.post('/api/payroll/accrue', { period }); toast.success(`Начислено сотрудникам: ${r.created}`); inv('payroll'); setAccrue(false); }
    catch (e) { toast.error(e); }
  };
  const doPay = async () => {
    try { await api.post(`/api/payroll/${pay.id}/pay`, { account_id: acc ? Number(acc) : undefined }); toast.success('Выплата проведена в Финансах'); inv('payroll', 'fin_operations'); setPay(null); }
    catch (e) { toast.error(e); }
  };
  return (
    <div>
      <FinHeader title="Зарплата" subtitle="Начисления и выплаты сотрудникам. Выплата автоматически создаёт расход по статье «Зарплата»."
        actions={can('finance', 'write') && <Button variant="primary" icon={<Calculator className="size-4" />} onClick={() => setAccrue(true)}>Начислить за месяц</Button>} />
      <EntityList entity="payroll" filters={[{ key: 'status', label: 'Статус', options: field('payroll', 'status')?.options }, { key: 'period', label: 'Период', options: [] }].filter((f) => f.options?.length)}
        formFields={['user_id', 'period', 'base', 'bonus', 'deductions', 'status', 'comment']}
        onRowClick={(r) => r.status !== 'paid' && can('finance', 'write') && setPay(r)}
        columns={['user_id', 'period', 'base', 'bonus', 'deductions', 'total', 'status', 'paid_date']} />
      <Modal open={accrue} onClose={() => setAccrue(false)} size="sm" title="Начисление зарплаты" subtitle="Оклады из карточек сотрудников, удержание НДФЛ 13%"
        footer={<><Button onClick={() => setAccrue(false)}>Отмена</Button><Button variant="primary" onClick={doAccrue}>Начислить</Button></>}>
        <FormRow label="Месяц"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></FormRow>
      </Modal>
      <Modal open={!!pay} onClose={() => setPay(null)} size="sm" title="Выплатить зарплату" subtitle={pay ? `${pay._ref?.user_id?.title}, ${pay.period}: ${money(pay.total)}` : ''}
        footer={<><Button onClick={() => setPay(null)}>Отмена</Button><Button variant="primary" icon={<Banknote className="size-4" />} onClick={doPay}>Выплатить</Button></>}>
        <FormRow label="Со счёта"><Select value={acc} onChange={(e) => setAcc(e.target.value)}>{accounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></FormRow>
      </Modal>
    </div>
  );
}
