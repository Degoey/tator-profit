import assert from "node:assert/strict";
import { test } from "node:test";

import { Prisma } from "@prisma/client";

import {
  WEEK_MS,
  calculateWeeklyReward,
  cycleProgress,
  cycleRewardTarget,
  rewardDateFor,
} from "../src/lib/services/reward-calculation";

const dec = (value: string) => new Prisma.Decimal(value);

test("target imbalan mingguan mengikuti tarif 10% yang dikonfigurasi", () => {
  const expected: [string, string][] = [
    ["10", "1.00"],
    ["25", "2.50"],
    ["50", "5.00"],
    ["100", "10.00"],
    ["500", "50.00"],
    ["1000", "100.00"],
    ["3000", "300.00"],
    ["5000", "500.00"],
    ["10000", "1000.00"],
  ];

  for (const [amount, target] of expected) {
    const result = calculateWeeklyReward({
      amount: dec(amount),
      weeklyRate: dec("0.1000"),
      eligibility: true,
      programStatus: "ACTIVE",
    });
    assert.equal(result.target.toFixed(2), target, `${amount} x 10%`);
    assert.equal(result.eligible, true);
  }
});

test("keanggotaan yang tidak memenuhi syarat menghasilkan target tetapi tanpa imbalan", () => {
  const ineligible = calculateWeeklyReward({
    amount: dec("100"),
    weeklyRate: dec("0.1000"),
    eligibility: false,
    programStatus: "ACTIVE",
  });
  assert.equal(ineligible.eligible, false);
  assert.equal(ineligible.target.toFixed(2), "10.00");
  assert.match(ineligible.reason, /kualifikasi/i);

  const pending = calculateWeeklyReward({
    amount: dec("100"),
    weeklyRate: dec("0.1000"),
    eligibility: true,
    programStatus: "PENDING",
  });
  assert.equal(pending.eligible, false);
  assert.match(pending.reason, /PENDING/);
});

test("masukan tidak valid ditolak, bukan dibulatkan secara diam-diam", () => {
  assert.throws(
    () =>
      calculateWeeklyReward({
        amount: dec("0"),
        weeklyRate: dec("0.1"),
        eligibility: true,
        programStatus: "ACTIVE",
      }),
    RangeError,
  );
  assert.throws(
    () =>
      calculateWeeklyReward({
        amount: dec("10.005"),
        weeklyRate: dec("0.1"),
        eligibility: true,
        programStatus: "ACTIVE",
      }),
    RangeError,
  );
  assert.throws(
    () =>
      calculateWeeklyReward({
        amount: dec("10"),
        weeklyRate: dec("1.5"),
        eligibility: true,
        programStatus: "ACTIVE",
      }),
    RangeError,
  );
});

test("target siklus tidak pernah melebihi tarif siklus maksimum yang dikonfigurasi", () => {
  const weekly = dec("10.00");
  assert.equal(cycleRewardTarget(weekly, 4, dec("0.4000"), dec("100")).toFixed(2), "40.00");
  // A misconfigured rate (50% per week) is capped by the 40% cycle maximum.
  assert.equal(cycleRewardTarget(dec("50.00"), 4, dec("0.4000"), dec("100")).toFixed(2), "40.00");
});

test("periode imbalan berjarak tujuh hari dan dibatasi oleh siklus", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  assert.equal(rewardDateFor(start, 1, 4).toISOString(), "2026-01-08T00:00:00.000Z");
  assert.equal(rewardDateFor(start, 4, 4).toISOString(), "2026-01-29T00:00:00.000Z");
  assert.throws(() => rewardDateFor(start, 5, 4), RangeError);
  assert.throws(() => rewardDateFor(start, 0, 4), RangeError);
});

test("progres siklus melaporkan minggu saat ini dan dibatasi di akhir siklus", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");

  const beforeStart = cycleProgress(start, 4, new Date(start.getTime() - WEEK_MS));
  assert.equal(beforeStart.currentWeek, 1);
  assert.equal(beforeStart.elapsedWeeks, 0);

  const weekThree = cycleProgress(start, 4, new Date(start.getTime() + 2 * WEEK_MS + 1000));
  assert.equal(weekThree.currentWeek, 3);
  assert.equal(weekThree.percentComplete, 50);

  const finished = cycleProgress(start, 4, new Date(start.getTime() + 30 * WEEK_MS));
  assert.equal(finished.currentWeek, 4);
  assert.equal(finished.elapsedWeeks, 4);
  assert.equal(finished.percentComplete, 100);

  const notStarted = cycleProgress(null, 4);
  assert.equal(notStarted.currentWeek, 0);
});
