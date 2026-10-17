/**
 * Plain-English meanings for the generic (SAE J2012) trouble codes drivers
 * actually see. Not exhaustive — a code missing here still gets an honest
 * system-level explanation from systemFor(), never a blank.
 *
 * severity:
 *   urgent — can damage the engine or leave you stranded; stop driving soon
 *   soon   — book it in within a week or two
 *   watch  — not harmful to drive on; fix at your next service
 */

const C = (title, what, severity = 'soon') => ({ title, what, severity });

const MISFIRE_WHAT = 'The engine is skipping combustion in a cylinder — usually a worn spark plug or ignition coil. If the check-engine light flashes, ease off and get it seen: unburnt fuel can overheat the catalytic converter.';

export const DTC = {
  // ── Fuel & air ────────────────────────────────────────────────────────────
  P0100: C('Airflow sensor (MAF) circuit', 'The sensor that measures air into the engine isn’t reading right. Often just a dirty sensor — cleaning it is cheap.'),
  P0101: C('Airflow sensor (MAF) out of range', 'Air-flow readings don’t add up — commonly a dirty MAF sensor or an air leak after it. Can cause rough running and poor mileage.'),
  P0102: C('Airflow sensor (MAF) reading low', 'The air-flow sensor signal is too low — check its plug and wiring, or clean the sensor.'),
  P0103: C('Airflow sensor (MAF) reading high', 'The air-flow sensor signal is too high — usually wiring or a failing sensor.'),
  P0106: C('Manifold pressure sensor out of range', 'The intake-pressure (MAP) sensor reading doesn’t make sense. Often a cracked vacuum hose.'),
  P0110: C('Intake air temperature sensor circuit', 'The intake-air temperature sensor isn’t reporting properly. Minor — mostly affects fuel trim.', 'watch'),
  P0112: C('Intake air temperature sensor low', 'Intake-air temperature reads too low — usually the sensor or its wiring.', 'watch'),
  P0113: C('Intake air temperature sensor high', 'Intake-air temperature reads too high — often an unplugged or failed sensor.', 'watch'),
  P0115: C('Coolant temperature sensor circuit', 'The engine can’t read its own temperature reliably. Watch the temperature gauge until it’s fixed.'),
  P0116: C('Coolant temperature sensor out of range', 'Engine temperature readings look wrong — could be the sensor or a thermostat issue.'),
  P0117: C('Coolant temperature sensor low', 'The coolant sensor signal is too low — usually the sensor or wiring.'),
  P0118: C('Coolant temperature sensor high', 'The coolant sensor signal is too high — check the gauge; if it’s really hot, stop.'),
  P0120: C('Throttle position sensor circuit', 'The sensor that reads the throttle isn’t reporting cleanly. Can cause hesitation or limp mode.'),
  P0121: C('Throttle position sensor out of range', 'Throttle position readings don’t match what the engine expects — sensor or throttle body.'),
  P0122: C('Throttle position sensor low', 'Throttle sensor signal too low — sensor or wiring.'),
  P0123: C('Throttle position sensor high', 'Throttle sensor signal too high — sensor or wiring.'),
  P0125: C('Engine slow to warm up', 'The engine takes too long to reach temperature — most often a thermostat stuck open. Hurts mileage and the heater.', 'watch'),
  P0128: C('Thermostat — engine running cool', 'The engine runs below its proper temperature — almost always a thermostat stuck open. Cheap fix; hurts mileage.', 'watch'),
  P0130: C('Oxygen sensor circuit (bank 1, sensor 1)', 'The upstream oxygen sensor isn’t responding properly. Affects fuel mixture and mileage.'),
  P0131: C('Oxygen sensor low (bank 1, sensor 1)', 'Upstream oxygen sensor reads low — sensor, wiring, or an exhaust leak.'),
  P0133: C('Oxygen sensor slow (bank 1, sensor 1)', 'The upstream oxygen sensor reacts slowly — it’s aging. Replace at your convenience.', 'watch'),
  P0134: C('Oxygen sensor no activity (bank 1, sensor 1)', 'The upstream oxygen sensor isn’t switching — sensor or its heater.'),
  P0135: C('Oxygen sensor heater (bank 1, sensor 1)', 'The heater inside the upstream oxygen sensor has failed. Usually means replacing the sensor.', 'watch'),
  P0137: C('Oxygen sensor low (bank 1, sensor 2)', 'Downstream oxygen sensor reads low — sensor, wiring, or exhaust leak.', 'watch'),
  P0138: C('Oxygen sensor high (bank 1, sensor 2)', 'Downstream oxygen sensor reads high — usually the sensor.', 'watch'),
  P0141: C('Oxygen sensor heater (bank 1, sensor 2)', 'The heater in the downstream oxygen sensor has failed. Not harmful to drive on.', 'watch'),
  P0155: C('Oxygen sensor heater (bank 2, sensor 1)', 'The heater in an upstream oxygen sensor (bank 2) has failed.', 'watch'),
  P0161: C('Oxygen sensor heater (bank 2, sensor 2)', 'The heater in a downstream oxygen sensor (bank 2) has failed.', 'watch'),
  P0171: C('Engine running lean (bank 1)', 'Too much air or too little fuel. Most common cause: a vacuum leak or dirty air-flow sensor; sometimes a weak fuel pump.'),
  P0172: C('Engine running rich (bank 1)', 'Too much fuel. Common causes: a leaking injector, dirty air-flow sensor, or a faulty oxygen sensor. Hurts mileage.'),
  P0174: C('Engine running lean (bank 2)', 'Too much air or too little fuel on bank 2 — usually a vacuum leak (often shows with P0171).'),
  P0175: C('Engine running rich (bank 2)', 'Too much fuel on bank 2 — injector, air-flow sensor or oxygen sensor.'),
  P0191: C('Fuel rail pressure sensor out of range', 'Fuel pressure readings look wrong — the sensor or the fuel pump. Can cause stalling.'),
  P0201: C('Injector circuit — cylinder 1', 'The fuel injector for cylinder 1 has an electrical fault. Expect a misfire on that cylinder.'),
  P0217: C('Engine overheating', 'The engine has run too hot. Pull over when safe and let it cool — driving on can warp the head. Check coolant (only when cold).', 'urgent'),
  P0219: C('Engine over-revved', 'The engine went past its rev limit at some point. Not a fault by itself — just avoid it.', 'watch'),
  P0234: C('Turbo overboost', 'The turbo made more boost than it should — wastegate or boost control. Ease off until checked.'),
  P0299: C('Turbo underboost', 'The turbo isn’t making expected boost — often a boost leak or wastegate. Power will feel down.'),
  // ── Ignition / misfire ────────────────────────────────────────────────────
  P0300: C('Random misfires', MISFIRE_WHAT, 'urgent'),
  P0301: C('Misfire — cylinder 1', MISFIRE_WHAT, 'urgent'),
  P0302: C('Misfire — cylinder 2', MISFIRE_WHAT, 'urgent'),
  P0303: C('Misfire — cylinder 3', MISFIRE_WHAT, 'urgent'),
  P0304: C('Misfire — cylinder 4', MISFIRE_WHAT, 'urgent'),
  P0305: C('Misfire — cylinder 5', MISFIRE_WHAT, 'urgent'),
  P0306: C('Misfire — cylinder 6', MISFIRE_WHAT, 'urgent'),
  P0307: C('Misfire — cylinder 7', MISFIRE_WHAT, 'urgent'),
  P0308: C('Misfire — cylinder 8', MISFIRE_WHAT, 'urgent'),
  P0325: C('Knock sensor circuit', 'The sensor that listens for engine knock isn’t reporting. The engine may pull timing to protect itself — slightly less power.'),
  P0335: C('Crankshaft position sensor circuit', 'The engine can’t read the crankshaft position reliably. This can cause stalling or a no-start — get it looked at.', 'urgent'),
  P0340: C('Camshaft position sensor circuit', 'The camshaft position sensor isn’t reporting. Can cause hard starts or stalling.'),
  P0341: C('Camshaft position sensor out of range', 'Camshaft sensor readings don’t line up — sensor, or timing chain stretch on higher-mileage engines.'),
  P0351: C('Ignition coil A circuit', 'An ignition coil (often cylinder 1) has an electrical fault. Expect misfires.'),
  // ── Emissions ─────────────────────────────────────────────────────────────
  P0400: C('EGR flow', 'The exhaust-gas recirculation system isn’t flowing correctly — often carbon build-up.', 'watch'),
  P0401: C('EGR flow too low', 'Not enough exhaust gas is being recirculated — usually a clogged EGR valve or passages. Can cause pinging.', 'watch'),
  P0402: C('EGR flow too high', 'Too much exhaust gas recirculating — often an EGR valve stuck open. Can cause rough idle.'),
  P0411: C('Secondary air injection flow', 'The cold-start air pump system isn’t flowing correctly. Emissions only.', 'watch'),
  P0420: C('Catalytic converter efficiency (bank 1)', 'The catalytic converter isn’t cleaning the exhaust as well as it should. Not urgent to drive on, but it will fail an emissions test. Sometimes it’s just an oxygen sensor.', 'watch'),
  P0430: C('Catalytic converter efficiency (bank 2)', 'The bank-2 catalytic converter isn’t cleaning the exhaust well enough. Emissions-test failure, not an immediate danger.', 'watch'),
  P0440: C('Evaporative system (EVAP)', 'A fault in the system that traps fuel vapour. Start by checking the gas cap is tight.', 'watch'),
  P0441: C('EVAP purge flow', 'Fuel-vapour purge flow isn’t right — often the purge valve. Emissions only.', 'watch'),
  P0442: C('EVAP small leak', 'A small fuel-vapour leak — very often a loose or worn gas cap. Tighten it and see if it clears after a few drives.', 'watch'),
  P0446: C('EVAP vent control', 'The fuel-vapour vent valve isn’t working right. Emissions only.', 'watch'),
  P0455: C('EVAP large leak', 'A large fuel-vapour leak — check the gas cap first (missing or not clicked shut), then the hoses.', 'watch'),
  P0456: C('EVAP very small leak', 'A tiny fuel-vapour leak — almost always the gas cap seal. Harmless to drive on.', 'watch'),
  P0457: C('EVAP leak — gas cap loose', 'The gas cap is loose or missing. Tighten it until it clicks; the light clears itself after a few drives.', 'watch'),
  P0496: C('EVAP purge flow during non-purge', 'The purge valve is letting vapour through when it shouldn’t — usually a stuck purge valve. Can cause hard starts after fuelling.', 'watch'),
  // ── Speed, idle & electrical ──────────────────────────────────────────────
  P0500: C('Vehicle speed sensor', 'The car can’t read its own speed reliably — can upset the speedometer, ABS and shifting.'),
  P0505: C('Idle control system', 'Idle speed isn’t being controlled properly — often a dirty throttle body. Rough or surging idle.', 'watch'),
  P0506: C('Idle speed lower than expected', 'The engine idles too low — often a dirty throttle body or vacuum leak.', 'watch'),
  P0507: C('Idle speed higher than expected', 'The engine idles too high — usually a vacuum leak or dirty throttle body.', 'watch'),
  P0520: C('Oil pressure sensor circuit', 'The oil-pressure sensor isn’t reporting. Until it’s checked you can’t trust the oil warning — check the dipstick.', 'urgent'),
  P0521: C('Oil pressure out of range', 'Oil pressure readings look wrong. Check the oil level now; low oil pressure destroys engines fast.', 'urgent'),
  P0522: C('Oil pressure low', 'Oil pressure reads low. Check the oil level before driving further — low oil pressure destroys engines.', 'urgent'),
  P0562: C('System voltage low', 'The car’s electrical voltage is low — a weak battery or failing alternator. You could get stranded.', 'urgent'),
  P0563: C('System voltage high', 'Electrical voltage is too high — usually the alternator’s regulator. Can damage electronics.'),
  P0571: C('Brake switch circuit', 'The brake-pedal switch isn’t reporting cleanly. Can affect brake lights and cruise control — check your brake lights work.'),
  // ── Computer & outputs ────────────────────────────────────────────────────
  P0600: C('Engine computer communication', 'An internal communication fault in the engine computer. Get it scanned by a shop.'),
  P0606: C('Engine computer processor fault', 'The engine computer has flagged an internal fault. Can cause odd running or limp mode.'),
  P0620: C('Alternator control circuit', 'The engine computer can’t control the alternator properly — charging may suffer.'),
  // ── Transmission ──────────────────────────────────────────────────────────
  P0700: C('Transmission fault', 'The transmission computer has stored its own fault. A shop needs to read the transmission module for details.'),
  P0705: C('Transmission range sensor', 'The car isn’t sure which gear (P/R/N/D) is selected. Can affect starting and shifting.'),
  P0715: C('Transmission input speed sensor', 'An internal transmission speed sensor isn’t reporting — harsh or odd shifts likely.'),
  P0720: C('Transmission output speed sensor', 'The transmission output speed sensor isn’t reporting — can affect shifting and the speedometer.'),
  P0730: C('Incorrect gear ratio', 'The transmission isn’t holding the gear it should — slipping. Get it checked before it gets worse.', 'urgent'),
  P0740: C('Torque converter clutch circuit', 'The torque converter lock-up isn’t working right — mileage drops, shifts may shudder.'),
  P0741: C('Torque converter clutch stuck off', 'The torque converter isn’t locking up — worse highway mileage and extra heat in the transmission.'),
  P0750: C('Shift solenoid A', 'A transmission shift solenoid has an electrical fault — expect harsh or missed shifts.'),
  P0755: C('Shift solenoid B', 'A transmission shift solenoid has an electrical fault — expect harsh or missed shifts.'),
  P0780: C('Shift malfunction', 'A shift didn’t happen the way the transmission expected. Get the transmission checked.'),
};

