import { useEffect, useState, useRef } from 'react'
import { Printer, X, MessageCircle, Stethoscope, Loader2 } from 'lucide-react'
import api from '../api'

/**
 * PrescriptionPrint — A4 Prescription with PDF WhatsApp Share
 *
 * Fixes:
 *  1. Doctor fetched directly from /doctors API by consultation.doctor_id
 *     (no longer relies on prop which could be stale/undefined)
 *  2. WhatsApp share generates a real PDF via html2canvas + jsPDF,
 *     then shares via navigator.share() with the PDF file attached.
 *     Filename = Prescription_PetName_DD-Mon-YYYY.pdf
 *  3. Print button opens a print window with correct CSS preserved.
 */
export default function PrescriptionPrint({ consultation, rxData, pet, owner, species, breed, onClose }) {
  const [clinic, setClinic] = useState(null)
  const [doctor, setDoctor] = useState(null)
  const [showOptions, setShowOptions] = useState(false)
  const [generating, setGenerating] = useState(false)   // PDF generation in progress
  const printRef = useRef(null)

  // ── Fetch Clinic setup ──────────────────────────────────────
  useEffect(() => {
    api.get('/clinic/setup')
      .then(r => setClinic(r.data))
      .catch(() => { })
  }, [])

  // ── Fetch Doctor directly from API ─────────────────────────
  // Always fetch ACTIVE doctors only.
  // If consultation.doctor_id points to a deactivated doctor,
  // fall back to the first active doctor in the system.
  useEffect(() => {
    const doctorId = consultation?.doctor_id

    const loadFirstActive = () =>
      api.get('/doctors')
        // Default endpoint returns is_active=true only
        .then(r => { if (r.data.length > 0) setDoctor(r.data[0]) })
        .catch(() => { })

    if (!doctorId) {
      loadFirstActive()
      return
    }

    api.get(`/doctors/${doctorId}`)
      .then(r => {
        const doc = r.data
        if (doc.is_active === false) {
          // Doctor is deactivated — use first active instead
          loadFirstActive()
        } else {
          setDoctor(doc)
        }
      })
      .catch(() => loadFirstActive())
  }, [consultation?.doctor_id])

  // ── Helpers ─────────────────────────────────────────────────
  const clinicAddress = clinic
    ? [clinic.address1, clinic.address2, clinic.address3, clinic.district, clinic.state_name, clinic.pincode]
      .filter(Boolean).join(', ')
    : ''

  const petAge = pet
    ? [pet.age_years ? `${pet.age_years}yr` : '', pet.age_months ? `${pet.age_months}mo` : '']
      .filter(Boolean).join(' ') || '—'
    : '—'

  const rawDate = consultation?.consult_date
  const consult_date = rawDate
    ? new Date(rawDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  // Filename: Prescription_Bruno_10-Jun-2026.pdf
  const dateSlug = rawDate
    ? new Date(rawDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-')
    : 'Date'
  const pdfFilename = `Prescription_${pet?.name || 'Pet'}_${dateSlug}.pdf`

  // ── Generate PDF Blob from the preview DOM ──────────────────
  const generatePdfBlob = async () => {
    const { default: html2canvas } = await import('html2canvas')
    const { default: jsPDF } = await import('jspdf')

    const el = printRef.current
    if (!el) throw new Error('No element to capture')

    // Scale 2× for crisp text on mobile screens
    const canvas = await html2canvas(el, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    })

    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const imgW = pageW
    const imgH = (canvas.height * pageW) / canvas.width

    if (imgH <= pageH) {
      pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH)
    } else {
      // Multi-page if content is tall
      let y = 0
      while (y < imgH) {
        if (y > 0) pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, -y, imgW, imgH)
        y += pageH
      }
    }

    return pdf.output('blob')
  }

  // ── WhatsApp: share actual PDF file ────────────────────────
  const handleWhatsApp = async () => {
    setGenerating(true)
    try {
      const blob = await generatePdfBlob()
      const file = new File([blob], pdfFilename, { type: 'application/pdf' })

      // navigator.share with files (works on Android / iOS, Chrome, Safari)
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Prescription — ${pet?.name || 'Pet'}`,
          text: `${clinic?.clinic_name || 'Animal Clinic'} — ${consult_date}`,
          files: [file],
        })
      } else {
        // Desktop fallback: download the PDF (WhatsApp desktop doesn't support Web Share)
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = pdfFilename
        a.click()
        URL.revokeObjectURL(url)
        alert('PDF downloaded! Open WhatsApp and attach this file to share with the owner.')
      }
      setShowOptions(false)
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error(err)
        alert('Could not share PDF. Try the Print option to save as PDF and share manually.')
      }
    } finally {
      setGenerating(false)
    }
  }

  // ── Browser Print ────────────────────────────────────────────
  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=700')
    const html = printRef.current.innerHTML
    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${pdfFilename.replace('.pdf', '')}</title>
          <meta charset="UTF-8"/>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: 'Inter', Arial, sans-serif; font-size: 12px; color: #1e293b; background: white; }
            .rx-page { width: 210mm; min-height: 297mm; margin: 0 auto; background: white; }
            @media print {
              body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
              .rx-page { width: 100%; }
            }
          </style>
        </head>
        <body><div class="rx-page">${html}</div></body>
      </html>
    `)
    printWindow.document.close()
    setTimeout(() => { printWindow.focus(); printWindow.print(); printWindow.close() }, 700)
    setShowOptions(false)
  }

  // ── Prescription HTML (shared between preview + PDF capture) ─
  const RxBody = (
    <div
      ref={printRef}
      style={{
        width: '100%', maxWidth: '595px', margin: '0 auto',
        background: 'white',
        fontFamily: "'Inter', Arial, sans-serif",
        fontSize: '12px', color: '#1e293b', position: 'relative',
      }}
    >
      {/* ── HEADER ──────────────────────────────────────────── */}
      <div style={{ background: '#1e3a5f', color: 'white', padding: '14px 20px 10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          {/* Left: Clinic info */}
          <div>
            <div style={{ fontSize: '20px', fontWeight: '800', letterSpacing: '0.5px' }}>
              🐾 {clinic?.clinic_name || 'Animal Clinic'}
            </div>
            {/* Subtitle: Animal Clinic tagline — NOT address (address is in footer) */}
            <div style={{ fontSize: '14px', opacity: 0.8, marginTop: '3px', fontStyle: 'italic', letterSpacing: '0.3px' }}>
              Animal Clinic
            </div>
            {(clinic?.drug_license_no || clinic?.reg_number) && (
              <div style={{ fontSize: '9px', opacity: 0.65, marginTop: '3px' }}>
                {clinic?.reg_number && `Reg No: ${clinic.reg_number}`}
                {clinic?.drug_license_no && ` | DL: ${clinic.drug_license_no}`}
              </div>
            )}
          </div>

          {/* Right: Doctor info — always rendered, shows loading state */}
          <div style={{ textAlign: 'right', minWidth: '140px' }}>
            {doctor ? (
              <>
                <div style={{ fontWeight: '700', fontSize: '13px', color: 'white' }}>
                  Dr. {doctor.name}
                </div>
                {doctor.qualification && (
                  <div style={{ opacity: 0.78, fontSize: '9.5px', color: 'white', marginTop: '2px' }}>
                    {doctor.qualification}
                  </div>
                )}
                {doctor.specialization && (
                  <div style={{ opacity: 0.72, fontSize: '9px', color: 'white' }}>
                    {doctor.specialization}
                  </div>
                )}
                {doctor.reg_number && (
                  <div style={{ opacity: 0.65, fontSize: '9px', color: 'white' }}>
                    Reg No: {doctor.reg_number}
                  </div>
                )}
              </>
            ) : (
              <div style={{ opacity: 0.5, fontSize: '10px', color: 'white' }}>Loading doctor…</div>
            )}
          </div>
        </div>
      </div>

      {/* Wave divider */}
      <div style={{ background: '#1e3a5f', lineHeight: 0 }}>
        <svg viewBox="0 0 500 20" style={{ display: 'block', width: '100%' }} preserveAspectRatio="none">
          <path d="M0,0 C125,20 375,20 500,0 L500,20 L0,20 Z" fill="white" />
        </svg>
      </div>

      {/* ── BODY ──────────────────────────────────────────────── */}
      <div style={{ padding: '12px 20px 6px' }}>
        {/* Date */}
        <div style={{ textAlign: 'right', fontSize: '11px', color: '#64748b', marginBottom: '10px' }}>
          <strong style={{ color: '#1e293b' }}>Date:</strong> {consult_date}
        </div>

        {/* Patient Info */}
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
          gap: '6px 10px', padding: '8px 12px',
          background: '#f8fafc', border: '1px solid #e2e8f0',
          borderRadius: '6px', marginBottom: '14px',
        }}>
          {[
            { label: 'Pet Name', value: pet?.name || '—' },
            { label: 'Species', value: species || '—' },
            { label: 'Breed', value: breed || '—' },
            { label: 'Age', value: petAge },
            { label: 'Sex', value: pet?.gender || '—' },
            { label: 'Owner', value: owner?.name || '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: '4px', fontSize: '11px' }}>
              <span style={{ color: '#64748b', fontWeight: '600', minWidth: '58px', flexShrink: 0 }}>{label}:</span>
              <span style={{ fontWeight: '600', color: '#0f172a', borderBottom: '1px dotted #94a3b8', flex: 1, paddingBottom: '1px' }}>{value}</span>
            </div>
          ))}
        </div>

        {/* Diagnosis */}
        {consultation?.diagnosis && (
          <div style={{ fontSize: '11px', marginBottom: '10px', padding: '6px 10px', background: '#eff6ff', borderLeft: '3px solid #1e3a5f', borderRadius: '0 4px 4px 0' }}>
            <strong>Diagnosis:</strong> {consultation.diagnosis}
          </div>
        )}

        {/* Two-column: Vitals | Rx */}
        <div style={{ display: 'flex', minHeight: '200px', borderTop: '1px solid #e2e8f0', paddingTop: '10px' }}>
          {/* Left: Vitals */}
          <div style={{ width: '38%', borderRight: '1px solid #cbd5e1', paddingRight: '16px' }}>
            <div style={{ fontSize: '10px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>
              Clinical Findings
            </div>
            {[
              { label: 'TEMP', value: consultation?.temp_fahrenheit ? `${consultation.temp_fahrenheit} °F` : (consultation?.temp_celsius ? `${((parseFloat(consultation.temp_celsius) * 9/5) + 32).toFixed(1)} °F` : '') },
              { label: 'WT', value: consultation?.weight_kg ? `${consultation.weight_kg} kg` : '' },
              { label: 'HR', value: consultation?.heart_rate ? `${consultation.heart_rate} bpm` : '' },
              { label: 'RR', value: consultation?.resp_rate ? String(consultation.resp_rate) : '' },
              { label: 'MM', value: '' },
              { label: 'CRT', value: '' },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'baseline', fontSize: '11px', marginBottom: '14px' }}>
                <span style={{ fontWeight: '700', color: '#1e3a5f', width: '42px', flexShrink: 0 }}>{label}:</span>
                <span style={{ flex: 1, borderBottom: '1px dotted #94a3b8', marginLeft: '4px', minHeight: '14px', paddingBottom: '1px', fontWeight: '500', color: '#334155' }}>{value}</span>
              </div>
            ))}

            {/* Lab Tests */}
            <div style={{ fontSize: '11px', marginTop: '4px' }}>
              <div style={{ fontWeight: '700', color: '#1e3a5f', marginBottom: '6px' }}>Lab Tests:</div>
              {['CBP', 'LFT', 'KFT', 'THYROID PROFILE'].map(lt => (
                <div key={lt} style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '5px', fontSize: '10px', color: '#475569' }}>
                  <span style={{ width: '10px', height: '10px', border: '1px solid #94a3b8', display: 'inline-block', borderRadius: '2px', flexShrink: 0 }} />
                  {lt}
                </div>
              ))}
            </div>
          </div>

          {/* Right: Rx */}
          <div style={{ width: '62%', paddingLeft: '20px' }}>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: '30px', fontStyle: 'italic', color: '#1e3a5f', fontWeight: '700', marginBottom: '10px', lineHeight: 1 }}>
              ℞
            </div>

            {/* Chief Complaint — each newline becomes its own bullet line */}
            {consultation?.chief_complaint && (
              <div style={{ fontSize: '11px', marginBottom: '10px', padding: '6px 10px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '4px' }}>
                <strong style={{ color: '#92400e', display: 'block', marginBottom: '3px' }}>Chief Complaint:</strong>
                {consultation.chief_complaint.split('\n').map(l => l.trim()).filter(Boolean).map((line, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '5px', color: '#78350f', marginTop: idx > 0 ? '3px' : 0 }}>
                    <span style={{ flexShrink: 0, marginTop: '1px' }}>•</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            )}

            {(!rxData?.items || rxData.items.length === 0) ? (
              <div style={{ color: '#94a3b8', fontSize: '11px', fontStyle: 'italic' }}>No medicines prescribed.</div>
            ) : rxData.items.map((item, i) => (
              <div key={i} style={{ marginBottom: '12px', paddingBottom: '10px', borderBottom: i < rxData.items.length - 1 ? '1px dashed #e2e8f0' : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: '17px', height: '17px', borderRadius: '50%',
                    background: '#1e3a5f', color: 'white', fontSize: '9px',
                    fontWeight: '700', marginRight: '6px', flexShrink: 0,
                  }}>
                    {i + 1}
                  </span>
                  <span style={{ fontSize: '12px', fontWeight: '700', color: '#0f172a' }}>
                    {item.medicine_name}
                    {item.strength && <span style={{ fontWeight: '500', color: '#475569', marginLeft: '4px' }}>{item.strength}</span>}
                    {item.dosage_form && <span style={{ fontWeight: '400', color: '#64748b', marginLeft: '4px', fontSize: '10px' }}>({item.dosage_form})</span>}
                  </span>
                </div>
                <div style={{ marginLeft: '23px', marginTop: '3px', fontSize: '10.5px', color: '#334155' }}>
                  {[
                    item.dose,
                    item.frequency,
                    item.duration_days ? `for ${item.duration_days} day${item.duration_days > 1 ? 's' : ''}` : null,
                    item.route ? `(${item.route})` : null,
                  ].filter(Boolean).join(' · ')}
                </div>
                {item.instructions && (
                  <div style={{ marginLeft: '23px', marginTop: '2px', fontSize: '9.5px', color: '#64748b', fontStyle: 'italic' }}>
                    {item.instructions}
                  </div>
                )}
              </div>
            ))}

            {rxData?.notes && (
              <div style={{ marginTop: '10px', padding: '6px 10px', background: '#f1f5f9', borderRadius: '4px', fontSize: '10.5px', color: '#334155' }}>
                <strong>Instructions:</strong> {rxData.notes}
              </div>
            )}
            {consultation?.advice && (
              <div style={{ marginTop: '8px', padding: '6px 10px', background: '#f0fdf4', borderRadius: '4px', fontSize: '10.5px', color: '#166534' }}>
                <strong>Advice:</strong> {consultation.advice}
              </div>
            )}
            {consultation?.followup_date && (
              <div style={{ marginTop: '8px', padding: '5px 10px', border: '1px solid #e2e8f0', borderRadius: '4px', fontSize: '10.5px', color: '#475569' }}>
                🗓 <strong>Follow-up:</strong>{' '}
                {new Date(consultation.followup_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── WAVE FOOTER ─────────────────────────────────────── */}
      <div style={{ marginTop: '24px', lineHeight: 0 }}>
        <svg viewBox="0 0 500 20" style={{ display: 'block', width: '100%' }} preserveAspectRatio="none">
          <path d="M0,20 C125,0 375,0 500,20 L500,20 L0,20 Z" fill="#1e3a5f" />
        </svg>
      </div>
      <div style={{ background: '#1e3a5f', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 20px', fontSize: '11px' }}>
        <div style={{ fontWeight: '600' }}>
          {(clinic?.phone || clinic?.alt_phone) ? '📞 ' : ''}
          {[clinic?.phone, clinic?.alt_phone].filter(Boolean).join('  ·  ')}
        </div>
        <div style={{ fontSize: '10px', opacity: 0.85, textAlign: 'right', maxWidth: '55%' }}>
          {clinicAddress}
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: 'rgba(10,15,30,0.75)' }}>

      {/* ── Share Options Picker ─────────────────────────────── */}
      {showOptions && (
        <div className="absolute inset-0 flex items-center justify-center z-[110]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 w-80 animate-in zoom-in-95 duration-150">
            <h3 className="font-bold text-slate-800 text-lg">Share Prescription</h3>

            {/* WhatsApp PDF share */}
            <button
              onClick={handleWhatsApp}
              disabled={generating}
              className="w-full flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white font-semibold py-4 rounded-xl transition-all text-base shadow-lg shadow-green-200"
            >
              {generating
                ? <><Loader2 size={22} className="animate-spin" /> Generating PDF…</>
                : <><MessageCircle size={22} /> Share via WhatsApp</>
              }
            </button>

            {/* Print / Download PDF */}
            <button
              onClick={handlePrint}
              disabled={generating}
              className="w-full flex items-center justify-center gap-3 bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white font-semibold py-4 rounded-xl transition-all text-base shadow-lg shadow-slate-300"
            >
              <Printer size={22} />
              Print / Save PDF
            </button>

            <p className="text-xs text-slate-400 text-center">
              File: <span className="font-mono">{pdfFilename}</span>
            </p>
            <button onClick={() => setShowOptions(false)} className="text-slate-400 hover:text-slate-600 text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Preview Container ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <Stethoscope size={17} className="text-primary-600" />
            <span className="font-semibold text-slate-700 text-sm">Prescription Preview</span>
            {rxData?.rx_no && (
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">
                {rxData.rx_no}
              </span>
            )}
            {doctor && (
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                Dr. {doctor.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowOptions(true)}
              disabled={generating}
              className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm"
            >
              {generating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
              {generating ? 'Generating…' : 'Print / Share'}
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={17} />
            </button>
          </div>
        </div>

        {/* A4 Preview scrollable */}
        <div className="overflow-y-auto flex-1 bg-slate-200 p-4">
          <div style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}>
            {RxBody}
          </div>
        </div>
      </div>
    </div>
  )
}
