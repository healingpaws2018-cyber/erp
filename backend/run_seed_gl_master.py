"""
run_seed_gl_master.py — Seeds the system GL accounts (PURCH-MED, SALES-MED,
GST-*-PAY/IN, CASH, BANK-001, DEB-CTRL, CRED-CTRL, ADV-SUP, ADV-CUST) that
Purchase Bill / Sales Bill / GST posting code expects to already exist.

Why you need this: migrations/seed_gl_master.sql exists in the repo but
nothing ever runs it automatically — company creation only calls
init_sequences_for_db(), not this file. So a freshly created company DB has
NO system GL accounts at all, and the first Purchase Bill (or Sales Bill)
you post fails with "GL account 'PURCH-MED' not found" (or SALES-MED,
GST-CGST-PAY, etc. — same root cause, you just hadn't hit those yet).

This script is safe to run more than once (ON CONFLICT DO NOTHING on the
insert). It also explicitly sets is_active=TRUE and is_system=TRUE on these
rows, because a plain INSERT ... VALUES (without listing every column)
leaves is_active/is_system as NULL — and the Chart of Accounts screen
filters is_active = TRUE by default, so the accounts would exist but be
invisible in Ledger.jsx until this backfill runs.

Usage (run from the backend/ folder):
    python run_seed_gl_master.py
    python run_seed_gl_master.py --db tenant1_xyz_clinic
"""
import os
import sys
import argparse
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
load_dotenv()

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DEFAULT_DB_NAME = os.getenv("DB_NAME", "pet_erp")

parser = argparse.ArgumentParser()
parser.add_argument("--db", default=None, help="Company DB name to seed (defaults to DB_NAME in .env)")
args = parser.parse_args()

db_name = args.db or DEFAULT_DB_NAME
url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{db_name}"

print(f"=== Seeding system GL accounts into: {db_name} ===\n")

SEED_SQL = text("""
    INSERT INTO gl_master (gl_code, gl_name, group_name, sub_group, is_active, is_system, balance_type) VALUES
      ('CASH',          'Petty Cash',                 'Assets',      'Cash & Bank', TRUE, TRUE, 'DR'),
      ('BANK-001',      'Main Bank Account',           'Assets',      'Cash & Bank', TRUE, TRUE, 'DR'),
      ('DEB-CTRL',      'Debtors Control',             'Assets',      'Debtors',     TRUE, TRUE, 'DR'),
      ('CRED-CTRL',     'Creditors Control',           'Liabilities', 'Creditors',   TRUE, TRUE, 'CR'),
      ('GST-CGST-PAY',  'CGST Payable',                'Liabilities', 'GST Payable', TRUE, TRUE, 'CR'),
      ('GST-SGST-PAY',  'SGST Payable',                'Liabilities', 'GST Payable', TRUE, TRUE, 'CR'),
      ('GST-IGST-PAY',  'IGST Payable',                'Liabilities', 'GST Payable', TRUE, TRUE, 'CR'),
      ('GST-CGST-IN',   'CGST Input Credit',           'Assets',      'GST Input',   TRUE, TRUE, 'DR'),
      ('GST-SGST-IN',   'SGST Input Credit',           'Assets',      'GST Input',   TRUE, TRUE, 'DR'),
      ('GST-IGST-IN',   'IGST Input Credit',           'Assets',      'GST Input',   TRUE, TRUE, 'DR'),
      ('SALES-VET',     'Veterinary Services Income',  'Income',      'Sales',       TRUE, TRUE, 'CR'),
      ('SALES-MED',     'Medicine Sales Income',       'Income',      'Sales',       TRUE, TRUE, 'CR'),
      ('SALES-RET',     'Sales Returns',               'Income',      'Sales',       TRUE, TRUE, 'DR'),
      ('PURCH-MED',     'Medicine Purchases',          'Expense',     'Purchases',   TRUE, TRUE, 'DR'),
      ('PURCH-RET',     'Purchase Returns',            'Expense',     'Purchases',   TRUE, TRUE, 'CR'),
      ('ADV-SUP',       'Advance to Suppliers',        'Liabilities', 'Advance',     TRUE, TRUE, 'DR'),
      ('ADV-CUST',      'Advance from Customers',      'Liabilities', 'Advance',     TRUE, TRUE, 'CR')
    ON CONFLICT (gl_code) DO NOTHING;
""")

# Backfill in case some of these rows already exist from an earlier partial run
# (e.g. inserted via the original seed_gl_master.sql without is_active/is_system set).
BACKFILL_SQL = text("""
    UPDATE gl_master
    SET is_active = TRUE, is_system = TRUE
    WHERE gl_code IN (
        'CASH','BANK-001','DEB-CTRL','CRED-CTRL',
        'GST-CGST-PAY','GST-SGST-PAY','GST-IGST-PAY',
        'GST-CGST-IN','GST-SGST-IN','GST-IGST-IN',
        'SALES-VET','SALES-MED','SALES-RET',
        'PURCH-MED','PURCH-RET','ADV-SUP','ADV-CUST'
    ) AND (is_active IS DISTINCT FROM TRUE OR is_system IS DISTINCT FROM TRUE);
""")

try:
    engine = create_engine(url)
    with engine.begin() as conn:
        result = conn.execute(SEED_SQL)
        conn.execute(BACKFILL_SQL)
        rows = conn.execute(text(
            "SELECT gl_code, gl_name, group_name, is_active, is_system FROM gl_master "
            "WHERE gl_code IN ('CASH','BANK-001','DEB-CTRL','CRED-CTRL','GST-CGST-PAY','GST-SGST-PAY',"
            "'GST-IGST-PAY','GST-CGST-IN','GST-SGST-IN','GST-IGST-IN','SALES-VET','SALES-MED','SALES-RET',"
            "'PURCH-MED','PURCH-RET','ADV-SUP','ADV-CUST') ORDER BY gl_code"
        )).fetchall()
    print(f"✅ Done. System GL accounts now present in '{db_name}':\n")
    for r in rows:
        print(f"  {r.gl_code:<15} {r.gl_name:<30} {r.group_name:<12} active={r.is_active} system={r.is_system}")
    if len(rows) < 17:
        print(f"\n⚠️  Only found {len(rows)}/17 expected codes — something looked wrong, double-check gl_master.")
    else:
        print("\nAll 17 system accounts present. Retry the Purchase Bill now — PURCH-MED (and the GST")
        print("input-credit accounts it needs alongside it) will resolve. Sales Bills need SALES-MED/")
        print("SALES-VET/GST-*-PAY the same way, so this also prevents that error later.")
except Exception as e:
    print(f"❌ FAILED: {e}")
    sys.exit(1)
