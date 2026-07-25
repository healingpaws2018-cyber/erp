"""
utils/doc_sequence.py — Python wrapper for the PostgreSQL get_next_doc_no() function.

Replaces the fragile "query last row + increment" pattern used in Phase 1.
Uses a DB-level row lock (FOR UPDATE) so concurrent requests can never get the same number.

Usage:
    from utils.doc_sequence import next_doc_no
    appt_no = next_doc_no(db, "APT")   → "APT25260001"
    bill_no = next_doc_no(db, "BIL")   → "BIL25260001"

To roll back bill numbers (admin panel):
    UPDATE doc_sequences SET current_no = 10 WHERE doc_type = 'BIL';
    → Next bill will be BIL2526011
"""
from sqlalchemy.orm import Session
from sqlalchemy import text


def get_next_doc_no(db: Session, doc_type: str) -> str:
    """
    Atomically get the next formatted document number for doc_type.
    Calls the get_next_doc_no() PostgreSQL function which uses FOR UPDATE lock.
    Raises ValueError if doc_type is not in doc_sequences table.
    """
    result = db.execute(
        text("SELECT get_next_doc_no(:doc_type)"),
        {"doc_type": doc_type}
    )
    row = result.fetchone()
    if row is None or row[0] == 'ERR_BAD_TYPE':
        raise ValueError(f"Unknown doc_type: {doc_type}")
    return row[0]


def format_fy(fy_code: str) -> str:
    """Format YYYY-YY (e.g. 2025-26) to YY/YY (e.g. 2526) to fit in fin_year column."""
    if not fy_code:
        return ""
    fy = fy_code.replace("-", "")
    return fy[2:] if len(fy) > 4 else fy



def get_sequence_info(db: Session, doc_type: str) -> dict:
    """Get current sequence state for a doc_type (for admin panel)."""
    result = db.execute(
        text("SELECT doc_type, prefix, current_no, use_fin_year, fin_year, last_no_issued FROM doc_sequences WHERE doc_type = :dt"),
        {"dt": doc_type}
    )
    row = result.fetchone()
    if not row:
        return {}
    return {
        "doc_type":      row[0],
        "prefix":        row[1],
        "current_no":    row[2],
        "use_fin_year":  row[3],
        "fin_year":      row[4],
        "last_no_issued": row[5],
    }


def list_sequences(db: Session) -> list:
    """List all document sequences (for admin panel)."""
    result = db.execute(
        text("SELECT doc_type, prefix, current_no, use_fin_year, fin_year, last_no_issued, updated_at FROM doc_sequences ORDER BY doc_type")
    )
    return [
        {
            "doc_type":      r[0],
            "prefix":        r[1],
            "current_no":    r[2],
            "use_fin_year":  r[3],
            "fin_year":      r[4],
            "last_no_issued": r[5],
            "updated_at":    str(r[6]) if r[6] else None,
        }
        for r in result.fetchall()
    ]


def set_sequence(db: Session, doc_type: str, current_no: int) -> bool:
    """
    Admin override: manually set the sequence counter.
    Use to roll back bill numbers or fix gaps.
    WARNING: setting current_no lower than existing records will cause duplicate key errors.
    """
    result = db.execute(
        text("UPDATE doc_sequences SET current_no = :no, updated_at = NOW() WHERE doc_type = :dt"),
        {"no": current_no, "dt": doc_type}
    )
    db.commit()
    return result.rowcount > 0


