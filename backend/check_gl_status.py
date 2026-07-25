"""
check_gl_status.py — Diagnose why a supplier (or owner) shows 0 in the
General Ledger / Trial Balance / Debtor / Creditor Outstanding reports.

Usage (run from the backend/ folder, same place as check_db.py):
    python check_gl_status.py
    python check_gl_status.py "Supplier Name Or Partial Name"
    python check_gl_status.py "Supplier Name" --db tenant1_xyz_clinic

If you don't pass --db it uses DB_NAME from your .env (the default company
DB). If your login uses a different tenant DB, pass --db with that name —
this script will also print all company DB names it can find in the master
DB so you can pick the right one.
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
MASTER_DB_NAME = os.getenv("MASTER_DB_NAME", "pet_erp_master")

parser = argparse.ArgumentParser()
parser.add_argument("supplier", nargs="?", default=None, help="Supplier name (or partial) to inspect")
parser.add_argument("--db", default=None, help="Company DB name to check (defaults to DB_NAME in .env)")
args = parser.parse_args()

db_name = args.db or DEFAULT_DB_NAME
url = f"postgresql://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{db_name}"

print(f"=== Checking company DB: {db_name} ===\n")

try:
    engine = create_engine(url)
    conn = engine.connect()
except Exception as e:
    print(f"❌ Could not connect to '{db_name}': {e}")
    sys.exit(1)

# 1. Financial Years
print("--- financial_years ---")
rows = conn.execute(text(
    "SELECT fy_code, start_date, end_date, is_current, is_locked FROM financial_years ORDER BY fy_code"
)).fetchall()
if not rows:
    print("⚠️  NO ROWS in financial_years at all. This is almost certainly why every report is zero:")
    print("    every GL-posting function (_post_purchase_bill_to_gl, _post_sales_bill_to_gl, etc.)")
    print("    calls get_current_fy() first and silently skips posting if it returns None.")
else:
    current = None
    for r in rows:
        marker = " <-- CURRENT" if r.is_current else ""
        print(f"  {r.fy_code}  {r.start_date} to {r.end_date}  locked={r.is_locked}{marker}")
        if r.is_current:
            current = r.fy_code
    if current:
        print(f"\n  Current FY the backend will stamp on new postings: {current}")
        print(f"  -> Make sure the FY dropdown in Accounts Reports has THIS exact value selected.")
    else:
        print("\n⚠️  No row has is_current = TRUE. Same effect as having no rows: all new GL postings")
        print("    are silently skipped.")

# 2. GL postings by voucher type
print("\n--- gl_postings counts by voucher_type ---")
rows = conn.execute(text(
    "SELECT voucher_type, count(*), min(posting_date), max(posting_date) "
    "FROM gl_postings GROUP BY voucher_type ORDER BY voucher_type"
)).fetchall()
if not rows:
    print("⚠️  gl_postings table is completely EMPTY. Nothing has ever posted to the GL in this DB.")
else:
    for r in rows:
        print(f"  {r[0]:<20} count={r[1]:<6} dates {r[2]} -> {r[3]}")
    types = [r[0] for r in rows]
    if "PurchaseBill" not in types:
        print("\n⚠️  No 'PurchaseBill' postings exist at all — every Purchase Bill in this DB was")
        print("    either created before the GL-posting fix went live, or posted with no current FY set.")

# 3. Purchase bills vs their postings
print("\n--- purchase_bills: fy_code stamped vs postings present ---")
rows = conn.execute(text(
    "SELECT pb.bill_id, pb.bill_no, pb.bill_date, pb.fy_code, pb.net_amount, s.supplier_name, "
    "s.gl_account_id, "
    "(SELECT count(*) FROM gl_postings gp WHERE gp.voucher_type='PurchaseBill' AND gp.voucher_ref_id=pb.bill_id) as posting_count "
    "FROM purchase_bills pb LEFT JOIN suppliers s ON s.supplier_id = pb.supplier_id "
    "ORDER BY pb.bill_date DESC LIMIT 30"
)).fetchall()
if not rows:
    print("  (no purchase_bills rows found)")
else:
    for r in rows:
        flag = "OK" if r.posting_count > 0 else "NOT POSTED"
        gl_flag = "" if r.gl_account_id else "  [supplier has NO gl_account_id]"
        print(f"  bill {r.bill_no:<12} {r.bill_date}  fy_code={str(r.fy_code):<10} supplier={r.supplier_name!r:<25} "
              f"postings={r.posting_count}  [{flag}]{gl_flag}")

# 4. Supplier-specific drill-down
if args.supplier:
    print(f"\n--- suppliers matching '{args.supplier}' ---")
    rows = conn.execute(text(
        "SELECT supplier_id, supplier_name, gl_account_id FROM suppliers WHERE supplier_name ILIKE :p"
    ), {"p": f"%{args.supplier}%"}).fetchall()
    if not rows:
        print("  No matching supplier found.")
    for r in rows:
        print(f"  supplier_id={r.supplier_id}  name={r.supplier_name!r}  gl_account_id={r.gl_account_id}")
        if not r.gl_account_id:
            print("    ⚠️  This supplier has no gl_account_id — a Creditor GL account has never been")
            print("       created for them (happens automatically on their first successfully-posted bill).")
            continue
        pg = conn.execute(text(
            "SELECT fy_code, count(*), sum(dr_amount), sum(cr_amount) FROM gl_postings "
            "WHERE gl_id = :gid GROUP BY fy_code"
        ), {"gid": r.gl_account_id}).fetchall()
        if not pg:
            print(f"    ⚠️  No gl_postings rows at all for gl_id={r.gl_account_id}.")
        for p in pg:
            print(f"    fy_code={p[0]}  postings={p[1]}  total_dr={p[2]}  total_cr={p[3]}")
        pb = conn.execute(text(
            "SELECT bill_no, bill_date, fy_code, net_amount FROM purchase_bills WHERE supplier_id = :sid ORDER BY bill_date"
        ), {"sid": r.supplier_id}).fetchall()
        print(f"    purchase_bills for this supplier ({len(pb)}):")
        for b in pb:
            print(f"      {b.bill_no}  {b.bill_date}  fy_code={b.fy_code}  net_amount={b.net_amount}")

conn.close()

print("\n=== What to do next ===")
print("1. If financial_years has no is_current=TRUE row: someone needs to create one (currently only")
print("   happens automatically when a Company is first created, or via the EOY rollover endpoint —")
print("   there is no admin screen for it yet). Ask your dev to insert one directly or expose a")
print("   small setup endpoint.")
print("2. If bills show postings=0 / 'NOT POSTED' above: those bills were created before GL-posting")
print("   was wired up for Purchase Bills, so nothing was retroactively posted for them. Opening each")
print("   one in Purchases and hitting Save (even with no changes) re-runs the posting logic — as long")
print("   as a current FY exists at that point, it will post then.")
print("3. If bills ARE posted but the report still shows 0: the fy_code stamped on the postings (shown")
print("   above) doesn't match the FY you selected in the Accounts Reports screen. Select the matching")
print("   FY in the dropdown.")
