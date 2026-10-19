export const CONTROL_TEST_SEEDS = [0x12345678, 0x9e3779b9, 0xdeadbeef]

export function seededRandom(seed: number) {
  let state = seed >>> 0
  return (limit: number) => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) % limit
  }
}
