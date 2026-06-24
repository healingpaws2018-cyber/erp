-- Migration: add is_active soft-delete flag to medicine_batches
-- Run this once against your database.

ALTER TABLE medicine_batches
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- All existing batches are considered active
UPDATE medicine_batches SET is_active = TRUE WHERE is_active IS NULL;
