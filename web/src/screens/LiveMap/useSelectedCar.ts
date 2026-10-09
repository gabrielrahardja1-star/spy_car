import { useState } from 'react'

/** Selected car id for the Live map. Falls back to the first car until the user picks one (or if the pick disappears). */
export function useSelectedCar(carIds: string[]): [string | null, (id: string) => void] {
  const [picked, setPicked] = useState<string | null>(null)
  const selected = picked !== null && carIds.includes(picked) ? picked : (carIds[0] ?? null)
  return [selected, setPicked]
}
