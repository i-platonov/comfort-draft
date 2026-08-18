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

/**
 * Loop tube sizes, given as outside diameter in mm. Both common sizes have a 2 mm wall,
 * so the bore — the bit that holds water — is the outside diameter less two walls.
 */
export const PIPE_WALL_MM = 2;
export const DEFAULT_PIPE_OUTER_DIAMETER_MM = 16;
export const COMMON_PIPE_OUTER_DIAMETERS_MM = [16, 18, 20];

/** Water held per metre of pipe, litres, for a tube of the given outside diameter. */
export function pipeLitresPerMetre(outerDiameterMm: number): number {
  const boreMm = Math.max(0, outerDiameterMm - 2 * PIPE_WALL_MM);
  return (Math.PI * (boreMm / 2) ** 2) / 1000;
}

/** Water volume (L) held by a length of pipe of the given outside diameter. */
export function pipeVolumeLitres(pipeLengthM: number, outerDiameterMm: number): number {
  return pipeLengthM * pipeLitresPerMetre(outerDiameterMm);
}
