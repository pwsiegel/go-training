// SGFMetadata encoding for KataGo human-SL nets (metaEncoderVersion 1).
//
// Ported from KataGo cpp/neuralnet/sgfmetadata.cpp (fillMetadataRow + getProfile
// + makeBasicRankProfile). Produces the 192-float metadata input row the human
// net's meta-encoder consumes. Only the rank_/preaz_ profiles are supported
// (what Play needs); other profiles throw.
//
// The encoder itself folds the index-86 mask and the 0.5 output scale into its
// exported weights, so this file just fills the raw row.

export const METADATA_INPUT_NUM_CHANNELS = 192;

const RANK_LEN_PER_PLA = 34;
const DATE_LEN = 32;
const SOURCE_KGS = 2;

// "9d"->1 ... "1d"->9, "1k"->10 ... "20k"->29 (0 is an unused sentinel).
function inverseRankFromString(s: string): number {
  const m = /^(\d+)([dk])$/.exec(s.trim().toLowerCase());
  if (!m) throw new Error(`Unrecognized rank "${s}"`);
  const n = Number.parseInt(m[1], 10);
  if (m[2] === 'd') {
    if (n < 1 || n > 9) throw new Error(`Rank out of range "${s}"`);
    return 10 - n; // 9d->1, 1d->9
  }
  if (n < 1 || n > 20) throw new Error(`Rank out of range "${s}"`);
  return 9 + n; // 1k->10, 20k->29
}

// Days since 1970-01-01 (UTC). Date.UTC is a pure calendar function (not "now").
function daysSinceEpoch(y: number, m: number, d: number): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

/** Build the 192-float metadata row for a humanSLProfile like "rank_9k" or
 * "rank_5d" (both players that rank) or "rank_<b>_<w>" (per-player). */
export function buildSGFMetadataV1(profile: string): Float32Array {
  const row = new Float32Array(METADATA_INPUT_NUM_CHANNELS);

  const trimmed = profile.trim();
  const preAZ = trimmed.startsWith('preaz_');
  if (!preAZ && !trimmed.startsWith('rank_')) {
    throw new Error(`Unsupported humanSLProfile "${profile}" (only rank_/preaz_)`);
  }

  const body = trimmed.slice(preAZ ? 'preaz_'.length : 'rank_'.length);
  const parts = body.split('_');
  const invPla = inverseRankFromString(parts[0]);
  const invOpp = inverseRankFromString(parts.length > 1 ? parts[1] : parts[0]);

  // makeBasicRankProfile: both players human, ratedness unknown, byo-yomi
  // 20min + 5x30s, KGS source, a fixed synthetic game date.
  row[0] = 1.0; // plaIsHuman
  row[1] = 1.0; // oppIsHuman
  // rows 2-5 (unranked / rank-unknown flags) stay 0.

  // Rank thermometers (cumulative one-hot).
  for (let i = 0; i < Math.min(invPla, RANK_LEN_PER_PLA); i++) row[6 + i] = 1.0;
  for (let i = 0; i < Math.min(invOpp, RANK_LEN_PER_PLA); i++) row[6 + RANK_LEN_PER_PLA + i] = 1.0;

  row[74] = 0.5; // gameRatednessIsUnknown
  row[79] = 1.0; // tcIsByoYomi

  // Time-control values (natural logs of the capped seconds/counts).
  const mainTime = 1200;
  const periodTime = 30;
  const byoYomiPeriods = 5;
  const canadianMoves = 0;
  row[82] = 0.4 * (Math.log(Math.min(mainTime, 3 * 86400) + 60.0) - 6.5);
  row[83] = 0.3 * (Math.log(Math.min(periodTime, 86400) + 1.0) - 3.0);
  row[84] = 0.5 * (Math.log(Math.min(byoYomiPeriods, 50) + 2.0) - 1.5);
  row[85] = 0.25 * (Math.log(Math.min(canadianMoves, 50) + 2.0) - 1.5);

  // row[86] (board area) is zeroed by the encoder's baked-in feature mask, so
  // its value is irrelevant here.

  // Date sinusoids for the synthetic game date.
  const days = preAZ ? daysSinceEpoch(2016, 9, 1) : daysSinceEpoch(2020, 3, 1);
  const factor = Math.pow(80000, 1.0 / 31.0);
  let period = 7.0;
  for (let i = 0; i < DATE_LEN; i++) {
    const n = days / period;
    row[87 + 2 * i] = Math.cos(n * 2 * Math.PI);
    row[87 + 2 * i + 1] = Math.sin(n * 2 * Math.PI);
    period *= factor;
  }

  row[151 + SOURCE_KGS] = 1.0; // source one-hot (KGS)

  return row;
}
