-- V1.3 Fase 2 (§8 PRD V1.3): sisip UI/UX Design sebagai stage baru,
-- posisi setelah Architecture, sebelum Estimation.
-- ALTER TYPE ADD VALUE tidak bisa dipakai dalam transaksi yang sama dengan
-- statement yang membaca value tersebut — migration ini sengaja HANYA berisi
-- ini, tidak ada INSERT/UPDATE yang pakai 'UIUX' di file yang sama.

ALTER TYPE "StageKey" ADD VALUE 'UIUX' BEFORE 'ESTIMATION';
