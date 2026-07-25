import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-hot-toast';
import {
  Plus, Save, Trash2, RefreshCw, Search,
  FileText, Calendar, Hash, User,
  ChevronDown, ChevronUp, ReceiptText,
  Eye, EyeOff, X, AlertTriangle, CheckCircle2,
  Building2, Tag
} from 'lucide-react';
import api from '../api/axios';

const FY_OPTIONS = ['2023-24', '2024-25', '2025-26', '2026-27'];
const GST_RATES = [0, 5, 12, 18, 28];

// ─── Inline SearchableSelect ───────────────────────────────────────────────
function SearchableSelect({ options, value, textValue, onChange, onTextChange, placeholder, disabled, keyField = 'gl_id', labelFn }) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState(textValue || '');
  const ref = useRef(null);

  const selected = options.find(o => o[keyField] === value);

  useEffect(() => {
    if (textValue !== undefined) {
      setSearch(textValue);
    } else {
      setSearch(selected ? (labelFn ? labelFn(selected) : selected.gl_name || selected.name || '') : (!value ? '' : search));
    }
  }, [selected, value, textValue]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setIsOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const label = (o) => labelFn ? labelFn(o) : (o.gl_name || o.name || '');
  const filtered = options.filter(o => {
    const t = search.toLowerCase();
    return label(o).toLowerCase().includes(t) || (o.gl_code || o.code || '').toLowerCase().includes(t);
  });

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        disabled={disabled}
        className={`input-field h-10 w-full pr-8 text-sm ${disabled ? 'bg-slate-100 cursor-not-allowed' : ''}`}
        placeholder={placeholder || 'Search...'}
        value={search}
        onChange={e => { 
          const val = e.target.value;
          setSearch(val); 
          if (val.length > 0) setIsOpen(true); else setIsOpen(false);
          if (!val && onChange) onChange(null); 
          if (onTextChange) onTextChange(val);
        }}
        onFocus={() => { if (!disabled && search.length > 0) setIsOpen(true); }}
        onClick={() => { if (!disabled) setIsOpen(!isOpen); }}
      />
      <div className="absolute right-2 top-3 text-slate-400 pointer-events-none">
        {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </div>
      {isOpen && !disabled && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto min-w-[280px]">
          {filtered.length === 0
            ? <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
            : filtered.map(o => (
              <button key={o[keyField]} type="button"
                className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 transition-colors flex justify-between gap-2
                  ${o[keyField] === value ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-slate-700'}`}
                onClick={() => { 
                  if (onChange) onChange(o[keyField]); 
                  setSearch(label(o)); 
                  if (onTextChange) onTextChange(label(o));
                  setIsOpen(false); 
                }}
              >
                <span className="truncate">{label(o)}</span>
                <span className="text-[10px] text-slate-400 font-mono shrink-0">{o.gl_code || o.code || ''}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

// ─── Empty item row factory ────────────────────────────────────────────────
const makeEmptyItem = () => ({
  _id: crypto.randomUUID(),
  item_name: '',
  hsn_code: '',
  unit: '',
  quantity: '',
  rate: '',
  discount_pct: '',
  gst_pct: '',
  // computed
  discount_amt: 0,
  taxable_amount: 0,
  cgst_amount: 0,
  sgst_amount: 0,
  igst_amount: 0,
  line_total: 0,
});

// ─── Line computation helper ───────────────────────────────────────────────
function computeLine(item, isInterstate) {
  const qty = parseFloat(item.quantity) || 0;
  const rate = parseFloat(item.rate) || 0;
  const discPct = parseFloat(item.discount_pct) || 0;
  const gstPct = parseFloat(item.gst_pct) || 0;

  const gross = qty * rate;
  const discount_amt = (gross * discPct) / 100;
  const taxable_amount = gross - discount_amt;

  let cgst_amount = 0, sgst_amount = 0, igst_amount = 0;
  if (isInterstate) {
    igst_amount = (taxable_amount * gstPct) / 100;
  } else {
    cgst_amount = (taxable_amount * gstPct) / 200;
    sgst_amount = (taxable_amount * gstPct) / 200;
  }

  const line_total = taxable_amount + cgst_amount + sgst_amount + igst_amount;

  return {
    ...item,
    discount_amt: parseFloat(discount_amt.toFixed(2)),
    taxable_amount: parseFloat(taxable_amount.toFixed(2)),
    cgst_amount: parseFloat(cgst_amount.toFixed(2)),
    sgst_amount: parseFloat(sgst_amount.toFixed(2)),
    igst_amount: parseFloat(igst_amount.toFixed(2)),
    line_total: parseFloat(line_total.toFixed(2)),
  };
}

// ─── Main Component ─────────────────────────────────────────────────────────
export default function DebitNote() {
  const [activeTab, setActiveTab] = useState('new');

  // GL accounts
  const [glAccounts, setGlAccounts] = useState([]);

  // Units
  const [units, setUnits] = useState([]);

  // Items (Medicines + Procedures)
  const [masterItems, setMasterItems] = useState([]);

  // Next voucher number
  const [nextVoucherNo, setNextVoucherNo] = useState('DN-Auto');

  // Form header
  const [form, setForm] = useState({
    fy_code: '2026-27',
    voucher_date: new Date().toISOString().split('T')[0],
    ref_bill_no: '',
    ref_bill_date: '',
    gl_party_id: null,
    party_name: '',
    gl_debit_id: null,
    debit_desc: '',
    address1: '',
    address2: '',
    city: '',
    state_code: '',
    gstin: '',
    is_interstate: false,
    narration: '',
    // footer overrides
    discount_pct: '',  // bill-level disc %
  });

  // Item lines
  const [items, setItems] = useState([
    makeEmptyItem(), makeEmptyItem(), makeEmptyItem(),
    makeEmptyItem(), makeEmptyItem(),
  ]);

  // History
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [fyFilter, setFyFilter] = useState('');
  const [expandedRow, setExpandedRow] = useState(null);

  // Saving
  const [saving, setSaving] = useState(false);

  // ── Computed totals ──────────────────────────────────────────────────────
  const computed = (() => {
    const validItems = items.map(it => computeLine(it, form.is_interstate));
    const totalQty      = validItems.reduce((s, it) => s + (parseFloat(it.quantity) || 0), 0);
    const grossAmount   = validItems.reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.rate) || 0), 0);
    const totalDisc     = validItems.reduce((s, it) => s + it.discount_amt, 0);
    // Bill-level discount on top of item discounts
    const billDiscPct   = parseFloat(form.discount_pct) || 0;
    const subtaxable    = validItems.reduce((s, it) => s + it.taxable_amount, 0);
    const billDiscAmt   = (subtaxable * billDiscPct) / 100;
    const taxableAmount = subtaxable - billDiscAmt;
    const cgstAmount    = validItems.reduce((s, it) => s + it.cgst_amount, 0) * (1 - billDiscPct / 100);
    const sgstAmount    = validItems.reduce((s, it) => s + it.sgst_amount, 0) * (1 - billDiscPct / 100);
    const igstAmount    = validItems.reduce((s, it) => s + it.igst_amount, 0) * (1 - billDiscPct / 100);
    const grand         = taxableAmount + cgstAmount + sgstAmount + igstAmount;
    const roundOff      = Math.round(grand) - grand;
    const netAmount     = grand + roundOff;
    return {
      totalQty: parseFloat(totalQty.toFixed(3)),
      grossAmount: parseFloat(grossAmount.toFixed(2)),
      totalDisc: parseFloat(totalDisc.toFixed(2)),
      billDiscAmt: parseFloat(billDiscAmt.toFixed(2)),
      taxableAmount: parseFloat(taxableAmount.toFixed(2)),
      cgstAmount: parseFloat(cgstAmount.toFixed(2)),
      sgstAmount: parseFloat(sgstAmount.toFixed(2)),
      igstAmount: parseFloat(igstAmount.toFixed(2)),
      roundOff: parseFloat(roundOff.toFixed(2)),
      netAmount: parseFloat(netAmount.toFixed(2)),
    };
  })();

  // ── Load GL accounts and units on mount ──────────────────────────────────
  useEffect(() => {
    api.get('/ledger/gl').then(r => setGlAccounts(r.data || [])).catch(() => {});
    api.get('/inventory/units').then(r => setUnits(r.data || [])).catch(() => {});
    
    Promise.all([
      api.get('/inventory/medicines').catch(() => ({ data: [] })),
      api.get('/services/procedures').catch(() => ({ data: [] }))
    ]).then(([medsRes, procsRes]) => {
      const meds = (medsRes.data || []).map(m => ({
        id: `med_${m.medicine_id}`,
        type: 'Medicine',
        medicine_id: m.medicine_id,
        name: m.medicine_name,
        hsn_code: m.hsn_code || '',
        unit: m.unit || '',
        rate: m.selling_price || 0,
        gst_pct: m.gst_pct || 0
      }));
      const procs = (procsRes.data || []).map(p => ({
        id: `proc_${p.procedure_id}`,
        type: 'Procedure',
        procedure_id: p.procedure_id,
        name: p.procedure_name,
        hsn_code: p.hsn_code || '',
        unit: 'Nos',
        rate: p.fee || 0,
        gst_pct: p.gst_pct || 0
      }));
      setMasterItems([...meds, ...procs]);
    });

    fetchNextVoucherNo('2026-27');
  }, []);

  useEffect(() => { fetchNextVoucherNo(form.fy_code); }, [form.fy_code]);

  const fetchNextVoucherNo = async (fyCode) => {
    try {
      const res = await api.get('/accounts/debit-notes', { params: { fy_code: fyCode } });
      const count = (res.data || []).length;
      const fyShort = fyCode.replace('-', '').slice(2);
      setNextVoucherNo(`DN-${fyShort}${String(count + 1).padStart(5, '0')}`);
    } catch { setNextVoucherNo('DN-Auto'); }
  };

  // ── Item CRUD ────────────────────────────────────────────────────────────
  const updateItem = useCallback((id, changes) => {
    setItems(prev => prev.map(it => it._id === id
      ? computeLine({ ...it, ...changes }, form.is_interstate)
      : it
    ));
  }, [form.is_interstate]);

  // Recompute all items when interstate flag changes
  useEffect(() => {
    setItems(prev => prev.map(it => computeLine(it, form.is_interstate)));
  }, [form.is_interstate]);

  const removeItem = (id) => setItems(prev => prev.length > 1 ? prev.filter(it => it._id !== id) : prev);
  const addItem = () => setItems(prev => [...prev, makeEmptyItem()]);

  // ── Save handler ─────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form.fy_code)        return toast.error('FY Code required');
    if (!form.voucher_date)   return toast.error('Voucher Date required');
    if (!form.gl_party_id)    return toast.error('Party (GL account) required');

    const validItems = items.filter(it => it.item_name.trim() && (parseFloat(it.quantity) || 0) > 0);
    if (validItems.length === 0) return toast.error('Add at least one item with name and quantity');
    if (computed.netAmount <= 0) return toast.error('Net amount must be greater than 0');

    setSaving(true);
    try {
      const partyAcc = glAccounts.find(g => g.gl_id === form.gl_party_id);
      const creditAcc = glAccounts.find(g => g.gl_id === form.gl_debit_id);

      const payload = {
        fy_code: form.fy_code,
        voucher_date: form.voucher_date,
        ref_bill_no: form.ref_bill_no || null,
        ref_bill_date: form.ref_bill_date || null,
        gl_party_id: form.gl_party_id,
        party_name: partyAcc?.gl_name || form.party_name,
        gl_debit_id: form.gl_debit_id || null,
        debit_desc: creditAcc?.gl_name || form.debit_desc || null,
        address1: form.address1 || null,
        address2: form.address2 || null,
        city: form.city || null,
        state_code: form.state_code || null,
        gstin: form.gstin || null,
        is_interstate: form.is_interstate,
        total_qty: computed.totalQty,
        gross_amount: computed.grossAmount,
        discount_pct: parseFloat(form.discount_pct) || 0,
        discount_amt: computed.billDiscAmt,
        taxable_amount: computed.taxableAmount,
        cgst_rate: form.is_interstate ? 0 : (parseFloat(validItems[0]?.gst_pct) || 0) / 2,
        cgst_amount: computed.cgstAmount,
        sgst_rate: form.is_interstate ? 0 : (parseFloat(validItems[0]?.gst_pct) || 0) / 2,
        sgst_amount: computed.sgstAmount,
        igst_rate: form.is_interstate ? (parseFloat(validItems[0]?.gst_pct) || 0) : 0,
        igst_amount: computed.igstAmount,
        round_off: computed.roundOff,
        net_amount: computed.netAmount,
        narration: form.narration || null,
        items: validItems.map(it => ({
          item_name: it.item_name,
          hsn_code: it.hsn_code || null,
          unit: it.unit || null,
          quantity: parseFloat(it.quantity) || 0,
          rate: parseFloat(it.rate) || 0,
          discount_pct: parseFloat(it.discount_pct) || 0,
          discount_amt: it.discount_amt,
          taxable_amount: it.taxable_amount,
          gst_pct: parseFloat(it.gst_pct) || 0,
          cgst_amount: it.cgst_amount,
          sgst_amount: it.sgst_amount,
          igst_amount: it.igst_amount,
          line_total: it.line_total,
        })),
      };

      await api.post('/accounts/debit-notes/', payload);
      toast.success('Debit Note saved and GL posted!');
      resetForm();
      setActiveTab('history');
    } catch (err) {
      toast.error(err.response?.data?.detail || 'Failed to save debit note');
    } finally {
      setSaving(false);
    }
  };

  // ── Reset ────────────────────────────────────────────────────────────────
  const resetForm = () => {
    setForm({
      fy_code: '2026-27',
      voucher_date: new Date().toISOString().split('T')[0],
      ref_bill_no: '', ref_bill_date: '',
      gl_party_id: null, party_name: '',
      gl_debit_id: null, debit_desc: '',
      address1: '', address2: '', city: '', state_code: '', gstin: '',
      is_interstate: false, narration: '', discount_pct: '',
    });
    setItems([makeEmptyItem(), makeEmptyItem(), makeEmptyItem(), makeEmptyItem(), makeEmptyItem()]);
    fetchNextVoucherNo('2026-27');
  };

  // ── Party auto-fill from GL ───────────────────────────────────────────────
  const handlePartySelect = (glId) => {
    const acc = glAccounts.find(g => g.gl_id === glId);
    setForm(f => ({
      ...f,
      gl_party_id: glId,
      party_name: acc?.gl_name || '',
      address1: acc?.address1 || '',
      address2: acc?.address2 || '',
      city: acc?.city_id ? '' : (acc?.district || acc?.city || ''), // if you want city name
      state_code: acc?.state_code || '',
      gstin: acc?.gstin || ''
    }));
  };

  // ── History ──────────────────────────────────────────────────────────────
  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const params = {};
      if (fyFilter) params.fy_code = fyFilter;
      const res = await api.get('/accounts/debit-notes', { params });
      setHistory(res.data);
    } catch { toast.error('Failed to load debit notes'); }
    finally { setLoadingHistory(false); }
  };

  useEffect(() => { if (activeTab === 'history') fetchHistory(); }, [activeTab]);

  // ── Cancel voucher ────────────────────────────────────────────────────────
  const handleCancel = async (id) => {
    if (!window.confirm('Cancel this debit note? GL postings will be reversed.')) return;
    try {
      await api.delete(`/accounts/debit-notes/${id}`);
      toast.success('Debit Note cancelled — GL reversed');
      fetchHistory();
    } catch (err) { toast.error(err.response?.data?.detail || 'Cancel failed'); }
  };

  const statusBadge = (s) => {
    const cls = s === 'Confirmed' ? 'bg-emerald-100 text-emerald-700'
      : s === 'Cancelled' ? 'bg-indigo-100 text-indigo-700'
      : 'bg-amber-100 text-amber-700';
    return <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${cls}`}>{s}</span>;
  };

  const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-2xl font-black text-slate-800 flex items-center gap-3">
          <ReceiptText className="p-2 bg-indigo-50 text-indigo-600 rounded-xl" size={24} />
          Debit Note
          <span className="text-sm font-normal text-slate-400 ml-1">/ Purchase Return</span>
        </h1>
        <div className="flex bg-slate-100 p-1 rounded-xl w-fit shadow-inner">
          <button onClick={() => setActiveTab('new')}
            className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2
              ${activeTab === 'new' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
            <Plus size={14} /> New
          </button>
          <button onClick={() => { setActiveTab('history'); }}
            className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2
              ${activeTab === 'history' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500'}`}>
            <Search size={14} /> History
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════
          NEW CREDIT NOTE FORM
      ═══════════════════════════════════════ */}
      {activeTab === 'new' && (
        <div className="space-y-5">

          {/* ── Section 1: Voucher Info ── */}
          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-2xl space-y-4">
            <p className="text-xs font-black text-indigo-500 uppercase tracking-widest">Voucher Info</p>

            <div className="flex flex-wrap gap-4">
              {/* Voucher No */}
              <div className="flex-1 min-w-[150px]">
                <label className="label flex items-center gap-1 text-indigo-700"><Hash size={13} /> Voucher No</label>
                <input readOnly value={nextVoucherNo} className="input-field h-10 w-full font-mono bg-white text-indigo-700 font-bold cursor-not-allowed" />
              </div>
              {/* FY */}
              <div className="flex-1 min-w-[130px]">
                <label className="label flex items-center gap-1"><Calendar size={13} /> FY Code *</label>
                <select className="input-field h-10 w-full" value={form.fy_code}
                  onChange={e => setForm({ ...form, fy_code: e.target.value })}>
                  {FY_OPTIONS.map(fy => <option key={fy} value={fy}>{fy}</option>)}
                </select>
              </div>
              {/* Date */}
              <div className="flex-1 min-w-[150px]">
                <label className="label flex items-center gap-1"><Calendar size={13} /> Voucher Date *</label>
                <input type="date" className="input-field h-10 w-full" value={form.voucher_date}
                  onChange={e => setForm({ ...form, voucher_date: e.target.value })} />
              </div>
              {/* Ref Bill No */}
              <div className="flex-1 min-w-[150px]">
                <label className="label flex items-center gap-1"><FileText size={13} /> Ref Purchase Bill No</label>
                <input type="text" className="input-field h-10 w-full font-mono" value={form.ref_bill_no}
                  onChange={e => setForm({ ...form, ref_bill_no: e.target.value })}
                  placeholder="Original bill no" />
              </div>
              {/* Ref Bill Date */}
              <div className="flex-1 min-w-[150px]">
                <label className="label flex items-center gap-1"><Calendar size={13} /> Ref Bill Date</label>
                <input type="date" className="input-field h-10 w-full" value={form.ref_bill_date}
                  onChange={e => setForm({ ...form, ref_bill_date: e.target.value })} />
              </div>
            </div>
          </div>

          {/* ── Section 2: Party + Credit Account ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Party */}
            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm space-y-3">
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <User size={13} /> Party (Supplier)
              </p>
              <div>
                <label className="label">GL Account *</label>
                <SearchableSelect
                  options={glAccounts}
                  value={form.gl_party_id}
                  onChange={handlePartySelect}
                  placeholder="Search supplier GL account..."
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Address Line 1</label>
                  <input type="text" className="input-field h-9 w-full text-sm" value={form.address1}
                    onChange={e => setForm({ ...form, address1: e.target.value })} />
                </div>
                <div>
                  <label className="label">Address Line 2</label>
                  <input type="text" className="input-field h-9 w-full text-sm" value={form.address2}
                    onChange={e => setForm({ ...form, address2: e.target.value })} />
                </div>
                <div>
                  <label className="label">City</label>
                  <input type="text" className="input-field h-9 w-full text-sm" value={form.city}
                    onChange={e => setForm({ ...form, city: e.target.value })} />
                </div>
                <div>
                  <label className="label">State Code</label>
                  <input type="text" className="input-field h-9 w-full text-sm font-mono" value={form.state_code}
                    onChange={e => setForm({ ...form, state_code: e.target.value })} placeholder="e.g. 29" />
                </div>
                <div className="col-span-2">
                  <label className="label">GSTIN</label>
                  <input type="text" className="input-field h-9 w-full text-sm font-mono" value={form.gstin}
                    onChange={e => setForm({ ...form, gstin: e.target.value })} placeholder="15-digit GSTIN" />
                </div>
              </div>
            </div>

            {/* Credit Account + GST settings */}
            <div className="p-4 bg-white border border-slate-100 rounded-2xl shadow-sm space-y-3">
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                <Tag size={13} /> Debit Head & GST
              </p>
              <div>
                <label className="label">Credit/Purchase Return Account</label>
                <SearchableSelect
                  options={glAccounts}
                  value={form.gl_debit_id}
                  onChange={(id) => {
                    const acc = glAccounts.find(g => g.gl_id === id);
                    setForm(f => ({ ...f, gl_debit_id: id, debit_desc: acc?.gl_name || '' }));
                  }}
                  placeholder="Search sales return GL..."
                />
                <p className="text-[10px] text-slate-400 mt-1">Usually a "Purchase Returns" or "Sales Discount" account</p>
              </div>

              {/* Interstate toggle */}
              <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                <label className="relative inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={form.is_interstate}
                    onChange={e => setForm({ ...form, is_interstate: e.target.checked })} />
                  <div className="w-10 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:bg-indigo-500 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-5" />
                </label>
                <div>
                  <p className="text-xs font-bold text-slate-700">
                    {form.is_interstate ? '🌐 Interstate (IGST applies)' : '🏠 Intrastate (CGST + SGST applies)'}
                  </p>
                  <p className="text-[10px] text-slate-400">Toggle based on customer state vs. your state</p>
                </div>
              </div>

              {/* Bill-level discount */}
              <div>
                <label className="label">Bill-level Discount %</label>
                <input type="number" min="0" max="100" step="0.01"
                  className="input-field h-9 w-32 text-sm"
                  value={form.discount_pct}
                  onChange={e => setForm({ ...form, discount_pct: e.target.value })}
                  placeholder="0.00"
                />
              </div>

              {/* Narration */}
              <div>
                <label className="label">Narration</label>
                <input type="text" className="input-field h-9 w-full text-sm" value={form.narration}
                  onChange={e => setForm({ ...form, narration: e.target.value })}
                  placeholder="e.g. Goods returned due to quality issue" />
              </div>
            </div>
          </div>

          {/* ── Section 3: Item Lines Grid ── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
              <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Items / Services Returned</p>
              <button onClick={addItem}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-all">
                <Plus size={12} /> Add Row
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm min-w-[900px]">
                <thead>
                  <tr className="text-[10px] font-bold text-slate-400 uppercase border-b border-slate-100 bg-slate-50">
                    <th className="px-2 py-2 w-8">#</th>
                    <th className="px-2 py-2 min-w-[180px]">Item / Service Name *</th>
                    <th className="px-2 py-2 w-24">HSN Code</th>
                    <th className="px-2 py-2 w-20">Unit</th>
                    <th className="px-2 py-2 w-20">Qty</th>
                    <th className="px-2 py-2 w-24">Rate ₹</th>
                    <th className="px-2 py-2 w-20">Disc %</th>
                    <th className="px-2 py-2 w-24">Taxable ₹</th>
                    <th className="px-2 py-2 w-20">GST %</th>
                    {!form.is_interstate
                      ? <><th className="px-2 py-2 w-24">CGST ₹</th><th className="px-2 py-2 w-24">SGST ₹</th></>
                      : <th className="px-2 py-2 w-24">IGST ₹</th>
                    }
                    <th className="px-2 py-2 w-28 text-right">Total ₹</th>
                    <th className="px-2 py-2 w-8">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {items.map((item, idx) => {
                    const c = computeLine(item, form.is_interstate);
                    return (
                      <tr key={item._id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-2 py-1.5 text-xs text-slate-400">{idx + 1}</td>
                        <td className="px-2 py-1.5 min-w-[250px]">
                          <SearchableSelect
                            options={masterItems}
                            value={item.selected_item_id}
                            textValue={item.item_name}
                            onTextChange={(val) => updateItem(item._id, { item_name: val, selected_item_id: null })}
                            onChange={(val) => {
                              const selected = masterItems.find(m => m.id === val);
                              if (selected) {
                                updateItem(item._id, {
                                  selected_item_id: selected.id,
                                  item_name: selected.name,
                                  hsn_code: selected.hsn_code || '',
                                  unit: selected.unit || '',
                                  rate: selected.rate || 0,
                                  gst_pct: selected.gst_pct || 0,
                                });
                              }
                            }}
                            labelFn={(o) => `${o.name} (${o.type})`}
                            placeholder="Search item/service..."
                            keyField="id"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="text" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            value={item.hsn_code}
                            onChange={e => updateItem(item._id, { hsn_code: e.target.value })}
                            placeholder="HSN" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="text" list="units-list" className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            value={item.unit}
                            onChange={e => updateItem(item._id, { unit: e.target.value })}
                            placeholder="Unit" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="0.001"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            value={item.quantity}
                            onChange={e => updateItem(item._id, { quantity: e.target.value })}
                            placeholder="0" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" step="0.01"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            value={item.rate}
                            onChange={e => updateItem(item._id, { rate: e.target.value })}
                            placeholder="0.00" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" min="0" max="100" step="0.01"
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            value={item.discount_pct}
                            onChange={e => updateItem(item._id, { discount_pct: e.target.value })}
                            placeholder="0" />
                        </td>
                        <td className="px-2 py-1.5 text-right text-sm font-semibold text-slate-700 bg-slate-50/50">
                          {c.taxable_amount > 0 ? c.taxable_amount.toFixed(2) : ''}
                        </td>
                        <td className="px-2 py-1.5">
                          <select className="w-full px-1 py-1.5 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            value={item.gst_pct}
                            onChange={e => updateItem(item._id, { gst_pct: e.target.value })}>
                            <option value="">—</option>
                            {GST_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        </td>
                        {!form.is_interstate ? (
                          <>
                            <td className="px-2 py-1.5 text-right text-xs text-blue-600 font-semibold bg-blue-50/30">
                              {c.cgst_amount > 0 ? c.cgst_amount.toFixed(2) : ''}
                            </td>
                            <td className="px-2 py-1.5 text-right text-xs text-blue-600 font-semibold bg-blue-50/30">
                              {c.sgst_amount > 0 ? c.sgst_amount.toFixed(2) : ''}
                            </td>
                          </>
                        ) : (
                          <td className="px-2 py-1.5 text-right text-xs text-purple-600 font-semibold bg-purple-50/30">
                            {c.igst_amount > 0 ? c.igst_amount.toFixed(2) : ''}
                          </td>
                        )}
                        <td className="px-2 py-1.5 text-right font-bold text-indigo-700">
                          {c.line_total > 0 ? `₹${c.line_total.toFixed(2)}` : ''}
                        </td>
                        <td className="px-2 py-1.5 text-center">
                          <button onClick={() => removeItem(item._id)} disabled={items.length <= 1}
                            className="p-1 text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 rounded-lg transition-colors disabled:cursor-not-allowed">
                            <X size={13} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Unit datalist */}
            <datalist id="units-list">
              {units.map(u => <option key={u.unit_id || u.unit_name} value={u.unit_name || u} />)}
            </datalist>
          </div>

          {/* ── Section 4: Totals Footer ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <div className="p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-0.5">Total Qty</p>
              <p className="text-lg font-black text-slate-700">{computed.totalQty}</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-0.5">Gross Amount</p>
              <p className="text-lg font-black text-slate-700">₹{fmt(computed.grossAmount)}</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-0.5">Discount (Item + Bill)</p>
              <p className="text-lg font-black text-indigo-600">-₹{fmt(computed.totalDisc + computed.billDiscAmt)}</p>
            </div>
            <div className="p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-0.5">Taxable Amount</p>
              <p className="text-lg font-black text-slate-700">₹{fmt(computed.taxableAmount)}</p>
            </div>
            {!form.is_interstate ? (
              <>
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <p className="text-[10px] text-blue-400 uppercase font-bold mb-0.5">CGST</p>
                  <p className="text-lg font-black text-blue-700">₹{fmt(computed.cgstAmount)}</p>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <p className="text-[10px] text-blue-400 uppercase font-bold mb-0.5">SGST</p>
                  <p className="text-lg font-black text-blue-700">₹{fmt(computed.sgstAmount)}</p>
                </div>
              </>
            ) : (
              <div className="p-3 bg-purple-50 rounded-xl border border-purple-100">
                <p className="text-[10px] text-purple-400 uppercase font-bold mb-0.5">IGST</p>
                <p className="text-lg font-black text-purple-700">₹{fmt(computed.igstAmount)}</p>
              </div>
            )}
            <div className="p-3 bg-white rounded-xl border border-slate-100 shadow-sm">
              <p className="text-[10px] text-slate-400 uppercase font-bold mb-0.5">Round Off</p>
              <p className="text-base font-black text-slate-500">{computed.roundOff >= 0 ? '+' : ''}{computed.roundOff.toFixed(2)}</p>
            </div>
            <div className="p-3 bg-indigo-600 rounded-xl shadow-sm col-span-2 md:col-span-1">
              <p className="text-[10px] text-indigo-200 uppercase font-bold mb-0.5">Net Amount</p>
              <p className="text-xl font-black text-white">₹{fmt(computed.netAmount)}</p>
            </div>
          </div>

          {/* ── Actions ── */}
          <div className="flex gap-4">
            <button onClick={resetForm}
              className="flex-1 px-4 py-3 bg-slate-100 text-slate-500 font-black uppercase text-xs tracking-widest rounded-2xl hover:bg-slate-200 transition-all">
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={saving || computed.netAmount <= 0 || !form.gl_party_id}
              className="flex-[2] flex items-center justify-center gap-2 px-8 py-3 bg-indigo-600 text-white font-black uppercase text-xs tracking-widest rounded-2xl hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-all">
              {saving ? 'Saving...' : <><Save size={16} /> Save Debit Note</>}
            </button>
          </div>

          {!form.gl_party_id && (
            <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span><strong>Party GL Account required.</strong> Select a supplier GL account above before saving.</span>
            </div>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════
          HISTORY TAB
      ═══════════════════════════════════════ */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          {/* Filter bar */}
          <div className="flex flex-wrap gap-4 p-4 bg-slate-50 rounded-xl border border-dashed">
            <select className="input-field h-10 w-32" value={fyFilter}
              onChange={e => setFyFilter(e.target.value)}>
              <option value="">All FY</option>
              {FY_OPTIONS.map(fy => <option key={fy} value={fy}>{fy}</option>)}
            </select>
            <button onClick={fetchHistory}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-all">
              <RefreshCw size={14} /> Apply Filter
            </button>
          </div>

          {/* History table */}
          <div className="overflow-x-auto bg-white rounded-xl shadow-sm border border-slate-100">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr className="text-xs font-black text-slate-400 uppercase">
                  <th className="px-4 py-3">Voucher No</th>
                  <th className="px-4 py-3">FY</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Party</th>
                  <th className="px-4 py-3">Ref Bill</th>
                  <th className="px-4 py-3 text-right">Taxable</th>
                  <th className="px-4 py-3 text-right">GST</th>
                  <th className="px-4 py-3 text-right">Net Amt</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loadingHistory
                  ? <tr><td colSpan="10" className="px-4 py-8 text-center text-slate-400">Loading...</td></tr>
                  : history.length === 0
                  ? <tr><td colSpan="10" className="px-4 py-8 text-center text-slate-400">No credit notes found</td></tr>
                  : history.map(rec => {
                    const isExpanded = expandedRow === rec.dn_id;
                    const gstTotal = (rec.cgst_amount || 0) + (rec.sgst_amount || 0) + (rec.igst_amount || 0);
                    return (
                      <React.Fragment key={rec.dn_id}>
                        <tr className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 font-mono text-indigo-600 text-sm font-bold">{rec.voucher_no}</td>
                          <td className="px-4 py-3 text-xs text-slate-500 font-mono">{rec.fy_code}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">
                            {rec.voucher_date ? new Date(rec.voucher_date).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-700 max-w-[160px] truncate" title={rec.party_name}>
                            {rec.party_name}
                          </td>
                          <td className="px-4 py-3 text-xs font-mono text-slate-400">{rec.ref_bill_no || '—'}</td>
                          <td className="px-4 py-3 text-right text-sm text-slate-700">₹{fmt(rec.taxable_amount)}</td>
                          <td className="px-4 py-3 text-right text-sm text-blue-700">₹{fmt(gstTotal)}</td>
                          <td className="px-4 py-3 text-right font-black text-indigo-700">₹{fmt(rec.net_amount)}</td>
                          <td className="px-4 py-3">{statusBadge(rec.status)}</td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => setExpandedRow(isExpanded ? null : rec.dn_id)}
                                title={isExpanded ? 'Hide items' : 'View items'}
                                className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                                {isExpanded ? <EyeOff size={15} /> : <Eye size={15} />}
                              </button>
                              {rec.status === 'Confirmed' && (
                                <button onClick={() => handleCancel(rec.dn_id)} title="Cancel"
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors">
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expanded item lines */}
                        {isExpanded && (
                          <tr>
                            <td colSpan="10" className="px-4 pb-4 bg-indigo-50">
                              <div className="rounded-xl border border-indigo-100 overflow-hidden mt-1">
                                <div className="px-4 py-2 bg-indigo-100 border-b border-indigo-200">
                                  <p className="text-xs font-black text-indigo-600 uppercase tracking-widest">
                                    Items — {rec.voucher_no}
                                    {rec.narration && <span className="ml-3 font-normal normal-case text-indigo-400">{rec.narration}</span>}
                                  </p>
                                </div>
                                {rec.items && rec.items.length > 0 ? (
                                  <table className="w-full text-sm bg-white">
                                    <thead>
                                      <tr className="text-[10px] font-bold text-slate-400 uppercase border-b">
                                        <th className="px-3 py-2">Ln</th>
                                        <th className="px-3 py-2">Item Name</th>
                                        <th className="px-3 py-2">HSN</th>
                                        <th className="px-3 py-2 text-right">Qty</th>
                                        <th className="px-3 py-2 text-right">Rate</th>
                                        <th className="px-3 py-2 text-right">Disc %</th>
                                        <th className="px-3 py-2 text-right">Taxable</th>
                                        <th className="px-3 py-2 text-right">GST %</th>
                                        <th className="px-3 py-2 text-right">Tax Amt</th>
                                        <th className="px-3 py-2 text-right">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                      {rec.items.map((it, li) => {
                                        const taxAmt = (it.cgst_amount || 0) + (it.sgst_amount || 0) + (it.igst_amount || 0);
                                        return (
                                          <tr key={li} className="hover:bg-slate-50">
                                            <td className="px-3 py-1.5 text-xs text-slate-400">{it.line_no}</td>
                                            <td className="px-3 py-1.5 text-sm text-slate-700">{it.item_name}</td>
                                            <td className="px-3 py-1.5 text-xs font-mono text-slate-400">{it.hsn_code || '—'}</td>
                                            <td className="px-3 py-1.5 text-right">{it.quantity}</td>
                                            <td className="px-3 py-1.5 text-right">₹{Number(it.rate || 0).toFixed(2)}</td>
                                            <td className="px-3 py-1.5 text-right">{it.discount_pct || 0}%</td>
                                            <td className="px-3 py-1.5 text-right">₹{fmt(it.taxable_amount)}</td>
                                            <td className="px-3 py-1.5 text-right">{it.gst_pct || 0}%</td>
                                            <td className="px-3 py-1.5 text-right text-blue-700">₹{fmt(taxAmt)}</td>
                                            <td className="px-3 py-1.5 text-right font-bold text-indigo-700">₹{fmt(it.line_total)}</td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                    <tfoot>
                                      <tr className="border-t-2 border-indigo-200 bg-indigo-50">
                                        <td colSpan="6" className="px-3 py-2 text-right text-xs font-black text-slate-600 uppercase">Totals:</td>
                                        <td className="px-3 py-2 text-right font-black text-slate-700">₹{fmt(rec.taxable_amount)}</td>
                                        <td />
                                        <td className="px-3 py-2 text-right font-black text-blue-700">
                                          ₹{fmt((rec.cgst_amount || 0) + (rec.sgst_amount || 0) + (rec.igst_amount || 0))}
                                        </td>
                                        <td className="px-3 py-2 text-right font-black text-indigo-700">₹{fmt(rec.net_amount)}</td>
                                      </tr>
                                    </tfoot>
                                  </table>
                                ) : (
                                  <div className="px-4 py-4 text-center text-xs text-slate-400 bg-white">No line items available</div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
