import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { NetworkNode, ReferralNetwork } from "@/lib/referral-network";

function Branch({ node }: { node: NetworkNode }) {
  return (
    <li className="min-w-0 py-1">
      {node.children.length ? (
        <details open>
          <summary className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <span className="break-all font-semibold">@{node.username}</span>
            <span className="ml-2 text-white/60">
              {node.level === 0 ? "Kamu (pusat)" : `Generasi ${node.level}`} · {node.children.length} cabang
            </span>
          </summary>
          <ul className="ml-2 border-l border-white/20 pl-2 sm:ml-5 sm:pl-5">
            {node.children.map((child) => <Branch key={child.id} node={child} />)}
          </ul>
        </details>
      ) : (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
          <span className="break-all font-semibold">@{node.username}</span>
          <span className="ml-2 text-white/60">{node.level === 0 ? "Kamu (pusat)" : `Generasi ${node.level}`}</span>
        </div>
      )}
    </li>
  );
}

export function NetworkTree({ network, levels }: {
  network: ReferralNetwork;
  levels: { level: number; rate: string }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pohon jaringan rujukan</CardTitle>
        <CardDescription>
          Jaringan Anda hingga 5 generasi dari hubungan rujukan aktif di database.
          Klik cabang untuk membuka atau menutup. Tarif bukan jaminan pendapatan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Ringkasan per generasi">
          {levels.map(({ level, rate }) => (
            <li key={level} className="rounded-lg border border-white/10 p-3 text-sm">
              <p>Generasi {level} · <span className="text-[var(--color-neon)]">{rate}</span></p>
              <p className="text-white/60">{network.counts[level - 1] ?? 0} anggota</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-white/60">{network.total} anggota ditampilkan (tidak termasuk root).</p>
        {network.truncated ? (
          <p role="status" className="text-sm text-[var(--color-gold)]">
            Jaringan lebih besar dari batas tampilan 500 anggota. Jumlah di atas adalah bagian yang ditampilkan.
          </p>
        ) : null}
        {!network.total ? <p className="text-sm text-white/60">Belum ada rujukan. Bagikan kode Anda untuk mengembangkan jaringan.</p> : null}
        <ul aria-label="Pohon jaringan Anda" className="min-w-0"><Branch node={network.root} /></ul>
      </CardContent>
    </Card>
  );
}
