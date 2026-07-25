import { useRef, useState } from 'react'
import { Printer, X, MessageCircle, Award, Loader2 } from 'lucide-react'

/**
 * CertificatePrint — A4 certificate with PDF + WhatsApp share, for any of the
 * 10 standard veterinary certificate types issued via CertificateIssueModal.
 * Same generate/share/print pattern as PetBookPrint.jsx (html2canvas → jsPDF,
 * Web Share API with a forced-download fallback).
 *
 * `certificate` is the serialized PetCertificate from GET/POST /certificates
 * (cert_no, cert_type, cert_type_label, doctor_name, owner_name, details, ...).
 * `pet`/`summary` are the corresponding blocks from the Pet Book payload
 * (species/breed/gender/dob/weight, blood group/microchip/neuter status).
 */
export default function CertificatePrint({ certificate, pet, summary, clinic, onClose }) {
  const printRef = useRef(null)
  const [showOptions, setShowOptions] = useState(false)
  const [generating, setGenerating] = useState(false)

  const cert = certificate || {}
  const d = cert.details || {}
  const p = pet || {}
  const s = summary || {}

  const fmtDate = (val) => val
    ? new Date(val).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'

  const today = new Date()
  const printedOn = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })

  const ageStr = (p.age_years != null || p.age_months != null)
    ? [p.age_years ? `${p.age_years}y` : null, p.age_months ? `${p.age_months}m` : null].filter(Boolean).join(' ') || '0m'
    : 'Not recorded'

  const clinicAddress = clinic
    ? [clinic.address1, clinic.address2, clinic.address3, clinic.district, clinic.state_name, clinic.pincode]
      .filter(Boolean).join(', ')
    : ''

  const dateSlug = printedOn.replace(/ /g, '-')
  const pdfFilename = `${(cert.cert_type_label || 'Certificate').replace(/[^\w]+/g, '_')}_${cert.pet_name || p.name || 'Pet'}_${dateSlug}.pdf`

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
          title: `${cert.cert_type_label || 'Certificate'} — ${cert.pet_name || p.name || 'Pet'}`,
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
          .cert-page { width: 210mm; margin: 0 auto; background: white; }
          @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } .cert-page { width: 100%; } }
        </style>
      </head><body><div class="cert-page">${html}</div></body></html>`)
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
      <span style={{ color: '#64748b', fontWeight: 600, minWidth: '110px', flexShrink: 0 }}>{label}:</span>
      <span style={{ fontWeight: 600, color: '#0f172a' }}>{value || '—'}</span>
    </div>
  )
  const Statement = ({ children }) => (
    <p style={{ fontSize: '11.5px', lineHeight: 1.7, color: '#1e293b', marginTop: '6px', whiteSpace: 'pre-line' }}>{children}</p>
  )
  const VaccineTable = ({ rows }) => (
    !rows || rows.length === 0 ? (
      <div style={{ fontSize: '11px', color: '#64748b' }}>No vaccination records on file.</div>
    ) : (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10.5px', marginTop: '6px' }}>
        <thead>
          <tr style={{ background: '#f8fafc', color: '#475569', textAlign: 'left' }}>
            <th style={{ padding: '6px 8px' }}>Vaccine</th>
            <th style={{ padding: '6px 8px' }}>Date Given</th>
            <th style={{ padding: '6px 8px' }}>Next Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.name}</td>
              <td style={{ padding: '6px 8px' }}>{fmtDate(r.date)}</td>
              <td style={{ padding: '6px 8px' }}>{r.next_due ? fmtDate(r.next_due) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  )

  // ── Type-specific certificate body ──────────────────────────
  const renderBody = () => {
    switch (cert.cert_type) {
      case 'ARV':
        return (
          <>
            <Statement>This is to certify that the animal described above has been vaccinated against <strong>Rabies</strong>, details of which are given below.</Statement>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10.5px', marginTop: '10px' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: '6px 8px', color: '#64748b', fontWeight: 600, width: '160px' }}>Vaccine Name</td><td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.vaccine_name || '—'}</td></tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: '6px 8px', color: '#64748b', fontWeight: 600 }}>Batch No</td><td style={{ padding: '6px 8px' }}>{d.batch_no || '—'}</td></tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: '6px 8px', color: '#64748b', fontWeight: 600 }}>Manufacturer</td><td style={{ padding: '6px 8px' }}>{d.manufacturer || '—'}</td></tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: '6px 8px', color: '#64748b', fontWeight: 600 }}>Date Given</td><td style={{ padding: '6px 8px' }}>{fmtDate(d.given_date)}</td></tr>
                <tr><td style={{ padding: '6px 8px', color: '#64748b', fontWeight: 600 }}>Next Due Date</td><td style={{ padding: '6px 8px' }}>{d.next_due_date ? fmtDate(d.next_due_date) : '—'}</td></tr>
              </tbody>
            </table>
          </>
        )
      case 'HEALTH_VACC':
        return (
          <>
            <Statement>{d.fitness_note}</Statement>
            <SectionTitle>Vaccination History</SectionTitle>
            <VaccineTable rows={d.vaccinations} />
          </>
        )
      case 'TRAVEL_VACC':
        return (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10.5px', marginTop: '4px' }}>
              <tbody>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: '6px 8px', color: '#64748b', fontWeight: 600, width: '160px' }}>Travel Destination</td><td style={{ padding: '6px 8px', fontWeight: 600 }}>{d.destination || '—'}</td></tr>
                <tr style={{ borderBottom: '1px solid #f1f5f9' }}><td style={{ padding: '6px 8px', color: '#64748b', fontWeight: 600 }}>Mode of Travel</td><td style={{ padding: '6px 8px' }}>{d.mode_of_travel || '—'}</td></tr>
                <tr><td style={{ padding: '6px 8px', color: '#64748b', fontWeight: 600 }}>Date of Travel</td><td style={{ padding: '6px 8px' }}>{d.travel_date ? fmtDate(d.travel_date) : '—'}</td></tr>
              </tbody>
            </table>
            <Statement>{d.fitness_note}</Statement>
            <SectionTitle>Vaccination History</SectionTitle>
            <VaccineTable rows={d.vaccinations} />
          </>
        )
      case 'EUTHANASIA':
        return (
          <>
            <Statement>
              This is to certify that the animal described above was humanely euthanized on <strong>{fmtDate(d.euthanasia_date)}</strong>
              {d.method ? <> using <strong>{d.method}</strong></> : null}, in accordance with accepted veterinary practice and with the informed consent of the owner.
            </Statement>
            <InfoRow label="Reason" value={d.reason} />
            <InfoRow label="Witness" value={d.witness_name} />
          </>
        )
      case 'SURGICAL_RISK':
        return (
          <>
            <InfoRow label="Procedure" value={d.procedure_name} />
            <InfoRow label="Date" value={fmtDate(d.procedure_date)} />
            <InfoRow label="Risk Category" value={d.risk_grade} />
            {d.risk_notes && <Statement>{d.risk_notes}</Statement>}
            <Statement>The owner / client has been informed of the risks associated with this procedure and the anaesthesia involved, and has given informed consent to proceed.</Statement>
          </>
        )
      case 'STERILIZATION':
        return (
          <>
            <Statement>This is to certify that the animal described above underwent a sterilization procedure (<strong>{d.method}</strong>) on <strong>{fmtDate(d.procedure_date)}</strong>.</Statement>
            {d.post_op_notes && <InfoRow label="Post-Op Notes" value={d.post_op_notes} />}
          </>
        )
      case 'DEATH':
        return (
          <>
            <Statement>This is to certify that the animal described above died on <strong>{fmtDate(d.date_of_death)}</strong>.</Statement>
            <InfoRow label="Cause of Death" value={d.cause_of_death} />
          </>
        )
      case 'MICROCHIP':
        return (
          <Statement>
            This is to certify that a microchip bearing identification number <strong>{d.microchip_no}</strong> was implanted in the animal described above
            on <strong>{fmtDate(d.implant_date)}</strong>{d.site ? <> at the following site: <strong>{d.site}</strong></> : null}.
          </Statement>
        )
      case 'IDENTIFICATION':
        return (
          <>
            <Statement>This certificate identifies the animal described below, registered with {clinic?.clinic_name || 'this clinic'}.</Statement>
            {d.distinguishing_marks && <InfoRow label="Distinguishing Marks" value={d.distinguishing_marks} />}
          </>
        )
      case 'BOARDING':
        return (
          <>
            <Statement>
              This is to certify that the animal described above was boarded at {clinic?.clinic_name || 'this clinic'} from <strong>{fmtDate(d.check_in_date)}</strong> to{' '}
              <strong>{d.check_out_date ? fmtDate(d.check_out_date) : 'present'}</strong>.
            </Statement>
            {d.purpose && <InfoRow label="Purpose" value={d.purpose} />}
          </>
        )
      default:
        return <div style={{ fontSize: '11px', color: '#64748b' }}>No template available for this certificate type.</div>
    }
  }

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
            <div style={{ fontSize: '15px', fontWeight: 700 }}>{cert.cert_type_label || 'Certificate'}</div>
            <div style={{ fontSize: '9.5px', opacity: 0.8, marginTop: '2px' }}>Cert No: {cert.cert_no}</div>
            <div style={{ fontSize: '9.5px', opacity: 0.8 }}>Issued: {fmtDate(cert.issue_date)}</div>
            {cert.valid_until && <div style={{ fontSize: '9.5px', opacity: 0.8 }}>Valid Until: {fmtDate(cert.valid_until)}</div>}
          </div>
        </div>
      </div>

      <div style={{ padding: '4px 24px 28px' }}>

        {/* ── PATIENT IDENTIFICATION ───────────────────────── */}
        <SectionTitle>Patient Identification</SectionTitle>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 28px' }}>
          <div>
            <InfoRow label="Name" value={cert.pet_name || p.name} />
            <InfoRow label="Species" value={p.species_name} />
            <InfoRow label="Breed" value={p.breed_name} />
            <InfoRow label="Sex" value={p.gender} />
            <InfoRow label="Age" value={ageStr} />
          </div>
          <div>
            <InfoRow label="Colour" value={p.color} />
            <InfoRow label="Weight" value={p.weight_kg != null ? `${p.weight_kg} kg` : '—'} />
            <InfoRow label="Microchip No" value={s.microchip_no} />
            <InfoRow label="Owner" value={cert.owner_name} />
            <InfoRow label="Owner Phone" value={cert.owner_phone} />
          </div>
        </div>

        {/* ── CERTIFICATE BODY ─────────────────────────────── */}
        <SectionTitle>{cert.cert_type_label}</SectionTitle>
        {renderBody()}

        {cert.notes && (
          <>
            <SectionTitle>Additional Notes</SectionTitle>
            <Statement>{cert.notes}</Statement>
          </>
        )}

        {/* ── SIGNATURE BLOCK ──────────────────────────────── */}
        <div style={{ marginTop: '36px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '20px' }}>
          <div style={{ fontSize: '10.5px', color: '#64748b' }}>
            Date: {fmtDate(cert.issue_date)}
          </div>
          <div style={{ textAlign: 'center', minWidth: '220px' }}>
            <div style={{ borderTop: '1px solid #94a3b8', paddingTop: '6px' }}>
              <div style={{ fontSize: '11.5px', fontWeight: 700, color: '#0f172a' }}>{cert.doctor_name || 'Attending Veterinarian'}</div>
              {cert.doctor_qualification && <div style={{ fontSize: '9.5px', color: '#64748b' }}>{cert.doctor_qualification}</div>}
              {cert.doctor_reg_number && <div style={{ fontSize: '9.5px', color: '#64748b' }}>Reg No: {cert.doctor_reg_number}</div>}
              <div style={{ fontSize: '9px', color: '#94a3b8', marginTop: '2px' }}>Signature &amp; Clinic Seal</div>
            </div>
          </div>
        </div>

        {/* ── FOOTER ────────────────────────────────────────── */}
        <div style={{ marginTop: '24px', paddingTop: '10px', borderTop: '1px solid #e2e8f0', fontSize: '9px', color: '#94a3b8', textAlign: 'center' }}>
          This is a computer-generated certificate from {clinic?.clinic_name || 'the clinic'}. Generated on {printedOn}.
        </div>
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" style={{ background: 'rgba(10,15,30,0.75)' }}>
      {showOptions && (
        <div className="absolute inset-0 flex items-center justify-center z-[130]">
          <div className="bg-white rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-5 w-80">
            <h3 className="font-bold text-slate-800 text-lg">Share Certificate</h3>
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
            <Award size={17} className="text-primary-600" />
            <span className="font-semibold text-slate-700 text-sm">{cert.cert_type_label || 'Certificate'} Preview</span>
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