def init_sequences_for_db(company_engine):
    """
    Guarantees that a company database has the doc_sequences table,
    all necessary sequence seeds, and the get_next_doc_no() PL/pgSQL function.
    Uses AUTOCOMMIT isolation level to guarantee immediate, irrevocable DDL/DML persistence.
    Auto-migrates any missing columns for older databases.
    """
    with company_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        # 1. Create Table
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS doc_sequences (
                doc_type        TEXT PRIMARY KEY,
                prefix          TEXT NOT NULL,
                current_no      INTEGER DEFAULT 0,
                pad_length      SMALLINT DEFAULT 4,
                use_fin_year    BOOLEAN DEFAULT false,
                fin_year        TEXT DEFAULT '',
                reset_on_year   BOOLEAN DEFAULT true,
                last_no_issued  TEXT,
                updated_at      TIMESTAMP DEFAULT NOW()
            );
        """))

        # 1b. Auto-migrate missing columns for older databases
        columns_to_check = [
            ("pad_length", "SMALLINT DEFAULT 4"),
            ("fin_year", "TEXT DEFAULT ''"),
            ("reset_on_year", "BOOLEAN DEFAULT true"),
            ("last_no_issued", "TEXT"),
        ]
        for col_name, col_type in columns_to_check:
            try:
                conn.execute(text(f"ALTER TABLE doc_sequences ADD COLUMN {col_name} {col_type}"))
            except Exception:
                pass  # Column already exists

        # 2. Seed all required document types
        seeds = [
            ('APT', 'APT', 0, 4, True, '2627', True),   # Appointments: APT26270001
            ('CON', 'CON', 0, 4, True, '2627', True),   # Consultations: CON26270001
            ('RX',  'RX',  0, 4, True, '2627', True),   # Prescriptions: RX26270001
            ('VAC', 'VAC', 0, 4, True, '2627', True),   # Vaccine Master: VAC26270001
            ('PUR', 'PUR', 0, 4, True, '2627', True),   # Purchase Bills: PUR26270001
            ('PHM', 'PHM', 0, 4, True, '2627', True),   # Pharmacy Bills: PHM26270001
            ('BIL', 'BIL', 0, 4, True, '2627', True),   # Sales Bills: BIL26270001
            ('REC', 'REC', 0, 4, True, '2627', True),   # Receipt Vouchers: REC26270001
            ('VCH', 'VCH', 0, 4, True, '2627', True),   # Vouchers: VCH26270001
            ('SUP', 'SUP', 0, 4, False, '', False),      # Suppliers: SUP0001
            ('MED', 'MED', 0, 4, False, '', False),      # Medicine (legacy): MED0001
            ('OWN', 'OWN', 0, 4, False, '', False),      # Pet Owners: OWN0001
            ('PET', 'PET', 0, 4, False, '', False),      # Pets: PET0001
            ('DOC', 'DOC', 0, 4, False, '', False),      # Doctors (legacy): DOC0001
            ('STA', 'STA', 0, 4, False, '', False),      # Staff (legacy): STA0001
            ('AGE', 'AGE', 0, 4, False, '', False),      # Agents (legacy): AGE0001
            ('SRV', 'SRV', 0, 4, False, '', False),      # Services: SRV0001
            ('SB',  'SB',  0, 4, True, '2627', True),   # Sales Bills alt: SB26270001
            ('PB',  'PB',  0, 4, True, '2627', True),   # Purchase Bills alt: PB26270001
            ('OWNGL',  'OWNGL',  0, 4, False, '', False), # Owner GL accounts
            ('SUPGL',  'SUPGL',  0, 4, False, '', False), # Supplier GL accounts
            ('DOCGL',  'DOCGL',  0, 4, False, '', False), # Doctor GL accounts
            ('STAGL',  'STAGL',  0, 4, False, '', False), # Staff GL accounts
            ('AGEGL',  'AGEGL',  0, 4, False, '', False), # Agent GL accounts
            # Route-specific document type seeds
            ('DR',        'DR',  0, 4, False, '', False), # Doctors route: DR0001
            ('ST',        'ST',  0, 4, False, '', False), # Staff route: ST0001
            ('MEDICINE',  'MED', 0, 4, False, '', False), # Medicines route: MED0001
            ('PROCEDURE', 'PRC', 0, 4, False, '', False), # Procedures: PRC0001
            ('AGT',       'AGT', 0, 4, False, '', False), # Agents route: AGT0001
            ('VRC', 'VRC', 0, 4, True, '2627', True),   # Vaccination Records: VRC26270001
            ('VC',  'VC',  0, 4, False, '', False),      # Vaccination Code: VC0001
            ('AD',  'AD-', 0, 5, True,  '2627', True),  # Advance Payments: AD-262700001
            ('BA',  'BA-', 0, 5, True,  '2627', True),  # Bank Arrivals: BA-262700001
            ('RV',  'RV-', 0, 5, True,  '2627', True),  # Receipt Vouchers: RV-262700001
            ('PV',  'PV-', 0, 5, True,  '2627', True),  # Payment Vouchers: PV-262700001
            ('JV',  'JV-', 0, 5, True,  '2627', True),  # Journal Vouchers: JV-262700001
            ('DN',  'DN-', 0, 5, True,  '2627', True),  # Debit Notes: DN-262700001
            ('CN',  'CN-', 0, 5, True,  '2627', True),  # Credit Notes: CN-262700001
            ('CERT', 'CRT', 0, 4, True, '2627', True),  # Pet Certificates: CRT26270001
        ]


        for dt, pre, curr, pad, use_fy, fy, reset in seeds:
            conn.execute(text("""
                INSERT INTO doc_sequences (doc_type, prefix, current_no, pad_length, use_fin_year, fin_year, reset_on_year)
                VALUES (:dt, :pre, :curr, :pad, :use_fy, :fy, :reset)
                ON CONFLICT (doc_type) DO NOTHING;
            """), {"dt": dt, "pre": pre, "curr": curr, "pad": pad, "use_fy": use_fy, "fy": fy, "reset": reset})

        # 3. Create PL/pgSQL Function
        conn.execute(text("""
            CREATE OR REPLACE FUNCTION get_next_doc_no(p_doc_type TEXT)
            RETURNS TEXT AS $$
            DECLARE
                v_row       doc_sequences%ROWTYPE;
                v_next_no   INTEGER;
                v_formatted TEXT;
            BEGIN
                SELECT * INTO v_row
                FROM doc_sequences
                WHERE doc_type = p_doc_type
                FOR UPDATE;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Unknown doc_type: %', p_doc_type;
                END IF;

                v_next_no := v_row.current_no + 1;

                IF v_row.use_fin_year AND v_row.fin_year != '' THEN
                    v_formatted := v_row.prefix || v_row.fin_year || LPAD(v_next_no::TEXT, v_row.pad_length, '0');
                ELSE
                    v_formatted := v_row.prefix || LPAD(v_next_no::TEXT, v_row.pad_length, '0');
                END IF;

                UPDATE doc_sequences
                SET current_no     = v_next_no,
                    last_no_issued = v_formatted,
                    updated_at     = NOW()
                WHERE doc_type = p_doc_type;

                RETURN v_formatted;
            END;
            $$ LANGUAGE plpgsql;
        """))

        # 4. Auto-seed default Units if the table is empty
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS units (
                unit_id SERIAL PRIMARY KEY,
                unit_name VARCHAR(50) UNIQUE NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT NOW()
            );
        """))
        default_units = ['Nos', 'Box', 'Strips', 'Btl', 'Vial', 'Pkt', 'Tube', 'mg', 'ml', 'kg', 'g', 'L']
        for u in default_units:
            conn.execute(text("""
                INSERT INTO units (unit_name, is_active)
                VALUES (:u, true)
                ON CONFLICT (unit_name) DO NOTHING;
            """), {"u": u})