export function lookupDtc(code){
  return DTC[String(code || '').toUpperCase()] || null;
}

/**
 * Honest fallback for any code not in the table, from its structure alone:
 * the first letter is the system, a 1/3 second digit means manufacturer-
 * specific, and P0 codes group by the third digit.
 */
export function systemFor(code){
  const c = String(code || '').toUpperCase();
  const maker = c[1] === '1' || c[1] === '3';
  const tail = maker ? ' This is a manufacturer-specific code — a shop with your brand’s scanner can say exactly what it is.' : '';
  if (c[0] === 'C') return C('Chassis system fault', `Something in the brakes, steering, suspension or ABS has logged a fault.${tail}`);
  if (c[0] === 'B') return C('Body system fault', `Something in the body electronics — airbags, seats, lighting, climate — has logged a fault.${tail}`, 'watch');
  if (c[0] === 'U') return C('Network communication fault', `Two of the car’s computers lost touch with each other.${tail}`);
  const group = {
    '0': ['Fuel, air or emissions fault', 'watch'], '1': ['Fuel or air metering fault', 'soon'],
    '2': ['Fuel or air metering fault', 'soon'], '3': ['Ignition or misfire fault', 'soon'],
    '4': ['Emissions control fault', 'watch'], '5': ['Speed, idle or electrical fault', 'soon'],
    '6': ['Engine computer fault', 'soon'], '7': ['Transmission fault', 'soon'],
    '8': ['Transmission fault', 'soon'], '9': ['Transmission fault', 'soon'],
    'A': ['Hybrid system fault', 'soon'],
  }[c[2]] || ['Powertrain fault', 'soon'];
  return C(group[0], `The engine or drivetrain computer logged a fault in this area.${tail}`, group[1]);
}
