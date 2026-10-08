-- Bagian 3 lanjutan — hapus kunci unik lama pada komisi rujukan.
--
-- Kunci lama `UNIQUE(referralId, sourceUserId, level, sourceReference)` digantikan
-- sepenuhnya oleh `UNIQUE(sourceTransactionId, beneficiaryUserId)`, satu-satunya
-- kunci idempotensi yang dipakai mesin komisi.
--
-- Alasan kunci lama dibuang:
--   1. `sourceReference` hanyalah salinan teks dari `Transaction.reference`, bukan
--      identitas peristiwa. Menjadikannya bagian dari kunci berarti kebenaran data
--      keuangan bergantung pada string yang tidak unik secara global.
--   2. Mesin komisi menulis dengan `createMany({ skipDuplicates: true })`, yang
--      membatalkan baris pada pelanggaran kunci unik APA PUN. Selama kunci lama
--      masih ada, bentrokan yang tak terduga akan membuang komisi yang sah secara
--      diam-diam, bukan memunculkan kesalahan.
--   3. Kunci baru sudah menutup kasus yang sama: satu peristiwa sumber hanya boleh
--      membayar satu penerima satu kali.
--
-- Baris lama tidak berubah dan tetap utuh; hanya indeksnya yang dihapus.

DROP INDEX "ReferralCommission_referralId_sourceUserId_level_sourceRefe_key";
