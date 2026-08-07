/**
 * Heat carried away from the flow water as it cools from supply to return
 * temperature: Q = mass flow x specific heat x delta-T. Water is treated as
 * a constant 1 kg/L, cp = 4186 J/(kg*K), which is accurate enough over
 * typical underfloor-heating temperature ranges for this estimate.
 */
const WATER_HEAT_CONSTANT = 4186 / 60; // W per (L/min * K)

/** A zone's loop flow rate, scaled from a system-wide rate-per-100m by its own pipe length. */
export function zoneFlowLpm(pipeLengthM: number, flowLpmPer100m: number): number {
  return (pipeLengthM / 100) * flowLpmPer100m;
}

/** Heat output (W) of a single zone's loop, given its own flow rate and the shared supply/return delta-T. */
export function zoneHeatOutputW(
  pipeLengthM: number,
  flowLpmPer100m: number,
  supplyTempC: number,
  returnTempC: number,
): number {
  const deltaT = Math.max(0, supplyTempC - returnTempC);
  const flowLpm = zoneFlowLpm(pipeLengthM, flowLpmPer100m);
  return flowLpm * deltaT * WATER_HEAT_CONSTANT;
}
