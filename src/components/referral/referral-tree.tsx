import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { NetworkNode, ReferralNetwork } from "@/lib/referral-network";

export interface ReferralTreeProps {
  network: ReferralNetwork;
  /** Display rate per generation, e.g. `{ level: 1, rate: "10%" }`. */
  levels: { level: number; rate: string }[];
}

function generationLabel(node: NetworkNode): string {
  return node.level === 0 ? "Anda (pusat)" : `Generasi ${node.level}`;
}

function childLabel(node: NetworkNode): string {
  if (!node.children.length) return "Tanpa rujukan langsung";
  return `${node.children.length} rujukan langsung`;
}

function NodeCard({ node }: { node: NetworkNode }) {
  return (
    <div className="w-40 shrink-0 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-center sm:w-44">
      <p className="break-all text-sm font-semibold text-white">@{node.username}</p>
      <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-neon)]">
        {generationLabel(node)}
      </p>
      <p className="mt-0.5 text-[11px] text-white/40">{childLabel(node)}</p>
    </div>
  );
}

/** Desktop layout: horizontal, scrollable five-generation tree. */
function DesktopNode({ node }: { node: NetworkNode }) {
  return (
    <div className="flex flex-col items-center">
      <NodeCard node={node} />
      {node.children.length ? (
        <ul className="flex flex-row items-start gap-4 border-t border-white/10 pt-4">
          {node.children.map((child) => (
            <li key={child.id} className="flex flex-col items-center">
              <span aria-hidden className="h-4 w-px bg-white/15" />
              <DesktopNode node={child} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Mobile layout: collapsed branches that expand on tap. */
function MobileBranch({ node }: { node: NetworkNode }) {
  if (!node.children.length) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm">
        <span className="break-all font-semibold">@{node.username}</span>
        <span className="ml-2 text-white/60">{generationLabel(node)}</span>
      </div>
    );
  }

  return (
    <details open={node.level <= 1}>
      <summary className="cursor-pointer rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        <span className="break-all font-semibold">@{node.username}</span>
        <span className="ml-2 text-white/60">
          {generationLabel(node)} · {childLabel(node)}
        </span>
      </summary>
      <ul className="ml-2 border-l border-white/20 pl-2 sm:ml-5 sm:pl-5">
        {node.children.map((child) => (
          <li key={child.id} className="py-1">
            <MobileBranch node={child} />
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ReferralTree({ network, levels }: ReferralTreeProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Pohon jaringan lima generasi</CardTitle>
        <CardDescription>
          Jaringan Anda dihitung ulang dari hubungan rujukan aktif di database, bukan dari tingkat
          yang tersimpan. Pada layar lebar pohon ditampilkan mendatar; pada layar kecil setiap
          cabang dapat dibuka dan ditutup.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label="Ringkasan per generasi">
          {levels.map(({ level, rate }) => (
            <li key={level} className="rounded-lg border border-white/10 p-3 text-sm">
              <p>
                Generasi {level} · <span className="text-[var(--color-neon)]">{rate}</span>
              </p>
              <p className="text-white/60">{network.counts[level - 1] ?? 0} anggota</p>
            </li>
          ))}
        </ul>

        <p className="text-sm text-white/60">
          {network.total} anggota ditampilkan (tidak termasuk akun Anda).
        </p>

        {network.truncated ? (
          <p role="status" className="text-sm text-[var(--color-gold)]">
            Jaringan lebih besar dari batas tampilan 500 anggota. Angka di atas hanya mencakup
            bagian yang ditampilkan.
          </p>
        ) : null}

        {!network.total ? (
          <p role="status" className="text-sm text-white/60">
            Belum ada rujukan. Bagikan kode Anda untuk mulai membangun jaringan.
          </p>
        ) : null}

        <div className="hidden overflow-x-auto pb-2 lg:block">
          <ul aria-label="Pohon jaringan (tampilan desktop)" className="min-w-max">
            <li className="flex justify-center">
              <DesktopNode node={network.root} />
            </li>
          </ul>
        </div>

        <div className="lg:hidden">
          <ul aria-label="Pohon jaringan (tampilan seluler)">
            <li>
              <MobileBranch node={network.root} />
            </li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

