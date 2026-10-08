import assert from "node:assert/strict";
import { test } from "node:test";
import { loadReferralNetwork, type NetworkEdge } from "../src/lib/referral-network";

const root = { id: "root", username: "root" };
const edge = (parent: string, id: string): NetworkEdge => ({
  referrerId: parent, referredUser: { id, username: id },
});
const loader = (edges: NetworkEdge[]) => async (parents: string[], take: number) =>
  edges.filter((item) => parents.includes(item.referrerId)).slice(0, take);

test("jaringan kosong mempertahankan pusat dan lima hitungan nol", async () => {
  const result = await loadReferralNetwork(root, loader([]));
  assert.deepEqual(result.counts, [0, 0, 0, 0, 0]);
  assert.equal(result.root.username, "root");
  assert.equal(result.total, 0);
  assert.equal(result.truncated, false);
});

test("induk bercabang dan generasi relatif dipertahankan; pengguna tak terkait dikecualikan", async () => {
  const result = await loadReferralNetwork(root, loader([
    edge("root", "a"), edge("root", "b"), edge("a", "c"), edge("b", "d"), edge("other", "private"),
  ]));
  assert.deepEqual(result.counts, [2, 2, 0, 0, 0]);
  assert.equal(result.root.children.at(0)?.children.at(0)?.username, "c");
  assert.equal(result.root.children.at(1)?.children.at(0)?.level, 2);
  assert.equal(result.total, 4);
  assert.ok(!JSON.stringify(result).includes("private"));
});

test("lima generasi disertakan, generasi keenam dikecualikan, maksimum lima kueri", async () => {
  let calls = 0;
  const edges = [edge("root", "1"), ...Array.from({ length: 5 }, (_, i) => edge(String(i + 1), String(i + 2)))];
  const result = await loadReferralNetwork(root, async (parents, take) => {
    calls += 1;
    return loader(edges)(parents, take);
  });
  assert.deepEqual(result.counts, [1, 1, 1, 1, 1]);
  assert.equal(result.total, 5);
  assert.equal(calls, 5);
});

test("siklus dan anak duplikat tidak dapat menggandakan pusat atau menggelembungkan hitungan", async () => {
  const result = await loadReferralNetwork(root, loader([
    edge("root", "a"), edge("root", "a"), edge("a", "root"),
  ]));
  assert.equal(result.total, 1);
});

test("jaringan lebar dibatasi dan ditandai tidak lengkap", async () => {
  const result = await loadReferralNetwork(root, loader(Array.from({ length: 501 }, (_, i) => edge("root", String(i)))));
  assert.equal(result.total, 500);
  assert.equal(result.truncated, true);
});

test("jaringan tepat penuh tanpa keturunan tambahan tidak ditandai tidak lengkap", async () => {
  const result = await loadReferralNetwork(root, loader([edge("root", "a")]), 1);
  assert.equal(result.total, 1);
  assert.equal(result.truncated, false);
});

test("keturunan melebihi kapasitas memicu penanda tidak lengkap", async () => {
  const result = await loadReferralNetwork(root, loader([edge("root", "a"), edge("a", "b")]), 1);
  assert.equal(result.total, 1);
  assert.equal(result.truncated, true);
});

test("galat database diteruskan, bukan menampilkan jaringan kosong palsu", async () => {
  await assert.rejects(loadReferralNetwork(root, async () => { throw new Error("database tidak tersedia"); }), /database tidak tersedia/);
});
