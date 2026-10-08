import { REFERRAL_DEPTH } from "@/lib/config/referral";

export interface NetworkNode {
  id: string;
  username: string;
  level: number;
  children: NetworkNode[];
}

export interface NetworkEdge {
  referrerId: string;
  referredUser: { id: string; username: string };
}

export interface ReferralNetwork {
  root: NetworkNode;
  counts: number[];
  total: number;
  truncated: boolean;
}

/** Breadth-first, bounded traversal; never trusts the stored edge level. */
export async function loadReferralNetwork(
  rootUser: { id: string; username: string },
  fetchChildren: (parentIds: string[], take: number) => Promise<NetworkEdge[]>,
  maxNodes = 500,
): Promise<ReferralNetwork> {
  const root: NetworkNode = { ...rootUser, level: 0, children: [] };
  const nodes = new Map([[root.id, root]]);
  const counts = Array.from({ length: REFERRAL_DEPTH }, () => 0);
  let frontier = [root.id];
  let total = 0;
  let truncated = false;

  for (let level = 1; level <= REFERRAL_DEPTH && frontier.length; level += 1) {
    const remaining = maxNodes - total;
    const edges = await fetchChildren(frontier, remaining + 1);
    const next: string[] = [];
    for (const edge of edges) {
      const parent = nodes.get(edge.referrerId);
      if (!parent || parent.level !== level - 1 || nodes.has(edge.referredUser.id)) continue;
      if (total >= maxNodes) {
        truncated = true;
        break;
      }
      const child: NetworkNode = { ...edge.referredUser, level, children: [] };
      parent.children.push(child);
      nodes.set(child.id, child);
      next.push(child.id);
      counts[level - 1] = (counts[level - 1] ?? 0) + 1;
      total += 1;
    }
    if (truncated) break;
    frontier = next;
  }
  return { root, counts, total, truncated };
}
