export const immediateRemoval = {
  setRef: () => {},
  run: async (_ids: unknown, operation: () => unknown) => operation(),
}
