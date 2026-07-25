import { useEffect, useState } from 'react'
import { toast } from 'react-hot-toast'
import { Stethoscope, FileCheck2 } from 'lucide-react'
import api from '../api'
import FormModal from './FormModal'

/**
 * CertificateIssueModal — form for issuing any of the 10 standard veterinary
 * certificates (see backend routes/certificates.py CERT_TYPES). Each type has
 * its own small set of fields; everything is stored server-side as a single
 * `details` JSON blob against models.certificates.PetCertificate.
 *
 * ARV / Health-cum-Vaccination / Travel-cum-Vaccination auto-pull the pet's
 * existing vaccination history from the Pet Book timeline (passed in as
 * `timeline`) rather than asking staff to retype it.
 */
export const CERT_TYPE_CONFIG = {
  ARV: {
    label: 'Anti-Rabies Vaccination (ARV) Certificate',
    fields: [
      { key: 'vaccine_name', label: 'Vaccine Name', type: 'text', required: true },
      { key: 'batch_no', label: 'Batch No', type: 'text' },
      { key: 'manufacturer', label: 'Manufacturer', type: 'text' },
      { key: 'given_date', label: 'Date Given', type: 'date', required: true },
      { key: 'next_due_date', label: 'Next Due Date', type: 'date' },
    ],
  },
  HEALTH_VACC: {
    label: 'Health-cum-Vaccination Certificate',
    fields: [
      { key: 'fitness_note', label: 'Fitness / Health Statement', type: 'textarea',
        default: 'The animal has been examined and found to be in good health, active, and free from any visible signs of infectious or contagious disease at the time of examination.' },
    ],
    usesVaccinationHistory: true,
  },
  TRAVEL_VACC: {
    label: 'Travel-cum-Vaccination Certificate',
    fields: [
      { key: 'destination', label: 'Travel Destination', type: 'text', required: true },
      { key: 'mode_of_travel', label: 'Mode of Travel', type: 'text' },
      { key: 'travel_date', label: 'Date of Travel', type: 'date' },
      { key: 'fitness_note', label: 'Fitness / Health Statement', type: 'textarea',
        default: 'The animal has been examined and found fit to travel, in good health, and free from any visible signs of infectious or contagious disease.' },
    ],
    usesVaccinationHistory: true,
  },
  EUTHANASIA: {
    label: 'Euthanasia Certificate',
    fields: [
      { key: 'euthanasia_date', label: 'Date of Euthanasia', type: 'date', required: true },
      { key: 'reason', label: 'Reason', type: 'textarea', required: true },
      { key: 'method', label: 'Method Used', type: 'text' },
      { key: 'witness_name', label: 'Witness (Owner / Staff)', type: 'text' },
    ],
  },
  SURGICAL_RISK: {
    label: 'Surgical Risk Note',
    fields: [
      { key: 'procedure_name', label: 'Procedure', type: 'text', required: true },
      { key: 'procedure_date', label: 'Date', type: 'date', required: true },
      { key: 'risk_grade', label: 'Risk Category (e.g. Low / Moderate / High)', type: 'text' },
      { key: 'risk_notes', label: 'Risk Assessment Notes', type: 'textarea' },
    ],
  },
  STERILIZATION: {
    label: 'Sterilization Certificate',
    fields: [
      { key: 'procedure_date', label: 'Date of Procedure', type: 'date', required: true },
      { key: 'method', label: 'Method (Spay / Neuter)', type: 'text', required: true },
      { key: 'post_op_notes', label: 'Post-Operative Notes', type: 'textarea' },
    ],
  },
  DEATH: {
    label: 'Death Certificate',
    fields: [
      { key: 'date_of_death', label: 'Date of Death', type: 'date', required: true },
      { key: 'cause_of_death', label: 'Cause of Death', type: 'textarea', required: true },
    ],
  },
  MICROCHIP: {
    label: 'Microchip Implantation Certificate',
    fields: [
      { key: 'microchip_no', label: 'Microchip Number', type: 'text', required: true },
      { key: 'implant_date', label: 'Date of Implantation', type: 'date', required: true },
      { key: 'site', label: 'Implantation Site', type: 'text', default: 'Subcutaneous, between the shoulder blades' },
    ],
  },
  IDENTIFICATION: {
    label: 'Identification Certificate',
    fields: [
      { key: 'distinguishing_marks', label: 'Distinguishing Marks / Description', type: 'textarea' },
    ],
  },
  BOARDING: {
    label: 'Boarding & Lodging Certificate',
    fields: [
      { key: 'check_in_date', label: 'Check-In Date', type: 'date', required: true },
      { key: 'check_out_date', label: 'Check-Out Date', type: 'date' },
      { key: 'purpose', label: 'Purpose', type: 'text' },
    ],
  },
}

