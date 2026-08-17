/**
 * Numbers the car doesn't actually report.
 *
 * Horsepower, torque and gear are the three things everyone wants off an OBD
 * dongle, and the honest position on each is different:
 *
 *   torque  — a real PID, but an optional one. 0x62 gives a PERCENTAGE and 0x63
 *             gives the reference figure it is a percentage OF. One without the
 *             other is meaningless, and plenty of cars expose neither.
 *   power   — not a PID on any car. It is arithmetic on torque and RPM.
 *   gear    — not a PID either. It is inferred from how engine speed relates to
 *             road speed, which is a fixed ratio per gear for any given car.
 *
 * Everything here is pure so it can be tested without a vehicle, and every
 * function returns null rather than a plausible-looking guess when the inputs
 * aren't there. A confidently wrong horsepower figure is worse than a blank.
 */

/**
 * Engine torque in Nm.
 *
 * @param pct  PID 0x62 — actual engine torque, as a percentage of reference
 * @param ref  PID 0x63 — reference torque in Nm
 *
 * The percentage is signed: on the overrun (engine braking, foot off) the ECU
 * reports negative torque, and that is real, not an error to clamp away.
 */
export function torqueNm(pct, ref){
  if (typeof pct !== 'number' || typeof ref !== 'number') return null;
  if (!Number.isFinite(pct) || !Number.isFinite(ref) || ref <= 0) return null;
  return (pct / 100) * ref;
}

/**
 * Horsepower from torque and engine speed.
 *
 * P(kW) = τ(Nm) × ω(rad/s), and with rpm→rad/s plus kW→hp the constant folds
 * to 7127: hp = τ × rpm / 7127.
 *
 * This is crank horsepower — what the engine makes, not what reaches the road.
 * Wheel horsepower is 12–15% lower, and the gap is drivetrain loss no dongle
 * can see, so don't relabel this later.
 */
export function horsepower(nm, rpm){
  if (typeof nm !== 'number' || typeof rpm !== 'number') return null;
  if (!Number.isFinite(nm) || !Number.isFinite(rpm) || rpm <= 0) return null;
  return (nm * rpm) / 7127;
}

/**
 * Decode PID 0xA4 "Transmission Actual Gear" — the car's OWN gear, not a guess.
 *
 * An earlier version inferred gear from the rpm-to-speed ratio, which was wrong
 * often enough to be useless: torque-converter slip, sample timing and shift
 * transitions all smear that ratio. 0xA4 (added to J1979 in 2020) asks the
 * transmission directly. Not every car answers it — hence the support bit — but
 * when it does, it is ground truth, and a blank beats a bad guess.
 *
 * @param bytes  the data bytes after the `41 A4` marker: [A, B, C, D]
 *
 * Byte layout, by confidence:
 *   A — status bits. Bit 0 (0x01) = gear number supported, bit 1 (0x02) = ratio
 *       supported. This gate is well documented and is what stops us inventing a
 *       gear on a car that doesn't report one.
 *   C,D — gear RATIO = (256·C + D) × 0.001. Well documented and reliable.
 *   B — the gear NUMBER. This byte's encoding is NOT authoritatively documented
 *       and implementations differ, so it's decoded best-effort and flagged for
 *       confirmation against a real drive before it's trusted.
 */
export function decodeGearA4(bytes){
  if (!Array.isArray(bytes) || bytes.length < 4) {
    return { supported: false, gear: null, ratio: null };
  }
  const [a, b, c, d] = bytes;
  const gearSupported  = (a & 0x01) !== 0;
  const ratioSupported = (a & 0x02) !== 0;

  // A gear number is a small integer (0=neutral, up to ~8). A byte holding a
  // value above 15 is therefore not a raw gear — it's nibble-packed, so take
  // the high nibble. This spans both conventions seen in the wild without
  // needing to know which the car uses; a real reading confirms which it is.
  let gear = null;
  if (gearSupported) gear = b > 15 ? (b >> 4) : b;

  const ratio = ratioSupported ? ((c * 256 + d) * 0.001) : null;

  return { supported: gearSupported || ratioSupported, gear, ratio };
}

/**
 * Everything derivable from one poll, in one call.
 *
 * Torque and horsepower only — gear now comes straight from PID 0xA4 via
 * decodeGearA4(), not from anything computed here.
 */
export function derive({ rpm, torquePct, torqueRef } = {}){
  const nm = torqueNm(torquePct, torqueRef);
  return {
    torqueNm:   nm,
    horsepower: horsepower(nm, rpm),
  };
}
