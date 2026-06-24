import { useRef, useState } from 'react'
import { Printer, X, MessageCircle, BookHeart, Loader2 } from 'lucide-react'

/**
 * PetBookPrint — A4 Pet Health Book with PDF + WhatsApp share.
 *
 * Renders the full longitudinal record (pet info, clinical summary, allergies,
 * vitals history, medical timeline with prescribed medicines, and lab records)
 * as a printable document, then exports it as a multi-page PDF that can be
 * shared via the native share sheet (WhatsApp) or printed / saved.
 *
 * Clinic name + contact details are pulled from the live /clinic/setup record
 * (passed in as `clinic`) so the header is always accurate.
 */
export default function PetBookPrint({ data, clinic, onClose }) {
  const printRef = useRef(null)
  const [showOptions, setShowOptions] = useState(false)
  const [generating, setGenerating] = useState(false)

  const pet = data?.pet || {}
  const summary = data?.summary || {}
  const allergies = data?.allergies || []
  const vitals = data?.vitals || []
  const timeline = data?.timeline || []
  const labs = data?.labs || []

  // ── Helpers ─────────────────────────────────────────────────
  const fmtDate = (d) => d
    ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  const today = new Date()
  const printedOn = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  const ageStr = (pet.age_years != null || pet.age_months != null)
    ? [pet.age_years ? `${pet.age_years}y` : null, pet.age_months ? `${pet.age_months}m` : null].filter(Boolean).join(' ') || '0m'
    : 'Not recorded'

  const clinicAddress = clinic
    ? [clinic.address1, clinic.address2, clinic.address3, clinic.district, clinic.state_name, clinic.pincode]
      .filter(Boolean).join(', ')
    : ''

  const dateSlug = printedOn.replace(/ /g, '-')
  const pdfFilename = `PetHealthBook_${pet.name || 'Pet'}_${dateSlug}.pdf`

  const C = '#1e3a5f' // brand colour

  // ── PDF generation (multi-page) ─────────────────────────────
  const generatePdfBlob = async () => {
    const { default: html2canvas } = await import('html2canvas')
    const { default: jsPDF } = await import('jspdf')

    const el = printRef.current
    if (!el) throw new Error('No element to capture')

    const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false })
    const imgData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const imgW = pageW
    const imgH = (canvas.height * pageW) / canvas.width

    if (imgH <= pageH) {
      pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH)
    } else {
      let y = 0
      while (y < imgH) {
        if (y > 0) pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, -y, imgW, imgH)
        y += pageH
      }
    }
    return pdf.output('blob')
  }

  const handleWhatsApp = async () => {
    setGenerating(true)
    try {
      const blob = await generatePdfBlob()
      const file = new File([blob], pdfFilename, { type: 'application/pdf' })
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Pet Health Book — ${pet.name || 'Pet'}`,
          text: `${clinic?.clinic_name || 'Animal Clinic'} — ${printedOn}`,
          files: [file],
        })
      } else {
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

  const handlePrint = () => {
    const printWindow = window.open('', '_blank', 'width=900,height=700')
    const html = printRef.current.innerHTML
    printWindow.document.write(`
      <!DOCTYPE html><html><head><title>${pdfFilename.replace('.pdf', '')}</title><meta charset="UTF-8"/>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: 'Inter', Arial, sans-serif; font-size: 12px; color: #1e293b; background: white; }
          .book-page { width: 210mm; margin: 0 auto; background: white; }
          @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } .book-page { width: 100%; } }
        </style>
      </head><body><div class="book-page">${html}</div></body></html>`)
    printWindow.document.close()
    setTimeout(() => { printWindow.focus(); printWindow.print(); printWindow.close() }, 700)
    setShowOptions(false)
  }

  // ── Small presentational helpers ────────────────────────────
  const SectionTitle = ({ children }) => (
    <div style={{ fontSize: '12px', fontWeight: 800, color: C, textTransform: 'uppercase', letterSpacing: '0.6px', borderBottom: `2px solid ${C}`, paddingBottom: '4px', marginBottom: '10px', marginTop: '18px' }}>
      {children}
    </div>
  )
  const InfoRow = ({ label, value }) => (
    <div style={{ display: 'flex', gap: '6px', fontSize: '11px', padding: '3px 0' }}>
      <span style={{ color: '#64748b', fontWeight: 600, minWidth: '92px', flexShrink: 0 }}>{label}:</span>
      <span style={{ fontWeight: 600, color: '#0f172a' }}>{value || '—'}</span>
    </div>
  )

  const Body = (
    <div ref={printRef} style={{ width: '100%', maxWidth: '760px', margin: '0 auto', background: 'white', fontFamily: "'Inter', Arial, sans-serif", color: '#1e293b' }}>

      {/* ── CLINIC HEADER ──────────────────────────────────── */}
      <div style={{ background: C, color: 'white', padding: '18px 24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px' }}>
          <div>
            <div style={{ fontSize: '22px', fontWeight: 800, letterSpacing: '0.4px' }}>
              🐾 {clinic?.clinic_name || 'Animal Clinic'}
            </div>
            {clinicAddress && <div style={{ fontSize: '10.5px', opacity: 0.85, marginTop: '4px', maxWidth: '420px' }}>{clinicAddress}</div>}
            <div style={{ fontSize: '10px', opacity: 0.8, marginTop: '3px' }}>
              {[clinic?.phone && `📞 ${clinic.phone}`, clinic?.email, clinic?.website].filter(Boolean).join('  ·  ')}
            </div>
            {(clinic?.reg_number || clinic?.drug_license_no || clinic?.gstin) && (
              <div style={{ fontSize: '9px', opacity: 0.7, marginTop: '3px' }}>
                {[clinic?.reg_number && `Reg No: ${clinic.reg_number}`, clinic?.drug_license_no && `DL: ${clinic.drug_license_no}`, clinic?.gstin && `GSTIN: ${clinic.gstin}`].filter(Boolean).join('  |  ')}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '15px', fontWeight: 700 }}>Pet Health Book</div>
            <div style={{ fontSize: '9.5px', opacity: 0.8, marginTop: '2px' }}>Printed: {printedOn}</div>
            {pet.pet_code && <div style={{ fontSize: '9.5px', opacity: 0.8 }}>ID: {pet.pet_code}</div>}
          </div>
        </div>
      </div>

      <div style={{ padding: '4px 24px 28px' }}>

        {/* ── PATIENT PROFILE ──────────────────────────────── */}
        <SectionTitle>Patient Profile</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 28px' }}>
          <div>
            <InfoRow label="Name" value={pet.name} />
            <InfoRow label="Species" value={pet.species_name} />
            <InfoRow label="Breed" value={pet.breed_name} />
            <InfoRow label="Sex" value={pet.gender} />
            <InfoRow label="Age" value={ageStr} />
          </div>
          <div>
            <InfoRow label="Date of Birth" value={pet.dob ? fmtDate(pet.dob) : '—'} />
            <InfoRow label="Colour" value={pet.color} />
            <InfoRow label="Current Weight" value={pet.weight_kg != null ? `${pet.weight_kg} kg` : '—'} />
            <InfoRow label="Blood Group" value={summary.blood_group} />
            <InfoRow label="Microchip No" value={summary.microchip_no} />
          </div>
        </div>
        <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 28px' }}>
          <InfoRow label="Owner" value={pet.owner_name} />
          <InfoRow label="Owner Phone" value={pet.owner_phone} />
          <InfoRow label="Neutered" value={summary.is_spayed_neutered ? 'Yes' : 'No'} />
        </div>

        {/* ── ALLERGIES ─────────────────────────────────────── */}
        <SectionTitle>Allergies &amp; Adverse Reactions</SectionTitle>
        {allergies.length === 0 ? (
          <div style={{ fontSize: '11px', color: '#16a34a', fontWeight: 600 }}>No known allergies recorded.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10.5px' }}>
            <thead>
              <tr style={{ background: '#fef2f2', color: '#991b1b', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Allergen</th>
                <th style={{ padding: '6px 8px' }}>Reaction</th>
                <th style={{ padding: '6px 8px' }}>Severity</th>
                <th style={{ padding: '6px 8px' }}>Discovered</th>
              </tr>
            </thead>
            <tbody>
              {allergies.map((a, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{a.allergen}</td>
                  <td style={{ padding: '6px 8px' }}>{a.reaction_type || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{a.severity || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{a.discovered_date ? fmtDate(a.discovered_date) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ── VITALS HISTORY ────────────────────────────────── */}
        <SectionTitle>Vitals &amp; Weight History</SectionTitle>
        {vitals.length === 0 ? (
          <div style={{ fontSize: '11px', color: '#64748b' }}>No vitals recorded.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10.5px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
                <th style={{ padding: '6px 8px' }}>Date</th>
                <th style={{ padding: '6px 8px' }}>Weight</th>
                <th style={{ padding: '6px 8px' }}>Temp</th>
                <th style={{ padding: '6px 8px' }}>HR</th>
                <th style={{ padding: '6px 8px' }}>RR</th>
                <th style={{ padding: '6px 8px' }}>BCS</th>
                <th style={{ padding: '6px 8px' }}>Source</th>
              </tr>
            </thead>
            <tbody>
              {vitals.map((v, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 8px' }}>{fmtDate(v.recorded_at)}</td>
                  <td style={{ padding: '6px 8px' }}>{v.weight_kg != null ? `${v.weight_kg} kg` : '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{v.temp_celsius != null ? `${v.temp_celsius} °C` : '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{v.heart_rate || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{v.resp_rate || '—'}</td>
                  <td style={{ padding: '6px 8px' }}>{v.body_condition_score ? `${v.body_condition_score}/9` : '—'}</td>
                  <td style={{ padding: '6px 8px', color: '#64748b' }}>{v.source || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* ── MEDICAL TIMELINE ──────────────────────────────── */}
        <SectionTitle>Medical Timeline</SectionTitle>
        {timeline.length === 0 ? (
          <div style={{ fontSize: '11px', color: '#64748b' }}>No medical events recorded.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {timeline.map((t, i) => (
              <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px 12px', breakInside: 'avoid' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                  <div style={{ fontWeight: 700, fontSize: '11.5px', color: '#0f172a' }}>
                    <span style={{ fontSize: '8.5px', fontWeight: 800, color: 'white', background: C, padding: '2px 6px', borderRadius: '4px', marginRight: '6px', textTransform: 'uppercase' }}>{t.event_type}</span>
                    {t.title}
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>{fmtDate(t.event_date)}</div>
                </div>

                {/* Structured detail fields, one per line */}
                {t.details?.map((d, di) => (
                  <div key={di} style={{ fontSize: '10.5px', color: '#334155', whiteSpace: 'pre-line', marginTop: '2px' }}>
                    <strong>{d.label}:</strong> {d.value}
                  </div>
                ))}

                {/* Prescribed medicines */}
                {t.medicines?.length > 0 && (
                  <div style={{ marginTop: '6px' }}>
                    <div style={{ fontSize: '9.5px', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', marginBottom: '3px' }}>Prescribed Medicines</div>
                    {t.medicines.map((m, mi) => (
                      <div key={mi} style={{ fontSize: '10.5px', color: '#334155', paddingLeft: '8px', borderLeft: '2px solid #ddd6fe', marginBottom: '4px' }}>
                        <span style={{ fontWeight: 700 }}>{m.medicine_name}</span>
                        {m.strength ? <span style={{ color: '#64748b' }}> ({m.strength}{m.dosage_form ? `, ${m.dosage_form}` : ''})</span> : null}
                        <div style={{ fontSize: '9.5px', color: '#64748b' }}>
                          {[m.dose, m.frequency, m.route, m.duration_days ? `${m.duration_days} day${m.duration_days > 1 ? 's' : ''}` : null, m.quantity != null ? `Qty: ${m.quantity}` : null].filter(Boolean).join(' · ')}
                        </div>
                        {m.instructions && <div style={{ fontSize: '9.5px', color: '#64748b', fontStyle: 'italic' }}>{m.instructions}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Fallback snippet when no structured data */}
                {!(t.details?.length > 0) && !(t.medicines?.length > 0) && t.summary_snippet && (
                  <div style={{ fontSize: '10.5px', color: '#334155', marginTop: '2px' }}>{t.summary_snippet}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── LAB RECORDS ───────────────────────────────────── */}
        <SectionTitle>Lab &amp; Diagnostics</SectionTitle>
        {labs.length === 0 ? (
          <div style={{ fontSize: '11px', color: '#64748b' }}>No lab records found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {labs.map((l, i) => (
              <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: '6px', padding: '8px 10px', fontSize: '10.5px' }}>
                <div style={{ fontWeight: 700 }}>{l.test_name} {l.test_category ? <span style={{ color: '#64748b', fontWeight: 400 }}>({l.test_category})</span> : null}</div>
                <div style={{ color: '#64748b', fontSize: '9.5px' }}>{fmtDate(l.sample_collected_date)} · {l.performed_by || 'In-House Lab'}</div>
                {l.results_summary && <div style={{ marginTop: '2px' }}>{l.results_summary}</div>}
              </div>
            ))}
          </div>
        )}

        {/* ── FOOTER ────────────────────────────────────────── */}
        <div style={{ marginTop: '24px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '9px', color: '#94a3b8', textAlign: 'center' }}>
          This is a computer-generated health record from {clinic?.clinic_name || 'the clinic'}. Generated on {printedOn}.
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" style={{ background: 'rgba(10,15,30,0.75)' }}>
      {showOptions && (
        <div className="absolute inset-0 flex items-center justify-center z-[130]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 w-80">
            <h3 className="font-bold text-slate-800 text-lg">Share Pet Health Book</h3>
            <button onClick={handleWhatsApp} disabled={generating}
              className="w-full flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white font-semibold py-4 rounded-xl transition-all text-base shadow-lg shadow-green-200">
              {generating ? <><Loader2 size={22} className="animate-spin" /> Generating PDF…</> : <><MessageCircle size={22} /> Share via WhatsApp</>}
            </button>
            <button onClick={handlePrint} disabled={generating}
              className="w-full flex items-center justify-center gap-3 bg-slate-800 hover:bg-slate-900 disabled:opacity-60 text-white font-semibold py-4 rounded-xl transition-all text-base shadow-lg shadow-slate-300">
              <Printer size={22} /> Print / Save PDF
            </button>
            <p className="text-xs text-slate-400 text-center">File: <span className="font-mono">{pdfFilename}</span></p>
            <button onClick={() => setShowOptions(false)} className="text-slate-400 hover:text-slate-600 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 bg-slate-50 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <BookHeart size={17} className="text-primary-600" />
            <span className="font-semibold text-slate-700 text-sm">Pet Health Book Preview</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setShowOptions(true)} disabled={generating}
              className="flex items-center gap-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all shadow-sm">
              {generating ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}
              {generating ? 'Generating…' : 'Print / Share'}
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
              <X size={17} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 bg-slate-200 p-4">
          <div style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.18)' }}>
            {Body}
          </div>
        </div>
      </div>
    </div>
  )
}