export default function CertificateIssueModal({ isOpen, onClose, petId, timeline = [], summary = {}, onIssued }) {
  const [certType, setCertType] = useState('ARV')
  const [doctors, setDoctors] = useState([])
  const [doctorId, setDoctorId] = useState('')
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [validUntil, setValidUntil] = useState('')
  const [fields, setFields] = useState({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) api.get('/doctors').then(r => setDoctors(r.data)).catch(() => {})
  }, [isOpen])

  const vaccineEvents = timeline.filter(t => t.event_type === 'VACCINE')

  // Reset + best-effort prefill whenever the certificate type changes (or the modal opens)
  useEffect(() => {
    if (!isOpen) return
    const cfg = CERT_TYPE_CONFIG[certType]
    const next = {}
    cfg.fields.forEach(f => { next[f.key] = f.default || '' })
    if (certType === 'ARV') {
      const rabies = vaccineEvents.find(v => /rabies|arv/i.test(v.title))
      if (rabies) {
        next.vaccine_name = rabies.title.replace(/^Vaccination\s*—\s*/i, '')
        const givenRow = rabies.details?.find(d => d.label === 'Given On')
        const dueRow = rabies.details?.find(d => d.label === 'Next Due')
        if (givenRow) next.given_date = givenRow.value
        if (dueRow) next.next_due_date = dueRow.value
      }
    }
    if (certType === 'MICROCHIP' && summary.microchip_no) {
      next.microchip_no = summary.microchip_no
    }
    setFields(next)
    setNotes('')
    setValidUntil('')
  }, [certType, isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null
  const cfg = CERT_TYPE_CONFIG[certType]

  const handleSubmit = async (e) => {
    e.preventDefault()
    const missing = cfg.fields.filter(f => f.required && !fields[f.key])
    if (missing.length) return toast.error(`${missing[0].label} is required`)
    setSaving(true)
    try {
      const details = { ...fields }
      if (cfg.usesVaccinationHistory) {
        details.vaccinations = vaccineEvents.map(v => ({
          name: v.title.replace(/^Vaccination\s*—\s*/i, ''),
          date: v.event_date ? v.event_date.slice(0, 10) : null,
          next_due: v.details?.find(d => d.label === 'Next Due')?.value || null,
        }))
      }
      const { data } = await api.post('/certificates', {
        pet_id: petId,
        cert_type: certType,
        doctor_id: doctorId || null,
        issue_date: issueDate,
        valid_until: validUntil || null,
        details,
        notes,
      })
      toast.success('Certificate issued')
      onIssued(data)
    } catch (err) {
      toast.error(err?.response?.data?.detail || 'Failed to issue certificate')
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormModal isOpen={isOpen} onClose={onClose} title="Issue New Certificate" size="lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="label">Certificate Type *</label>
          <select className="input-field" value={certType} onChange={e => setCertType(e.target.value)}>
            {Object.entries(CERT_TYPE_CONFIG).map(([key, c]) => (
              <option key={key} value={key}>{c.label}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Issuing Doctor</label>
            <div className="relative">
              <Stethoscope size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <select className="input-field !pl-7" value={doctorId} onChange={e => setDoctorId(e.target.value)}>
                <option value="">— Select doctor —</option>
                {doctors.map(d => <option key={d.doctor_id} value={d.doctor_id}>{d.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">Issue Date</label>
            <input type="date" className="input-field" value={issueDate} onChange={e => setIssueDate(e.target.value)} />
          </div>
        </div>

        {cfg.usesVaccinationHistory && (
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-600">
            <div className="font-semibold text-slate-700 mb-1">Vaccination history to include ({vaccineEvents.length})</div>
            {vaccineEvents.length === 0 ? (
              <p>No vaccination records found for this pet yet — the certificate will still be issued, with an empty history table.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {vaccineEvents.map((v, i) => (
                  <li key={i}>• {v.title.replace(/^Vaccination\s*—\s*/i, '')} — {v.event_date ? v.event_date.slice(0, 10) : '—'}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {cfg.fields.map(f => (
          <div key={f.key}>
            <label className="label">{f.label}{f.required ? ' *' : ''}</label>
            {f.type === 'textarea' ? (
              <textarea
                className="input-field"
                rows={3}
                value={fields[f.key] || ''}
                onChange={e => setFields(v => ({ ...v, [f.key]: e.target.value }))}
              />
            ) : (
              <input
                type={f.type}
                className="input-field"
                value={fields[f.key] || ''}
                onChange={e => setFields(v => ({ ...v, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}

        <div>
          <label className="label">Valid Until (optional)</label>
          <input type="date" className="input-field" value={validUntil} onChange={e => setValidUntil(e.target.value)} />
        </div>

        <div>
          <label className="label">Additional Notes</label>
          <textarea className="input-field" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
            <FileCheck2 size={16} /> {saving ? 'Issuing…' : 'Issue Certificate'}
          </button>
        </div>
      </form>
    </FormModal>
  )
}
