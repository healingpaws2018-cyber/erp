def post_stock_ledger(db, medicine_id, batch_id, txn_type, qty,
                       ref_type, ref_id, ref_number, created_by, notes=None):
    """
    Post one stock movement to stock_ledger.
    ALSO updates medicine.current_stock and medicine_batches.current_qty.
    
    Call this EVERY TIME stock moves — sale, purchase, return, adjustment.
    Never update stock_ledger or current_stock/current_qty directly.
    Always use this function.
    
    txn_type  qty_in  qty_out
    PURCHASE    qty      0       → stock goes up
    OPENING     qty      0       → opening stock
    SALE          0    qty       → stock goes down
    SALE_RETURN qty      0       → stock goes up
    PURCH_RETURN  0    qty       → stock goes down
    ADJUSTMENT+  qty     0       → manual correction up
    ADJUSTMENT-   0    qty       → manual correction down
    """
    from models.stage3 import StockLedger, Medicine, MedicineBatch
    from sqlalchemy import func as sqlfunc

    IN_TYPES  = {'PURCHASE', 'OPENING', 'SALE_RETURN', 'ADJUSTMENT+'}
    OUT_TYPES = {'SALE', 'PURCH_RETURN', 'ADJUSTMENT-'}

    qty_in  = qty if txn_type in IN_TYPES  else 0
    qty_out = qty if txn_type in OUT_TYPES else 0

    # 1. Write to stock_ledger
    entry = StockLedger(
        medicine_id=medicine_id,
        batch_id=batch_id,
        txn_date=sqlfunc.current_date(),
        txn_type=txn_type,
        qty=qty,
        qty_in=qty_in,
        qty_out=qty_out,
        ref_type=ref_type,
        ref_id=ref_id,
        ref_number=ref_number,
        notes=notes,
        created_by=created_by
    )
    db.add(entry)

    # 2. Update batch current_qty
    batch = db.query(MedicineBatch).filter_by(batch_id=batch_id).with_for_update().first()
    if not batch:
        raise ValueError(f"Batch ID {batch_id} not found.")

    batch.current_qty += qty_in
    batch.current_qty -= qty_out

    if batch.current_qty < 0:
        # We allow negative stock ONLY if the system setting allows it, but default is block
        raise ValueError(f"Insufficient stock in batch {batch.batch_no}. Available: {batch.current_qty + qty_out}")

    # 3. Update medicine.current_stock directly with the delta (arithmetic, not aggregate SUM).
    #    This is reliable regardless of flush/autoflush ordering — no intermediate SELECT needed.
    medicine = db.query(Medicine).filter_by(medicine_id=medicine_id).with_for_update().first()
    if medicine:
        medicine.current_stock = float(medicine.current_stock or 0) + float(qty_in) - float(qty_out)
        # Guard: never go below 0
        if medicine.current_stock < 0:
            medicine.current_stock = 0
