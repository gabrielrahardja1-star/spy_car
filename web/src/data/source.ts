import type { TruckSource } from './trackers'
import type { Car, CheckpointInput, Geofence, Position, Summary, Stop, Trip } from './types'

/** State of the live link. 'reconnecting' covers the first connect and short outages, 'offline' a longer one. */
export type ConnectionState = 'connected' | 'reconnecting' | 'offline'

/** Adding, changing and deleting checkpoints (geofences with type = checkpoint). */
export interface CheckpointEditor {
  /** Whether the signed-in user may change checkpoints (Traccar: an administrator who is not read-only). */
  canEdit(): Promise<boolean>
  /** Creates a checkpoint, or replaces checkpoint `id` (name, centre and radius). */
  save(input: CheckpointInput, id?: string): Promise<void>
  remove(id: string): Promise<void>
}

/** A truck as an admin manages it: disabled ones included. */
export interface TruckRecord {
  id: string
  name: string
  /** Test trucks are driven by the simulator or the phone app; real ones have a GPS tracker. */
  source: TruckSource
  /** What the tracker sends as its ID: the IMEI, the phone app's ID or the simulator's --id. */
  trackerId: string
  /** Tracker model key (TRACKER_MODELS), real trucks only; '' when unknown. */
  model: string
  /** The tracker's SIM phone number (to configure it by SMS), real trucks only. */
  phone: string
  driver: string
  enabled: boolean
}

export type TruckInput = Pick<TruckRecord, 'name' | 'source' | 'trackerId' | 'model' | 'phone' | 'driver'>

/** A change refused for a reason the person can fix; the message says how. */
export class EditRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditRefused'
  }
}

/** The tracker ID problem with `input`, or null. Shared by every source so the wording is the same. */
export function truckInputProblem(input: TruckInput, others: TruckRecord[]): string | null {
  const id = input.trackerId.trim().toLowerCase()
  const clash = others.find((t) => t.trackerId.trim().toLowerCase() === id)
  return clash ? `Tracker ID ${input.trackerId.trim()} is already used by ${clash.name}.` : null
}

/** Adding, changing, disabling and deleting trucks. */
export interface TruckEditor {
  /** Whether the signed-in user may change trucks (Traccar: an administrator who is not read-only). */
  canEdit(): Promise<boolean>
  /** Every truck, disabled ones included, by name. */
  list(): Promise<TruckRecord[]>
  /** Creates a truck, or changes truck `id`. Rejects with EditRefused when the tracker ID is taken. */
  save(input: TruckInput, id?: string): Promise<void>
  /** A disabled truck disappears from every screen but keeps its history; enable it to bring it back. */
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** Deletes the truck and, in Traccar, every position it ever sent. */
  remove(id: string): Promise<void>
}

/**
 * The only way screens get data (PLAN.md 4, 10). A mock and a Traccar implementation both satisfy this.
 * All times are ms since epoch (UTC); ranges are [from, to) .
 */
export interface DataSource {
  getCars(): Promise<Car[]>
  getGeofences(): Promise<Geofence[]>
  /** Latest known fix per car (by fixTime). Cars that never reported are omitted. */
  getLatestPositions(): Promise<Position[]>
  /**
   * Live updates. Messages may carry late or out-of-order fixes (buffered by a tracker after a signal gap).
   * Returns an unsubscribe function. `onMessage` is called with the time the message arrived (Date.now-style ms).
   */
  subscribe(handlers: {
    onPositions: (positions: Position[]) => void
    onMessage?: (receivedAt: number) => void
  }): () => void
  /** Full path for one car in a range, sorted by fixTime ascending. */
  getRoute(carId: string, from: number, to: number): Promise<Position[]>
  /** Trips overlapping the range, newest first. carId null = both cars. */
  getTrips(carId: string | null, from: number, to: number): Promise<Trip[]>
  getStops(carId: string | null, from: number, to: number): Promise<Stop[]>
  /** One row per car. Must equal totals computed from getTrips for the same range. */
  getSummary(from: number, to: number): Promise<Summary[]>
  /**
   * Optional (Phase 7): reports the live link state, once immediately and then on every change.
   * Sources without a network link (the mock) leave it out. Returns an unsubscribe function.
   */
  onConnectionChange?(listener: (state: ConnectionState) => void): () => void
  /** Optional: checkpoint editing. getGeofences reflects a change once its promise has resolved. */
  checkpoints?: CheckpointEditor
  /** Optional: called after the geofences changed. Returns an unsubscribe function. */
  onGeofencesChange?(listener: () => void): () => void
  /** Optional: truck management. getCars reflects a change once its promise has resolved. */
  trucks?: TruckEditor
  /** Optional: called after the trucks changed. Returns an unsubscribe function. */
  onCarsChange?(listener: () => void): () => void
}
