import React, { useState, useEffect } from 'react'
import api from '../api'
import { Plus, Pencil, Search, Stethoscope } from 'lucide-react'

export default function Procedures() {
  const [procedures, setProcedures] = useState([])
  const [search, setSearch] = useState('')
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingProc, setEditingProc] = useState(null)

  // Masters
  const [hsnCodes, setHsnCodes] = useState([])
  const [gstRates, setGstRates] = useState([])

  const [formData, setFormData] = useState({
    procedure_name: '',
    category: 'Consultation',
    fee: 0,
    hsn_id: '',
    gst_rate_id: '',
    is_active: true
  })

  useEffect(() => {
    fetchProcedures()
    fetchMasters()
  }, [search])

  const fetchMasters = async () => {
    try {
      const [h, g] = await Promise.all([
        api.get('/masters/hsn'),
        api.get('/masters/gst-rates')
      ])
      setHsnCodes(h.data)
      setGstRates(g.data)
    } catch (err) { console.error(err) }
  }

  const fetchProcedures = async () => {
    try {
      const res = await api.get('/services/procedures', { params: { search } })
      setProcedures(res.data)
    } catch (err) { alert("Failed to fetch procedures") }
  }

  const handleOpenModal = (proc = null) => {
    if (proc) {
      setEditingProc(proc)
      setFormData({
        procedure_name: proc.procedure_name,
        category: proc.category || 'Consultation',
        fee: proc.fee,
        hsn_id: proc.hsn_id || '',
        gst_rate_id: proc.gst_rate_id || '',
        is_active: proc.is_active
      })
    } else {
      setEditingProc(null)
      setFormData({ procedure_name: '', category: 'Consultation', fee: 0, hsn_id: '', gst_rate_id: '', is_active: true })
    }
    setIsModalOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      const payload = {
        ...formData,
        hsn_id: formData.hsn_id ? Number(formData.hsn_id) : null,
        gst_rate_id: formData.gst_rate_id ? Number(formData.gst_rate_id) : null,
        fee: Number(formData.fee) || 0
      }
      if (editingProc) {
        await api.put(`/services/procedures/${editingProc.procedure_id}`, payload)
      } else {
        await api.post('/services/procedures', payload)
      }
      setIsModalOpen(false)
      fetchProcedures()
    } catch (err) {
      alert(err?.response?.data?.detail ? JSON.stringify(err.response.data.detail) : "Save failed")
    }
  }

  return (
    <div className="p-6 bg-slate-50 min-h-screen">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Procedures & Services Master</h1>
          <p className="text-slate-500 text-sm">Manage clinical fees and GST/HSN for billing</p>
        </div>
        <button 
          onClick={() => handleOpenModal()} 
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-2"
        >
          <Plus size={18} /> Add Procedure
        </button>
      </div>

      <div className="bg-white p-4 rounded-2xl shadow-sm mb-6 flex items-center gap-4 border border-slate-100">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Search by code or procedure name..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Code</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Procedure Name</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Category</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Base Fee (Excl. GST)</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase">Status</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-500 uppercase text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {procedures.map(p => (
              <tr key={p.procedure_id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-4 text-sm font-mono text-indigo-600">{p.procedure_code}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <Stethoscope size={16} className="text-slate-400" />
                    <span className="text-sm font-semibold text-slate-800">{p.procedure_name}</span>
                  </div>
                </td>
                <td className="px-6 py-4"><span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-md">{p.category}</span></td>
                <td className="px-6 py-4 font-mono text-sm font-bold text-slate-700">₹ {Number(p.fee).toLocaleString()}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 text-[10px] uppercase font-bold rounded-full ${p.is_active ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button onClick={() => handleOpenModal(p)} className="text-indigo-600 hover:text-indigo-800 font-bold text-sm">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-8 py-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-xl font-bold text-slate-800">{editingProc ? 'Edit Procedure' : 'New Clinical Service'}</h2>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600 text-2xl font-light">&times;</button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-8 space-y-5">
              <div>
                <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Service / Procedure Name</label>
                <input 
                  type="text" required 
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                  value={formData.procedure_name}
                  onChange={e => setFormData({...formData, procedure_name: e.target.value})}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Category</label>
                  <select 
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    value={formData.category}
                    onChange={e => setFormData({...formData, category: e.target.value})}
                  >
                    <option>Consultation</option>
                    <option>Surgery</option>
                    <option>Lab Diagnostic</option>
                    <option>Vaccination Fee</option>
                    <option>Grooming</option>
                    <option>Boarding</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">Base Fee (₹)</label>
                  <input 
                    type="number" step="0.01" required
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    value={formData.fee}
                    onChange={e => setFormData({...formData, fee: e.target.value})}
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 grid grid-cols-2 gap-4">
                <div className="col-span-2 text-indigo-600 text-xs font-bold uppercase tracking-widest">Tax Information</div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">HSN Code</label>
                  <select 
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    value={formData.hsn_id}
                    onChange={e => setFormData({...formData, hsn_id: e.target.value})}
                  >
                    <option value="">Select HSN</option>
                    {hsnCodes.map(h => <option key={h.hsn_id} value={h.hsn_id}>{h.hsn_code}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">GST Rate</label>
                  <select 
                    className="w-full border border-slate-200 rounded-xl px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
                    value={formData.gst_rate_id}
                    onChange={e => setFormData({...formData, gst_rate_id: e.target.value})}
                  >
                    <option value="">Select Rate</option>
                    {gstRates.map(g => <option key={g.gst_rate_id} value={g.gst_rate_id}>{g.gst_percent}%</option>)}
                  </select>
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-200 active:scale-95 transition-all">Save Service</button>
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-6 py-3 border border-slate-200 rounded-xl text-slate-500 hover:bg-slate-50 font-bold transition-all">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
