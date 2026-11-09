// How a truck reports its position: the simulator or the phone app (test trucks), or a GPS tracker wired into the truck.
// Each tracker family talks its own protocol on its own Traccar port (deploy/traccar.xml); the port must also be opened
// to the internet with its *_BIND variable in deploy/.env.

export type TruckSource = 'simulator' | 'phone' | 'tracker'

export interface TrackerModel {
  key: string
  label: string
  /** Traccar protocol name and port, as enabled in deploy/traccar.xml. */
  protocol: string
  port: number
  /** The deploy/.env variable that opens the port (0.0.0.0) or keeps it closed (127.0.0.1). */
  bindVar: string
}

export const TRACKER_MODELS: TrackerModel[] = [
  { key: 'teltonika', label: 'Teltonika (FMB, FMC, FMM series)', protocol: 'teltonika', port: 5027, bindVar: 'TELTONIKA_BIND' },
  { key: 'gt06', label: 'Concox / Jimi / other GT06 trackers', protocol: 'gt06', port: 5023, bindVar: 'GT06_BIND' },
  { key: 'queclink', label: 'Queclink (GL, GV series)', protocol: 'gl200', port: 5004, bindVar: 'QUECLINK_BIND' },
]

/** The Traccar Client phone app and the simulator both use the OsmAnd protocol. */
export const OSMAND_PORT = 5055

export const trackerModel = (key: string): TrackerModel | undefined => TRACKER_MODELS.find((m) => m.key === key)

/** 15 digits with a valid Luhn check digit, the way every IMEI is built. */
export function isValidImei(text: string): boolean {
  if (!/^\d{15}$/.test(text)) return false
  let sum = 0
  for (let i = 0; i < 15; i++) {
    let d = Number(text[14 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/** A simulator ID from the truck's name: "DT-03" -> "sim-dt-03". */
export const simulatorId = (name: string): string =>
  `sim-${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'truck'}`
