import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReferralMemberRow } from "@/app/referral/overview";
import { formatMoney } from "@/lib/money";

export interface ReferralMemberTableProps {
  members: ReferralMemberRow[];
  /** Display rate per generation, e.g. `{ level: 1, rate: "10%" }`. */
  levels: { level: number; rate: string }[];
}

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeZone: "UTC",
});

/** `Program (PAKET)` when a tier is known, otherwise the program name alone. */
function programLabel(member: ReferralMemberRow): string {
  if (!member.programName) return "Belum gabung program";
  return member.programTierCode
    ? `${member.programName} (${member.programTierCode})`
    : member.programName;
}

/** The commission total, or an explicit note when the member produced none yet. */
function commissionLabel(member: ReferralMemberRow): string {
  if (!member.commissionCount) return "Belum ada komisi";
  return formatMoney(member.commissionTotal, member.currency);
}

function commissionHint(member: ReferralMemberRow): string {
  if (!member.commissionCount) return "0 baris komisi";
  return `${member.commissionCount} baris · menunggu ${formatMoney(
    member.commissionPending,
    member.currency,
  )}`;
}

/** Membership badge tone: only an ACTIVE membership reads as a positive state. */
function programTone(status: string | null): "default" | "gold" | "muted" | "danger" {
  switch (status) {
    case "ACTIVE":
      return "default";
    case "SUSPENDED":
      return "gold";
    case "CANCELLED":
      return "danger";
    default:
      return "muted";
  }
}

export function ReferralMemberTable({ members, levels }: ReferralMemberTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Tabel anggota jaringan</CardTitle>
        <CardDescription>
          Satu baris per anggota pada lima generasi: akun, generasi, tanggal gabung, program,
          status, dan komisi yang sudah dihasilkan untuk Anda. Generasi dihitung dari pohon
          rujukan, bukan dari nilai yang tersimpan.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {!members.length ? (
          <p role="status" className="text-sm text-white/60">
            Belum ada anggota jaringan. Bagikan kode rujukan Anda untuk mulai membangun jaringan
            lima generasi.
          </p>
        ) : null}

        {members.length ? (
          <>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[860px] border-collapse text-sm">
                <caption className="sr-only">
                  Daftar anggota jaringan rujukan lima generasi milik akun Anda
                </caption>
                <thead>
                  <tr className="border-b border-white/10 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">
                    <th scope="col" className="py-2 pr-3">Anggota</th>
                    <th scope="col" className="py-2 pr-3">Generasi</th>
                    <th scope="col" className="py-2 pr-3">Tarif</th>
                    <th scope="col" className="py-2 pr-3">Tanggal gabung</th>
                    <th scope="col" className="py-2 pr-3">Program</th>
                    <th scope="col" className="py-2 pr-3">Status</th>
                    <th scope="col" className="py-2 text-right">Komisi</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.userId} className="border-b border-white/5 last:border-b-0">
                      <th scope="row" className="py-3 pr-3 text-left font-medium text-white">
                        <span className="break-all">@{member.username}</span>
                      </th>
                      <td className="py-3 pr-3 text-white/70">Generasi {member.level}</td>
                      <td className="py-3 pr-3">
                        <RateCell level={member.level} levels={levels} />
                      </td>
                      <td className="py-3 pr-3 text-white/60">
                        <time dateTime={member.joinedAt.toISOString()}>
                          {dateFormatter.format(member.joinedAt)}
                        </time>
                      </td>
                      <td className="py-3 pr-3 text-white/70">
                        {programLabel(member)}
                        {member.programJoinAmount ? (
                          <span className="block text-xs text-white/40">
                            {formatMoney(member.programJoinAmount, member.currency)}
                          </span>
                        ) : null}
                      </td>
                      <td className="py-3 pr-3">
                        <Badge variant={programTone(member.programStatus)}>
                          {member.programStatusLabel}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        <span className="font-semibold text-white">{commissionLabel(member)}</span>
                        <span className="block text-xs text-white/40">
                          {commissionHint(member)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <ul className="space-y-2 lg:hidden" aria-label="Tabel anggota jaringan (tampilan seluler)">
              {members.map((member) => (
                <li key={member.userId}>
                  <details className="rounded-xl border border-white/10 bg-white/[0.03]">
                    <summary className="cursor-pointer p-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                      <span className="break-all font-semibold">@{member.username}</span>
                      <span className="ml-2 text-white/60">Generasi {member.level}</span>
                      <span className="mt-1 block text-xs text-white/50">
                        {commissionLabel(member)} · {member.programStatusLabel}
                      </span>
                    </summary>
                    <dl className="space-y-1 border-t border-white/10 p-3 text-xs">
                      <div className="flex justify-between gap-3">
                        <dt className="text-white/45">Tarif generasi</dt>
                        <dd>
                          <RateCell level={member.level} levels={levels} />
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-white/45">Tanggal gabung</dt>
                        <dd className="text-white/70">
                          <time dateTime={member.joinedAt.toISOString()}>
                            {dateFormatter.format(member.joinedAt)}
                          </time>
                        </dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-white/45">Program</dt>
                        <dd className="text-right text-white/70">{programLabel(member)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-white/45">Komisi</dt>
                        <dd className="text-right text-white/70">{commissionHint(member)}</dd>
                      </div>
                    </dl>
                  </details>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RateCell({ level, levels }: { level: number; levels: { level: number; rate: string }[] }) {
  const rate = levels.find((entry) => entry.level === level)?.rate ?? "—";
  return <span className="font-mono text-xs text-[var(--color-neon)]">{rate}</span>;
}
